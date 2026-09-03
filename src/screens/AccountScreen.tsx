import { useCallback, useState } from 'react';
import { Alert, Image, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { StatusBadge } from '../components/StatusBadge';
import { hasLink, PRIVACY_POLICY_URL } from '../constants/legal';
import { spacing, typography, useTheme } from '../constants/theme';
import { useAuth } from '../hooks/useAuth';
import { useSubscription } from '../hooks/useSubscription';
import type { ScreenProps } from '../navigation/types';
import { ConsentService } from '../services/ConsentService';
import { toLockError } from '../utils/errors';

const PROVIDER_LABEL: Record<string, string> = {
  google: 'Google',
  email: 'Email',
  anonymous: 'Guest',
};

/**
 * Account and subscription in one place.
 *
 * Note the separation on display here: identity comes from `useAuth`,
 * entitlement from `useSubscription`. Signing out never touches Pro status —
 * the subscription belongs to the store account that bought it, and RevenueCat
 * restores it when the user signs back in.
 */
export function AccountScreen({ navigation }: ScreenProps<'Account'>) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState<'signout' | 'restore' | 'delete' | null>(null);
  // UMP only requires the "privacy choices" entry point for users whose region
  // asked them for consent in the first place; it shows for them and nobody else.
  const [privacyOptionsRequired, setPrivacyOptionsRequired] = useState(
    ConsentService.current().privacyOptionsRequired
  );

  const { user, isAuthenticated, isAvailable, signOut, deleteAccount } = useAuth();
  const { isPro, status, subscription, restorePurchases } = useSubscription();

  const handlePrivacyPolicy = useCallback(() => {
    void Linking.openURL(PRIVACY_POLICY_URL).catch(() =>
      Alert.alert('Could not open the privacy policy', PRIVACY_POLICY_URL)
    );
  }, []);

  const handlePrivacyChoices = useCallback(() => {
    void ConsentService.showPrivacyOptions().then((state) =>
      setPrivacyOptionsRequired(state.privacyOptionsRequired)
    );
  }, []);

  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your account, along with the apps, schedules and daily limits saved on this device. It cannot be undone.\n\nA Pro subscription is billed by Google Play and is not cancelled by this — cancel it in the Play Store if you no longer want it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setBusy('delete');
            void deleteAccount()
              .catch((err: unknown) =>
                Alert.alert('Could not delete your account', toLockError(err).message)
              )
              .finally(() => setBusy(null));
          },
        },
      ]
    );
  }, [deleteAccount]);

  const handleSignOut = useCallback(() => {
    Alert.alert(
      'Log out?',
      'Your Pro subscription stays with your account and comes back when you sign in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log out',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy('signout');
              try {
                await signOut();
              } catch (err) {
                Alert.alert('Could not log out', toLockError(err).message);
              } finally {
                setBusy(null);
              }
            })();
          },
        },
      ]
    );
  }, [signOut]);

  const handleRestore = useCallback(async () => {
    setBusy('restore');
    try {
      const next = await restorePurchases();
      Alert.alert(
        next.tier === 'PRO' ? 'Pro restored' : 'Nothing to restore',
        next.tier === 'PRO'
          ? 'Your subscription is active again.'
          : 'No active Pro subscription was found for this Google account.'
      );
    } catch (err) {
      Alert.alert('Restore failed', toLockError(err).message);
    } finally {
      setBusy(null);
    }
  }, [restorePurchases]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {isAuthenticated && user ? (
          <View style={styles.profile}>
            <Avatar user={user} />
            <Text style={[styles.name, { color: colors.text }]}>
              {user.displayName ?? 'Signed in'}
            </Text>
            {user.email ? (
              <Text style={[styles.email, { color: colors.textMuted }]}>{user.email}</Text>
            ) : null}
            <StatusBadge
              label={`Signed in with ${PROVIDER_LABEL[user.provider] ?? user.provider}`}
              tone="neutral"
            />
          </View>
        ) : (
          <View style={styles.profile}>
            <View style={[styles.avatar, { backgroundColor: colors.surfaceMuted }]}>
              <Text style={styles.avatarIcon}>👤</Text>
            </View>
            <Text style={[styles.name, { color: colors.text }]}>Guest</Text>
            <Text style={[styles.email, { color: colors.textMuted }]}>
              You&apos;re using Unbreakable Lock as a guest.
            </Text>
          </View>
        )}

        <Card
          title="Subscription"
          subtitle={
            isPro
              ? undefined
              : 'Free plan: one app, any duration, Standard Mode, with ads.'
          }
        >
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: colors.textMuted }]}>Plan</Text>
            <Text style={[styles.rowValue, { color: isPro ? colors.success : colors.text }]}>
              {isPro ? 'Pro' : 'Free'}
            </Text>
          </View>

          {isPro ? (
            <View style={styles.row}>
              <Text style={[styles.rowLabel, { color: colors.textMuted }]}>Status</Text>
              <Text style={[styles.rowValue, { color: colors.text }]}>
                {status === 'cancelled'
                  ? 'Ends at period end'
                  : status === 'billingIssue'
                    ? 'Payment problem'
                    : 'Active'}
              </Text>
            </View>
          ) : null}

          {subscription.isSandbox ? (
            <Text style={[styles.note, { color: colors.warning }]}>
              Test purchase from a Play licence-tester account.
            </Text>
          ) : null}

          <View style={styles.actions}>
            <PrimaryButton
              testID="account-subscription"
              label={isPro ? 'Manage subscription' : 'Upgrade to Pro'}
              variant={isPro ? 'secondary' : 'primary'}
              onPress={() => navigation.navigate('Subscription')}
            />
            <PrimaryButton
              testID="account-restore"
              label="Restore Purchases"
              variant="ghost"
              loading={busy === 'restore'}
              disabled={busy != null}
              onPress={() => void handleRestore()}
            />
          </View>
        </Card>

        <Card
          title="Troubleshooting"
          subtitle="Check whether Android is letting the lock run."
        >
          <PrimaryButton
            testID="account-diagnostics"
            label="Open diagnostics"
            variant="secondary"
            onPress={() => navigation.navigate('Diagnostics')}
          />
        </Card>

        <Card
          title="Privacy"
          subtitle="What this app collects, and the choices you have about it."
        >
          <View style={styles.stack}>
            {hasLink(PRIVACY_POLICY_URL) ? (
              <PrimaryButton
                testID="account-privacy-policy"
                label="Privacy policy"
                variant="secondary"
                onPress={handlePrivacyPolicy}
              />
            ) : null}

            {privacyOptionsRequired ? (
              <PrimaryButton
                testID="account-privacy-choices"
                label="Privacy choices for ads"
                variant="secondary"
                onPress={handlePrivacyChoices}
              />
            ) : null}
          </View>
        </Card>

        {!isAuthenticated && isAvailable ? (
          <Card
            title="Create an account"
            subtitle="Keeps your Pro subscription with you if you change phone. The free tier works fine without one."
          >
            <PrimaryButton
              testID="account-signin"
              label="Sign in or create an account"
              onPress={() => navigation.navigate('Auth')}
            />
          </Card>
        ) : null}
      </ScrollView>

      {isAuthenticated ? (
        <View style={[styles.footer, { borderColor: colors.border }]}>
          <PrimaryButton
            testID="account-signout"
            label="Log out"
            variant="ghost"
            loading={busy === 'signout'}
            disabled={busy != null}
            onPress={handleSignOut}
          />
          {/* Play requires account deletion to be reachable from inside the
              app, not only by writing to support. */}
          <PrimaryButton
            testID="account-delete"
            label="Delete account"
            variant="danger"
            loading={busy === 'delete'}
            disabled={busy != null}
            onPress={handleDeleteAccount}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function Avatar({ user }: { user: { photoUrl: string | null; displayName: string | null; email: string | null } }) {
  const { colors } = useTheme();

  if (user.photoUrl) {
    return (
      <Image
        source={{ uri: user.photoUrl }}
        style={styles.avatar}
        accessibilityIgnoresInvertColors
      />
    );
  }

  const seed = user.displayName ?? user.email ?? '?';
  return (
    <View style={[styles.avatar, { backgroundColor: colors.surfaceMuted }]}>
      <Text style={[styles.initials, { color: colors.textMuted }]}>
        {seed.charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  safe: { flex: 1 },
  content: {
    padding: spacing.gutter,
    gap: spacing.lg,
  },
  profile: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarIcon: { fontSize: 30 },
  initials: {
    fontSize: 28,
    fontWeight: '600',
  },
  name: {
    ...typography.heading,
  },
  email: {
    ...typography.body,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  rowLabel: typography.body,
  rowValue: {
    ...typography.body,
    fontWeight: '600',
  },
  note: {
    ...typography.caption,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  actions: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
});
