import { StyleSheet, Text, View } from 'react-native';

import { categoryFor, type CategoryId } from '../constants/categories';
import { typography, useTheme } from '../constants/theme';
import { barHeights, dayLabels } from '../utils/screenTime';

interface Props {
  /** Per-day totals in seconds, oldest first, today last. */
  days: number[];
  /** Colours the bars by category share, when that breakdown is known. */
  dominant?: CategoryId;
  height?: number;
  showLabels?: boolean;
}

/**
 * A week of screen time, as bars.
 *
 * Scaled to the tallest day in the window rather than a fixed ceiling, so a
 * quiet week still has a readable shape instead of seven stubs. A day with no
 * measurement gets a faint placeholder rather than a zero-height bar, because a
 * missing day and a day you did not touch your phone are different facts.
 */
export function TrendBars({ days, dominant, height = 64, showLabels = true }: Props) {
  const { colors } = useTheme();
  const heights = barHeights(days);
  const labels = dayLabels(days.length);
  const barColor = dominant ? categoryFor(dominant).color : colors.accent;

  return (
    <View style={styles.wrap}>
      <View style={[styles.row, { height }]}>
        {heights.map((fraction, index) => {
          const isToday = index === heights.length - 1;
          const empty = days[index] <= 0;

          return (
            <View key={labels[index] + String(index)} style={styles.column}>
              <View
                style={[
                  styles.bar,
                  {
                    // A visible minimum so a very short day is still a mark on
                    // the chart rather than an invisible one.
                    height: empty ? 3 : Math.max(6, fraction * height),
                    backgroundColor: empty
                      ? colors.surfaceMuted
                      : isToday
                        ? barColor
                        : `${barColor}66`,
                  },
                ]}
              />
            </View>
          );
        })}
      </View>

      {showLabels ? (
        <View style={styles.row}>
          {labels.map((letter, index) => (
            <View key={letter + String(index)} style={styles.column}>
              <Text
                style={[
                  styles.label,
                  {
                    color:
                      index === labels.length - 1 ? colors.text : colors.textFaint,
                  },
                ]}
              >
                {letter}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  column: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '100%', maxWidth: 14, borderRadius: 4 },
  label: { ...typography.caption, fontSize: 11, fontWeight: '600' },
});
