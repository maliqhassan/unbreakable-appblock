import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { OnboardingLayout } from '../components/OnboardingLayout';
import { PermissionExplainer } from '../components/PermissionExplainer';
import { PrimaryButton } from '../components/PrimaryButton';
import { radius, spacing, typography, useTheme } from '../constants/theme';
import { usePermissionStatus } from '../hooks/usePermissionStatus';
import type { ScreenProps } from '../navigation/types';
import { PermissionService } from '../services/PermissionService';
import { StorageService } from '../services/StorageService';
import type { PermissionState } from '../types';
import { toLockError } from '../utils/errors';

/**
 * Step 3 — permission setup, and the screen that decides whether this app can
 * do its job at all.
 *
 * Nothing here fakes a permission dialog. Usage Access and overlay have no
 * runtime prompt on Android; the only route is a Settings screen. So each row
 * opens an explanation first, then Android's own page, and the status
 * re-checks automatically on return.
 *
 * There is no "I enabled it" control anywhere. The app determines the real
 * state itself, every time.
 */
export function OnboardingPermissionsScreen({
  navigation,
}: ScreenProps<'OnboardingPermissions'>) {
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

  const finish = useCallback(async () => {
    // Records that the step was *seen*, never that permissions were granted —
    // that is always re-read from Android.
    await StorageService.set('permissionsSetupCompleted', true);
    navigation.navigate('OnboardingComplete');
  }, [navigation]);

  return (
    <>
      <OnboardingLayout
        step={3}
        totalSteps={3}
        footer={
          <PrimaryButton
            testID="onboarding-permissions-continue"
            label="Continue"
            caption={
              ready
                ? undefined
                : `${missing.length} still needed — you can finish this later`
            }
            onPress={() => void finish()}
          />
        }
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>
            Set up your protection
          </Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            Allow the permissions below so Unbreakable Lock can enforce your focus
            sessions.
          </Text>
        </View>

        <ProgressSummary granted={granted} total={total} ready={ready} />

        <View style={styles.rows}>
          {permissions.map((permission) => (
            <PermissionCard
              key={permission.id}
              permission={permission}
              onPress={() => setExplaining(permission)}
            />
          ))}
        </View>
      </OnboardingLayout>

      <PermissionExplainer
        permission={explaining}
        onContinue={() => void openSettings()}
        onCancel={() => setExplaining(null)}
      />
    </>
  );
}

/**
 * Progress, derived rather than hardcoded.
 *
 * The count comes from the live permission list, so adding or removing a
 * required permission changes this automatically instead of leaving a stale
 * "of 3" behind.
 */
function ProgressSummary({
  granted,
  total,
  ready,
}: {
  granted: number;
  total: number;
  ready: boolean;
}) {
  const { colors } = useTheme();
  const fraction = total === 0 ? 1 : granted / total;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={
        ready ? 'Protection is ready' : `${granted} of ${total} permissions complete`
      }
      style={[
        styles.progress,
        {
          backgroundColor: colors.surface,
          borderColor: ready ? colors.success : colors.border,
        },
      ]}
    >
      <Text
        style={[styles.progressLabel, { color: ready ? colors.success : colors.text }]}
      >
        {ready ? '✓ Protection is ready' : `${granted} of ${total} complete`}
      </Text>

      <View style={[styles.track, { backgroundColor: colors.surfaceMuted }]}>
        <View
          style={[
            styles.fill,
            {
              backgroundColor: ready ? colors.success : colors.accent,
              width: `${Math.round(fraction * 100)}%`,
            },
          ]}
        />
      </View>
    </View>
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
          // Screen readers get the permission name with its state, so the
          // status is never an orphaned "Required" with no referent.
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
            testID={`permission-${permission.id}`}
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
  header: {
    gap: spacing.sm,
    marginTop: spacing.md,
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
    gap: spacing.md,
  },
  progressLabel: {
    ...typography.label,
    fontSize: 15,
  },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  fill: {
    height: 6,
    borderRadius: 3,
  },
  rows: {
    gap: spacing.md,
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
  cardText: {
    flex: 1,
    gap: 3,
  },
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
    // 44pt minimum touch target.
    minHeight: 44,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.gutter,
  },
  enableLabel: typography.label,
});
