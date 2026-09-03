import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { motion, radius, spacing, typography, useTheme } from '../constants/theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'regular' | 'large';

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  /** Shown under the label, e.g. "Lock until 6:30 PM". */
  caption?: string;
  testID?: string;
}

/**
 * The one button.
 *
 * Four variants, and only one of them is loud. A screen with two primary
 * buttons has no primary action, so secondary work uses `secondary`, and
 * anything the user rarely wants uses `ghost`.
 */
export function PrimaryButton({
  label,
  onPress,
  variant = 'primary',
  size = 'regular',
  disabled = false,
  loading = false,
  caption,
  testID,
}: Props) {
  const { colors } = useTheme();
  const inactive = disabled || loading;

  const background = {
    primary: colors.accent,
    secondary: colors.surfaceMuted,
    ghost: 'transparent',
    danger: colors.danger,
  }[variant];

  // A filled button darkens on press; a quiet one lifts instead, since there is
  // no fill to darken.
  const pressedBackground = {
    primary: colors.accentPressed,
    secondary: colors.surfaceRaised,
    ghost: colors.surfaceMuted,
    danger: colors.accentPressed,
  }[variant];

  const foreground = {
    primary: colors.accentText,
    secondary: colors.text,
    ghost: colors.textMuted,
    danger: '#FFFFFF',
  }[variant];

  const borderColor = variant === 'ghost' ? 'transparent' : 'transparent';

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      accessibilityLabel={caption ? `${label}. ${caption}` : label}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        size === 'large' ? styles.large : styles.regular,
        {
          backgroundColor: pressed && !inactive ? pressedBackground : background,
          borderColor,
          // Disabled stays legible: 0.4 made the label unreadable, which turned
          // 'not yet' into 'broken'.
          opacity: inactive ? 0.55 : 1,
          // Slight, and paired with the colour change above. A button that
          // visibly shrinks reads as a gimmick.
          transform: [{ scale: pressed && !inactive ? motion.pressScale : 1 }],
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <View style={styles.content}>
          <Text style={[styles.label, { color: foreground }]}>{label}</Text>
          {caption ? (
            <Text style={[styles.caption, { color: foreground }]}>{caption}</Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  regular: {
    minHeight: 52,
    paddingVertical: spacing.md,
  },
  large: {
    minHeight: 58,
    paddingVertical: spacing.lg,
  },
  content: {
    alignItems: 'center',
  },
  label: {
    ...typography.label,
    fontSize: 16,
    textAlign: 'center',
  },
  caption: {
    ...typography.caption,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 3,
    opacity: 0.75,
  },
});
