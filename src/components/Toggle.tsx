import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { spacing, typography, useTheme } from '../constants/theme';

interface Props {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  /** Shows a PRO pill and routes the press to the paywall instead. */
  locked?: boolean;
  onLockedPress?: () => void;
  testID?: string;
}

export function Toggle({
  label,
  description,
  value,
  onChange,
  disabled = false,
  locked = false,
  onLockedPress,
  testID,
}: Props) {
  const { colors } = useTheme();

  // A locked toggle stays tappable on purpose: tapping it explains why, which
  // is more useful than a dead control.
  const handlePress = () => {
    if (locked) onLockedPress?.();
    else if (!disabled) onChange(!value);
  };

  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: disabled && !locked }}
      accessibilityLabel={label}
      accessibilityHint={locked ? 'Requires Pro' : description}
      onPress={handlePress}
      style={styles.row}
    >
      <View style={styles.labels}>
        <View style={styles.titleRow}>
          <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
          {locked ? (
            <Text style={[styles.pro, { color: colors.accent, borderColor: colors.accent }]}>
              PRO
            </Text>
          ) : null}
        </View>
        {description ? (
          <Text style={[styles.description, { color: colors.textMuted }]}>{description}</Text>
        ) : null}
      </View>

      <Switch
        value={value && !locked}
        onValueChange={locked ? () => onLockedPress?.() : onChange}
        disabled={disabled && !locked}
        trackColor={{ false: colors.surfaceMuted, true: colors.accent }}
        thumbColor={colors.surface}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  labels: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    ...typography.body,
    fontWeight: '600',
  },
  description: {
    ...typography.caption,
    marginTop: 2,
    lineHeight: 18,
  },
  pro: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '700',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    overflow: 'hidden',
  },
});
