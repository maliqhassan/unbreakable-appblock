import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PermissionExplainer } from '../components/PermissionExplainer';
import { PrimaryButton } from '../components/PrimaryButton';
import { radius, spacing, typography, useTheme } from '../constants/theme';
import { usePermissionStatus } from '../hooks/usePermissionStatus';
import type { ScreenProps } from '../navigation/types';
import { PermissionService } from '../services/PermissionService';
import type { PermissionState } from '../types';
import { toLockError } from '../utils/errors';

/**
 * The requirements screen — the same permission flow as onboarding, reachable
 * later from Home or from a blocked lock attempt.
 *
 * It shares `usePermissionStatus` and `PermissionExplainer` with onboarding on
 * purpose: two screens that disagree about whether a permission is granted
 * would be worse than either one being wrong.
 */
export function PermissionsScreen({ navigation }: ScreenProps<'Permissions'>) {
  const { colors } = useTheme();
  const { permissions, missing, granted, total, ready, refresh } = usePermissionStatus();
  const [explaining, setExplaining] = useState<PermissionState | null>(null);

  const openSettings = useCallback(async () => {
    const permission = explaining;
    setExplaining(null);
    if (!permission) return;

    try {
      await PermissionService.request(permission.id);
    } catch (err) {
      Alert.alert(permission.title, toLockError(err).message);
    } finally {
      refresh();
    }
  }, [explaining, refresh]);

  return (
    <>
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>
              {ready ? 'Protection is ready' : 'Set up your protection'}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textMuted }]}>
              {ready
                ? 'Everything Unbreakable Lock needs is enabled. You can revoke any of these in Android Settings at any time.'
                : 'Allow the permissions below so Unbreakable Lock can enforce your focus sessions.'}
            </Text>
          </View>

          {total > 0 ? (
            <View
              accessibilityRole="progressbar"
              accessibilityLabel={
                ready
                  ? 'Protection is ready'
                  : `${granted} of ${total} permissions complete`
              }
              style={[
                styles.progress,
                {
                  backgroundColor: colors.surface,
                  borderColor: ready ? colors.success : colors.warning,
                },
              ]}
            >
              <Text
                style={[
                  styles.progressLabel,
                  { color: ready ? colors.success : colors.warning },
                ]}
              >
                {ready ? '✓ Protection is ready' : `${granted} of ${total} complete`}
              </Text>
            </View>
          ) : null}

          {permissions.map((permission) => (
            <PermissionCard
              key={permission.id}
              permission={permission}
              onPress={() => setExplaining(permission)}
            />
          ))}

          <Text style={[styles.footnote, { color: colors.textFaint }]}>
            Unbreakable Lock reads which app is in the foreground while a lock is running.
            It never reads screen contents, keystrokes, or anything inside the apps you
            block.
          </Text>
        </ScrollView>

        <View style={[styles.footer, { borderColor: colors.border }]}>
          <PrimaryButton
            testID="permissions-continue"
            label={ready ? 'Done' : 'Continue anyway'}
            caption={
              ready
                ? undefined
                : `${missing.length} permission${
                    missing.length === 1 ? '' : 's'
                  } still needed — no lock will start`
            }
            onPress={() => navigation.goBack()}
          />
        </View>
      </SafeAreaView>

      <PermissionExplainer
        permission={explaining}
        onContinue={() => void openSettings()}
        onCancel={() => setExplaining(null)}
      />
    </>
  );
}

function PermissionCard({
  permission,
  onPress,
}: {
  permission: PermissionState;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const granted = permission.status === 'granted';
  const unavailable = permission.status === 'unavailable';

  const statusLabel = granted
    ? '✓ Enabled'
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
          backgroundColor: colors.surface,
          borderColor: granted ? colors.success : colors.border,
        },
      ]}
    >
      <View style={styles.cardTop}>
        <View style={[styles.iconWrap, { backgroundColor: colors.surfaceMuted }]}>
          <Text style={styles.icon}>{permission.icon}</Text>
        </View>
        <View style={styles.cardText}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            {permission.title}
          </Text>
          <Text style={[styles.cardBody, { color: colors.textMuted }]}>
            {permission.rationale}
          </Text>
        </View>
      </View>

      <View style={styles.cardBottom}>
        <Text
          accessibilityLabel={`${permission.title}: ${statusLabel}`}
          style={[
            styles.status,
            {
              color: granted
                ? colors.success
                : unavailable
                  ? colors.textFaint
                  : permission.optional
                    ? colors.textMuted
                    : colors.danger,
            },
          ]}
        >
          {statusLabel}
        </Text>

        {!granted && !unavailable ? (
          <Pressable
            testID={`enable-${permission.id}`}
            accessibilityRole="button"
            accessibilityLabel={`Enable ${permission.title}`}
            onPress={onPress}
            style={({ pressed }) => [
              styles.enable,
              { borderColor: colors.accent, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.enableLabel, { color: colors.accent }]}>Enable</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  title: typography.display,
  subtitle: {
    ...typography.body,
    lineHeight: 23,
  },
  progress: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  progressLabel: {
    ...typography.label,
    fontSize: 15,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardTop: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 20 },
  cardText: { flex: 1, gap: 3 },
  cardTitle: {
    ...typography.body,
    fontWeight: '600',
  },
  cardBody: {
    ...typography.caption,
    lineHeight: 18,
  },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  status: {
    ...typography.caption,
    fontWeight: '700',
  },
  enable: {
    borderWidth: 1,
    borderRadius: radius.sm,
    minHeight: 44,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.gutter,
  },
  enableLabel: typography.label,
  footnote: {
    ...typography.caption,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
});
