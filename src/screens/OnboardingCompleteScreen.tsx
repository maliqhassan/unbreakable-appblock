import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { OnboardingLayout } from '../components/OnboardingLayout';
import { PrimaryButton } from '../components/PrimaryButton';
import { spacing, typography, useTheme } from '../constants/theme';
import { useAppForeground } from '../hooks/useAppForeground';
import { useAuth } from '../hooks/useAuth';
import type { ScreenProps } from '../navigation/types';
import { PermissionService } from '../services/PermissionService';
import { useUserStore } from '../store/useUserStore';

/**
 * The end of onboarding.
 *
 * Says one of two honest things: setup is complete, or it is not and here is
 * what is missing. It never congratulates the user on a setup that will not
 * actually enforce anything.
 */
export function OnboardingCompleteScreen({
  navigation,
}: ScreenProps<'OnboardingComplete'>) {
  const { colors } = useTheme();
  const [missing, setMissing] = useState(() => PermissionService.missingRequired());
  const completeOnboarding = useUserStore((s) => s.completeOnboarding);
  const { isAvailable, isAuthenticated } = useAuth();

  useAppForeground(() => setMissing(PermissionService.missingRequired()));

  const ready = missing.length === 0;

  const goHome = useCallback(async () => {
    await completeOnboarding();
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  }, [completeOnboarding, navigation]);

  const goToAuth = useCallback(async () => {
    await completeOnboarding();
    navigation.reset({
      index: 1,
      routes: [{ name: 'Home' }, { name: 'Auth', params: { origin: 'onboarding' } }],
    });
  }, [completeOnboarding, navigation]);

  // Offering an account is pointless if this build has no Firebase config.
  const canOfferAccount = isAvailable && !isAuthenticated;

  return (
    <OnboardingLayout
      footer={
        <>
          <PrimaryButton
            testID="onboarding-finish"
            label={canOfferAccount ? 'Create an account' : 'Start using Unbreakable Lock'}
            onPress={() => void (canOfferAccount ? goToAuth() : goHome())}
          />
          {canOfferAccount ? (
            <PrimaryButton
              testID="onboarding-skip-account"
              label="Continue without an account"
              variant="ghost"
              onPress={() => void goHome()}
            />
          ) : null}
        </>
      }
    >
      <View style={styles.hero}>
        <View
          style={[
            styles.badge,
            { backgroundColor: ready ? colors.surfaceMuted : colors.surface,
              borderColor: ready ? 'transparent' : colors.warning,
              borderWidth: ready ? 0 : 1 },
          ]}
        >
          <Text style={styles.badgeIcon}>{ready ? '✓' : '!'}</Text>
        </View>

        <Text style={[styles.title, { color: colors.text }]}>
          {ready ? "You're all set" : 'Setup is not finished'}
        </Text>

        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          {ready
            ? 'Your device is ready for Unbreakable Lock.'
            : `${missing.length} permission${missing.length === 1 ? '' : 's'} still needed. ` +
              'You can explore the app, but a lock will not start until they are granted.'}
        </Text>

        {!ready ? (
          <View style={styles.missingList}>
            {missing.map((permission) => (
              <Text
                key={permission.id}
                style={[styles.missingItem, { color: colors.warning }]}
              >
                ○ {permission.title}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  badge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeIcon: {
    fontSize: 40,
    fontWeight: '700',
  },
  title: {
    ...typography.title,
    fontSize: 30,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    lineHeight: 24,
    textAlign: 'center',
  },
  missingList: {
    gap: spacing.xs,
    alignItems: 'center',
  },
  missingItem: {
    ...typography.body,
    fontWeight: '600',
  },
});
