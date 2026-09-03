import { useEffect, useMemo } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { categoryFor } from '../constants/categories';
import { motion, spacing, typography, useTheme } from '../constants/theme';
import { useReducedMotion } from './motion';
import {
  HOUR_AXIS_LABELS,
  hourlyAxis,
  hourlyCeiling,
  type HourBucket,
} from '../utils/screenTime';

interface Props {
  hours: HourBucket[];
  height?: number;
  /** Axis labels and gridlines cost vertical room; drop them on small cards. */
  showAxis?: boolean;
}

/**
 * Today, hour by hour, stacked by category.
 *
 * The weekly bars answer "how much?". This answers "when?", which is the
 * question that actually changes behaviour: an hour of social media at 11pm is
 * a different problem from an hour spread over lunch, and only one of them is
 * fixed by a schedule.
 *
 * Each column is a stack rather than a single colour because an hour is rarely
 * one thing. Drawing only the dominant category would quietly hide the second
 * half of most hours.
 *
 * The chart is deliberately not interactive. A tooltip on a 24-column chart on
 * a phone is a fiddly target that tells you something the list below already
 * says plainly.
 */
export function HourlyChart({ hours, height = 120, showAxis = true }: Props) {
  const { colors } = useTheme();

  const ceiling = hourlyCeiling(hours);
  const axis = hourlyAxis(ceiling);

  return (
    <View style={styles.wrap}>
      <View style={styles.plotRow}>
        <View style={[styles.plot, { height }]}>
          {/* Gridlines sit behind the bars: top, middle, baseline. */}
          {[0, 0.5, 1].map((fraction) => (
            <View
              key={fraction}
              style={[
                styles.gridline,
                { top: fraction * height, backgroundColor: colors.border },
              ]}
            />
          ))}

          {/* Quarter-day dividers, matching the clock labels underneath. */}
          {[6, 12, 18].map((hour) => (
            <View
              key={hour}
              style={[
                styles.divider,
                { left: `${(hour / 24) * 100}%`, backgroundColor: colors.border },
              ]}
            />
          ))}

          <View style={styles.bars}>
            {hours.map((bucket) => (
              <HourColumn
                key={bucket.hour}
                bucket={bucket}
                ceiling={ceiling}
                height={height}
              />
            ))}
          </View>
        </View>

        {showAxis ? (
          <View style={[styles.axis, { height }]}>
            {axis.map((label) => (
              <Text key={label} style={[styles.axisLabel, { color: colors.textFaint }]}>
                {label}
              </Text>
            ))}
          </View>
        ) : null}
      </View>

      {showAxis ? (
        <View style={styles.clockRow}>
          {HOUR_AXIS_LABELS.map((label) => (
            <Text key={label} style={[styles.clockLabel, { color: colors.textFaint }]}>
              {label}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * One hour: a stack of category-coloured slices, tallest slice at the base.
 *
 * The column grows up from the baseline on first render. A chart that animates
 * in is doing something a static one cannot: it shows the axis it is measured
 * against, because the eye watches the bar travel from zero. Staggering by hour
 * makes the day read left to right, the direction it is meant to be read.
 */
function HourColumn({
  bucket,
  ceiling,
  height,
}: {
  bucket: HourBucket;
  ceiling: number;
  height: number;
}) {
  const reduced = useReducedMotion();
  const grow = useMemo(() => new Animated.Value(reduced ? 1 : 0), [reduced]);

  // Clamped: an hour can technically exceed the ceiling when several apps
  // overlap in Android's records, and a bar taller than the chart looks broken.
  const columnHeight = Math.max(2, Math.min(1, bucket.total / ceiling) * height);

  useEffect(() => {
    if (reduced) {
      grow.setValue(1);
      return;
    }
    const animation = Animated.timing(grow, {
      toValue: 1,
      duration: motion.base,
      // Capped so the last hour does not wait on a long queue of earlier ones.
      delay: Math.min(bucket.hour * 18, 320),
      easing: Easing.out(Easing.cubic),
      // Height cannot run on the native driver.
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [bucket.hour, columnHeight, grow, reduced]);

  if (bucket.total <= 0) return <View style={styles.column} />;

  return (
    <View style={styles.column}>
      <Animated.View
        style={[
          styles.stack,
          {
            height: grow.interpolate({
              inputRange: [0, 1],
              outputRange: [0, columnHeight],
            }),
          },
        ]}
      >
        {bucket.segments.map((segment, index) => (
          <View
            key={segment.category}
            style={{
              flex: Math.max(segment.seconds, 1),
              backgroundColor: categoryFor(segment.category).color,
              // Only the top slice is rounded, so the stack reads as one bar.
              borderTopLeftRadius: index === 0 ? 2 : 0,
              borderTopRightRadius: index === 0 ? 2 : 0,
            }}
          />
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  plotRow: { flexDirection: 'row', gap: spacing.sm },
  plot: { flex: 1, justifyContent: 'flex-end' },
  gridline: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
  divider: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    opacity: 0.6,
  },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: '100%' },
  column: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 0.5 },
  stack: {
    width: '100%',
    borderRadius: 2,
    overflow: 'hidden',
    // Bottom-up: the first segment is the largest and sits at the base.
    flexDirection: 'column-reverse',
  },
  axis: { justifyContent: 'space-between', minWidth: 34 },
  axisLabel: { ...typography.caption, fontSize: 11, textAlign: 'right' },
  clockRow: { flexDirection: 'row' },
  clockLabel: { ...typography.caption, fontSize: 11, flex: 1 },
});
