import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { PermissionRow } from '../components/PermissionRow';
import { OnboardingLayout } from '../components/OnboardingLayout';
import { PermissionExplainer } from '../components/PermissionExplainer';
import { SetupProgress } from '../components/SetupProgress';
import { FadeIn } from '../components/motion';
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
            label={ready ? 'Continue' : 'Continue anyway'}
            caption={
              ready
                ? undefined
                : `${missing.length} still needed — no lock can start yet`
            }
            onPress={() => void finish()}
          />
        }
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Protect your focus</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            Give Unbreakable Lock the permissions it needs to enforce your focus
            sessions. You can change these any time.
          </Text>
        </View>

        <SetupProgress completed={granted} total={total} />

        <View style={styles.rows}>
          {permissions.map((permission, index) => (
            <FadeIn key={permission.id} index={index}>
              <PermissionRow
                permission={permission}
                onEnable={() => setExplaining(permission)}
              />
            </FadeIn>
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
