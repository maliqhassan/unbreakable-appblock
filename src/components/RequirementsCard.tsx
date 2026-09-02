import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, spacing, typography, useTheme } from '../constants/theme';
import type { PermissionState } from '../types';

interface Props {
  permissions: PermissionState[];
  onOpenPermissions: () => void;
}

/**
 * The pre-flight check shown before a lock can start.
 *
 * The point is that the user finds out enforcement is impossible *here*, while
 * they are still configuring, rather than after pressing Start and believing
 * they are protected. A lock that cannot block anything is never started
 * silently.
 */
export function RequirementsCard({ permissions, onOpenPermissions }: Props) {
  const { colors } = useTheme();

  const required = permissions.filter((p) => !p.optional);
  const missing = required.filter(
    (p) => p.status !== 'granted' && p.status !== 'unavailable'
  );
  const ready = missing.length === 0;

  if (required.length === 0) return null;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: ready ? colors.border : colors.danger,
        },
      ]}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Requirements</Text>
        <Text style={[styles.summary, { color: ready ? colors.success : colors.danger }]}>
          {ready ? 'Ready' : `${missing.length} missing`}
        </Text>
      </View>

      {required.map((permission) => {
        const granted = permission.status === 'granted';
        return (
          <View key={permission.id} style={styles.row}>
            <Text
              style={[
                styles.mark,
                { color: granted ? colors.success : colors.danger },
              ]}
            >
              {granted ? '●' : '○'}
            </Text>
            <Text style={[styles.label, { color: colors.text }]}>{permission.title}</Text>
            <Text
              style={[
                styles.state,
                { color: granted ? colors.textFaint : colors.danger },
              ]}
            >
              {granted ? 'Enabled' : 'Not enabled'}
            </Text>
          </View>
        );
      })}

      {!ready ? (
        <>
          <Text style={[styles.explain, { color: colors.textMuted }]}>
            Without these, Android will not let this app block anything. The lock will not
            start until they are granted.
          </Text>
          <Pressable
            testID="open-permissions"
            accessibilityRole="button"
            onPress={onOpenPermissions}
            style={({ pressed }) => [
              styles.button,
              { borderColor: colors.accent, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.buttonLabel, { color: colors.accent }]}>Open Settings</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: typography.heading,
  summary: {
    ...typography.caption,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 5,
  },
  mark: {
    fontSize: 12,
    width: 14,
  },
  label: {
    ...typography.body,
    flex: 1,
  },
  state: typography.caption,
  explain: {
    ...typography.caption,
    lineHeight: 18,
    marginTop: spacing.md,
  },
  button: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  buttonLabel: typography.label,
});
