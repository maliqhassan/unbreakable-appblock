import { StyleSheet, Text, View } from 'react-native';

import { radius, spacing, typography, useTheme } from '../constants/theme';

export type BadgeTone = 'neutral' | 'active' | 'warning' | 'danger';

interface Props {
  label: string;
  tone?: BadgeTone;
}

/**
 * A small state pill.
 *
 * Filled with a translucent tint of its own colour rather than outlined — on a
 * dark ground a thin coloured border almost disappears, and this reads at a
 * glance from arm's length.
 */
export function StatusBadge({ label, tone = 'neutral' }: Props) {
  const { colors } = useTheme();

  const { fg, bg } = {
    neutral: { fg: colors.textMuted, bg: colors.surfaceMuted },
    active: { fg: colors.success, bg: colors.successSoft },
    warning: { fg: colors.warning, bg: colors.warningSoft },
    danger: { fg: colors.danger, bg: colors.dangerSoft },
  }[tone];

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <View style={[styles.dot, { backgroundColor: fg }]} />
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.sm,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  label: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
