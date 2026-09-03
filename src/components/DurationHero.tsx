import { StyleSheet, Text, View } from 'react-native';

import { radius, spacing, typography, useTheme } from '../constants/theme';

interface Props {
  /** The chosen duration, already formatted, e.g. "30 min". */
  value: string;
  /** What it means in plain terms, e.g. "Locked until 6:30 PM". */
  caption: string;
  /** A quiet line above, naming what is being set. */
  label: string;
  testID?: string;
}

/**
 * The duration being chosen, stated once and large.
 *
 * The presets and the stepper are *controls*; this is the *answer*, and before
 * it existed the answer was only legible inside the stepper, at the same weight
 * as the two buttons either side of it. People were changing a number without a
 * clear sense of what they had landed on.
 *
 * The caption carries the consequence rather than the quantity — "30 min" is
 * abstract, "Locked until 6:30 PM" is the thing you are actually agreeing to.
 */
export function DurationHero({ value, caption, label, testID }: Props) {
  const { colors } = useTheme();

  return (
    <View
      testID={testID}
      // One announcement, so a screen reader says the whole thing rather than
      // three disconnected fragments.
      accessible
      accessibilityLabel={`${label}: ${value}. ${caption}`}
      style={[
        styles.wrap,
        { backgroundColor: colors.accentSoft, borderColor: colors.accent },
      ]}
    >
      <Text style={[styles.label, { color: colors.accentOnSurface }]}>{label}</Text>
      <Text style={[styles.value, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.caption, { color: colors.textMuted }]}>{caption}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  label: typography.eyebrow,
  value: {
    ...typography.hero,
    fontSize: 38,
    lineHeight: 44,
    // Tabular figures stop the number jumping sideways as it is stepped.
    fontVariant: ['tabular-nums'],
  },
  caption: { ...typography.body, fontSize: 15, textAlign: 'center' },
});
