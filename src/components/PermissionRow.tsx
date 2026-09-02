import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, spacing, typography, useTheme } from '../constants/theme';
import type { PermissionState } from '../types';

interface Props {
  permission: PermissionState;
  onEnable: (permission: PermissionState) => void;
}

/**
 * One permission, shown honestly: what it is, why we need it, where it stands,
 * and a button that opens the system screen. Never a silent failure.
 */
export function PermissionRow({ permission, onEnable }: Props) {
  const { colors } = useTheme();
  const granted = permission.status === 'granted';
  const unavailable = permission.status === 'unavailable';

  const statusColor = granted
    ? colors.success
    : unavailable
      ? colors.textFaint
      : permission.optional
        ? colors.warning
        : colors.danger;

  const statusLabel = granted
    ? 'Granted'
    : unavailable
      ? 'Not applicable'
      : permission.optional
        ? 'Optional'
        : 'Required';

  return (
    <View style={[styles.row, { borderColor: colors.border }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>{permission.title}</Text>
        <Text style={[styles.status, { color: statusColor }]}>{statusLabel}</Text>
      </View>

      <Text style={[styles.rationale, { color: colors.textMuted }]}>
        {permission.rationale}
      </Text>

      {!granted && !unavailable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Enable ${permission.title}`}
          testID={`enable-${permission.id}`}
          onPress={() => onEnable(permission)}
          style={({ pressed }) => [
            styles.button,
            { borderColor: colors.accent, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.buttonLabel, { color: colors.accent }]}>Enable</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderTopWidth: 1,
    paddingVertical: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  title: {
    ...typography.body,
    fontWeight: '600',
    flex: 1,
  },
  status: {
    ...typography.caption,
    fontWeight: '700',
  },
  rationale: {
    ...typography.caption,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  button: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  buttonLabel: {
    ...typography.label,
  },
});
