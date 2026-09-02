import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useTheme } from '../constants/theme';

interface Props {
  /** 0 to 1. Values outside that range are clamped. */
  progress: number;
  size?: number;
  thickness?: number;
  /** Overrides the accent stroke, e.g. to signal a degraded lock. */
  color?: string;
  children?: ReactNode;
}

/**
 * A circular progress indicator with content in the middle.
 *
 * Rendered with SVG rather than an animated library on purpose: the value comes
 * from `endTimestamp - now`, so it only needs to be correct once per second and
 * an animation driver would add a second, competing source of timing.
 */
export function ProgressRing({
  progress,
  size = 260,
  thickness = 10,
  color,
  children,
}: Props) {
  const { colors } = useTheme();

  const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={colors.surfaceMuted}
          strokeWidth={thickness}
          fill="none"
        />
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={color ?? colors.accent}
          strokeWidth={thickness}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          // Start the arc at 12 o'clock instead of 3 o'clock.
          transform={`rotate(-90 ${center} ${center})`}
        />
      </Svg>

      <View style={[StyleSheet.absoluteFill, styles.content]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
