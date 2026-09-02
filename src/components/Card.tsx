import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { radius, spacing, typography, useTheme } from '../constants/theme';

interface Props {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  /** Small-caps marker above the title, e.g. "PROTECTION". */
  eyebrow?: string;
  /** Draws attention without shouting — used for status, never decoration. */
  tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
  style?: ViewStyle;
}

/**
 * The container for everything.
 *
 * Depth comes from surface tone plus a hairline border, not shadow — shadows
 * read as smudges on a dark ground. `tone` tints only the border and eyebrow,
 * so a warning card is unmistakable without becoming a coloured slab.
 */
export function Card({ children, title, subtitle, eyebrow, tone = 'default', style }: Props) {
  const { colors } = useTheme();

  const accent = {
    default: colors.border,
    accent: colors.accent,
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
  }[tone];

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: tone === 'default' ? colors.border : accent,
        },
        style,
      ]}
    >
      {eyebrow ? (
        <Text style={[styles.eyebrow, { color: tone === 'default' ? colors.textFaint : accent }]}>
          {eyebrow}
        </Text>
      ) : null}
      {title ? <Text style={[styles.title, { color: colors.text }]}>{title}</Text> : null}
      {subtitle ? (
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</Text>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.xl,
  },
  eyebrow: {
    ...typography.eyebrow,
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.heading,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.caption,
    marginBottom: spacing.lg,
  },
});
