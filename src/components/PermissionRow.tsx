import { StyleSheet, Text, View } from 'react-native';

import { HIT_SIZE, radius, spacing, typography, useTheme } from '../constants/theme';
import type { PermissionState } from '../types';
import { PressableScale } from './motion';

interface Props {
  permission: PermissionState;
  onEnable: (permission: PermissionState) => void;
}

/**
 * One permission: what it is, why it is needed, where it stands, and a way to
 * grant it. Never a silent failure.
 *
 * The card changes weight with its status, which is the whole point. A granted
 * permission is done and should recede — a tinted check and quiet text. One
 * still needed keeps a full-strength title and a visible button, so a glance
 * down the list lands on the things that still want doing.
 *
 * Red is reserved for something actually broken. A permission that has simply
 * not been granted yet is not an error, so it reads as accent-and-neutral
 * rather than as a warning.
 */
export function PermissionRow({ permission, onEnable }: Props) {
  const { colors } = useTheme();
  const granted = permission.status === 'granted';
  const unavailable = permission.status === 'unavailable';
  const actionable = !granted && !unavailable;

  const statusColor = granted
    ? colors.success
    : unavailable
      ? colors.textFaint
      : permission.optional
        ? colors.textMuted
        : colors.accent;

  const statusLabel = granted
    ? 'Enabled'
    : unavailable
      ? 'Not applicable'
      : permission.optional
        ? 'Optional'
        : 'Required';

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: granted ? colors.successSoft : colors.surface,
          borderColor: granted ? 'transparent' : colors.border,
        },
      ]}
    >
      <View style={styles.head}>
        <View
          style={[
            styles.icon,
            { backgroundColor: granted ? 'transparent' : colors.surfaceMuted },
          ]}
        >
          <Text style={styles.iconGlyph}>{granted ? '✓' : permission.icon}</Text>
        </View>

        <View style={styles.headText}>
          <Text
            style={[
              styles.title,
              { color: granted ? colors.textMuted : colors.text },
            ]}
          >
            {permission.title}
          </Text>
          <Text style={[styles.status, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      {/* A granted permission does not need its reason re-explained. */}
      {granted ? null : (
        <Text style={[styles.rationale, { color: colors.textMuted }]}>
          {permission.rationale}
        </Text>
      )}

      {actionable ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Enable ${permission.title}`}
          testID={`enable-${permission.id}`}
          onPress={() => onEnable(permission)}
          style={[styles.button, { backgroundColor: colors.accent }]}
        >
          <Text style={[styles.buttonLabel, { color: colors.accentText }]}>Enable</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: { fontSize: 18 },
  headText: { flex: 1, gap: 1 },
  title: { ...typography.body, fontWeight: '700' },
  status: { ...typography.caption, fontSize: 12, fontWeight: '700' },
  rationale: { ...typography.caption, lineHeight: 19, marginTop: -spacing.xs },
  button: {
    alignSelf: 'flex-start',
    minHeight: HIT_SIZE - 8,
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
  },
  buttonLabel: { ...typography.label, fontWeight: '700' },
});
