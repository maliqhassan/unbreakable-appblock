import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConsentSheet } from '../components/ConsentSheet';
import { Logo } from '../components/Logo';
import { FadeIn } from '../components/motion';
import { PrimaryButton } from '../components/PrimaryButton';
import { radius, spacing, typography, useTheme } from '../constants/theme';
import { useAuth } from '../hooks/useAuth';
import type { ScreenProps } from '../navigation/types';
import { StorageService } from '../services/StorageService';
import { toLockError } from '../utils/errors';

/**
 * Sign in, or don't.
 *
 * Guest is a first-class option, not a grudging escape hatch: the whole free
 * tier works without an account, and forcing registration to set a 30-minute
 * timer would be a tax on the user for our convenience. An account only buys
 * them one thing — a subscription that follows them to another device.
 */
export function AuthScreen({ navigation, route }: ScreenProps<'Auth'>) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);

  // Null until the stored answer is read, so the sheet cannot flash for someone
  // who agreed months ago.
  const [consented, setConsented] = useState<boolean | null>(null);
  const [askingConsent, setAskingConsent] = useState(false);
  // What to run once they agree -- the method they actually tapped.
  const pendingRef = useRef<(() => void) | null>(null);

  const {
    signInWithGoogle,
    continueAsGuest,
    isAvailable,
    isGoogleAvailable,
    isEmailAvailable,
  } = useAuth();

  const fromOnboarding = route.params?.origin === 'onboarding';

  const finish = useCallback(() => {
    if (fromOnboarding) {
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    } else {
      navigation.goBack();
    }
  }, [fromOnboarding, navigation]);

  const handleGoogle = useCallback(async () => {
    setBusy(true);
    try {
      await signInWithGoogle();
      finish();
    } catch (err) {
      const error = toLockError(err);
      // Backing out of the account picker is a normal action, not a failure.
      if (error.code !== 'AUTH_CANCELLED') {
        Alert.alert('Could not sign in', error.message);
      }
    } finally {
      setBusy(false);
    }
  }, [finish, signInWithGoogle]);

  const handleGuest = useCallback(async () => {
    // No account, nothing collected, nothing to agree to.
    await continueAsGuest();
    finish();
  }, [continueAsGuest, finish]);

  useEffect(() => {
    void StorageService.get<number>('accountConsentAt', 0).then((at) =>
      setConsented(at > 0)
    );
  }, []);

  /**
   * Runs a sign-in method, asking for agreement first if it has not been given.
   *
   * The gate is here rather than inside each method so there is one place that
   * decides an account may be created, and no path to an account that skips it.
   */
  const withConsent = useCallback(
    (proceed: () => void) => {
      if (consented) {
        proceed();
        return;
      }
      pendingRef.current = proceed;
      setAskingConsent(true);
    },
    [consented]
  );

  const handleAgree = useCallback(() => {
    setAskingConsent(false);
    setConsented(true);
    // Recorded so this is asked once, not at every sign-in.
    void StorageService.set('accountConsentAt', Date.now());

    const next = pendingRef.current;
    pendingRef.current = null;
    next?.();
  }, []);

  const handleDeclineConsent = useCallback(() => {
    setAskingConsent(false);
    pendingRef.current = null;
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.content}>
        <FadeIn style={styles.header}>
          <View style={[styles.badge, { backgroundColor: colors.accentSoft }]}>
            <Logo size={40} color={colors.accent} />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>Save your progress</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            Sign in to keep your Pro subscription with you when you switch phones.
            Everything else works without an account.
          </Text>
        </FadeIn>

        {!isAvailable ? (
          <View style={[styles.notice, { borderColor: colors.warning }]}>
            <Text style={[styles.noticeText, { color: colors.warning }]}>
              Sign-in is not configured in this build, so only guest mode is available.
            </Text>
          </View>
        ) : null}

        <View style={styles.options}>
          {isGoogleAvailable ? (
            <PrimaryButton
              testID="auth-google"
              label="Continue with Google"
              loading={busy}
              disabled={busy}
              onPress={() => withConsent(() => void handleGoogle())}
            />
          ) : null}

          {isGoogleAvailable && isEmailAvailable ? (
            <View style={styles.divider}>
              <View style={[styles.rule, { backgroundColor: colors.border }]} />
              <Text style={[styles.dividerLabel, { color: colors.textFaint }]}>OR</Text>
              <View style={[styles.rule, { backgroundColor: colors.border }]} />
            </View>
          ) : null}

          {isEmailAvailable ? (
            <PrimaryButton
              testID="auth-email"
              label="Continue with email"
              variant="secondary"
              disabled={busy}
              onPress={() => withConsent(() => navigation.navigate('EmailAuth'))}
            />
          ) : null}
        </View>
      </View>

      <View style={[styles.footer, { borderColor: colors.border }]}>
        <PrimaryButton
          testID="auth-guest"
          label="Continue as guest"
          variant="ghost"
          disabled={busy}
          onPress={() => void handleGuest()}
        />
        <Text style={[styles.guestNote, { color: colors.textFaint }]}>
          No account needed. You can sign in later from Account.
        </Text>
      </View>

      <ConsentSheet
        visible={askingConsent}
        onAgree={handleAgree}
        onCancel={handleDeclineConsent}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    flex: 1,
    padding: spacing.gutter,
    gap: spacing.xxl,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    gap: spacing.md,
  },
  badge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestNote: {
    ...typography.caption,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  title: {
    ...typography.title,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    textAlign: 'center',
    lineHeight: 23,
  },
  options: {
    gap: spacing.md,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerLabel: {
    ...typography.caption,
    fontWeight: '600',
    letterSpacing: 1,
  },
  notice: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  noticeText: {
    ...typography.caption,
    lineHeight: 18,
  },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
});
