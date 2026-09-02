import { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '../components/PrimaryButton';
import { radius, spacing, typography, useTheme } from '../constants/theme';
import { useAuth } from '../hooks/useAuth';
import type { ScreenProps } from '../navigation/types';
import { toLockError } from '../utils/errors';

/**
 * Passwordless email sign-in.
 *
 * **This is a link, not a code.** Firebase Authentication has no email OTP
 * mechanism — its supported passwordless email method sends a one-time sign-in
 * link. Showing a six-digit input would mean building our own mail service and
 * code store, which is exactly the custom auth backend this app does not have.
 *
 * So the copy tells the truth: check your inbox, tap the link, come back.
 */
export function EmailAuthScreen({ navigation }: ScreenProps<'EmailAuth'>) {
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { sendEmailLink } = useAuth();

  const send = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await sendEmailLink(email);
      setSent(true);
    } catch (err) {
      // Never log the address or anything from the auth response.
      setError(toLockError(err).message);
    } finally {
      setBusy(false);
    }
  }, [email, sendEmailLink]);

  const resend = useCallback(async () => {
    setBusy(true);
    try {
      await sendEmailLink(email);
      Alert.alert('Link sent', 'Check your inbox again.');
    } catch (err) {
      Alert.alert('Could not resend', toLockError(err).message);
    } finally {
      setBusy(false);
    }
  }, [email, sendEmailLink]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          {sent ? (
            <>
              <Text style={[styles.title, { color: colors.text }]}>Check your email</Text>
              <Text style={[styles.body, { color: colors.textMuted }]}>
                We sent a sign-in link to{' '}
                <Text style={{ color: colors.text, fontWeight: '600' }}>{email}</Text>.
                Open it on this device and you will be signed in automatically.
              </Text>
              <Text style={[styles.hint, { color: colors.textFaint }]}>
                The link expires after a while, and can only be used once. If it does not
                arrive, check your spam folder.
              </Text>
            </>
          ) : (
            <>
              <Text style={[styles.title, { color: colors.text }]}>
                Continue with email
              </Text>
              <Text style={[styles.body, { color: colors.textMuted }]}>
                We will email you a one-time sign-in link. No password to create, none to
                forget.
              </Text>

              <View
                style={[
                  styles.inputWrap,
                  {
                    backgroundColor: colors.surface,
                    borderColor: error ? colors.danger : colors.border,
                  },
                ]}
              >
                <TextInput
                  testID="email-input"
                  accessibilityLabel="Email address"
                  value={email}
                  onChangeText={(next) => {
                    setEmail(next);
                    setError(null);
                  }}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.textFaint}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  inputMode="email"
                  style={[styles.input, { color: colors.text }]}
                />
              </View>

              {error ? (
                <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>
              ) : null}
            </>
          )}
        </View>

        <View style={[styles.footer, { borderColor: colors.border }]}>
          {sent ? (
            <>
              <PrimaryButton
                testID="email-resend"
                label="Resend link"
                loading={busy}
                disabled={busy}
                onPress={() => void resend()}
              />
              <PrimaryButton
                testID="email-change"
                label="Change email"
                variant="ghost"
                disabled={busy}
                onPress={() => {
                  setSent(false);
                  setError(null);
                }}
              />
            </>
          ) : (
            <PrimaryButton
              testID="email-send"
              label="Send link"
              loading={busy}
              disabled={busy || email.trim().length === 0}
              onPress={() => void send()}
            />
          )}
          <PrimaryButton
            label="Back"
            variant="ghost"
            disabled={busy}
            onPress={() => navigation.goBack()}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  content: {
    flex: 1,
    padding: spacing.lg,
    gap: spacing.md,
    justifyContent: 'center',
  },
  title: typography.title,
  body: {
    ...typography.body,
    lineHeight: 23,
  },
  hint: {
    ...typography.caption,
    lineHeight: 18,
  },
  inputWrap: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  input: {
    ...typography.body,
    minHeight: 52,
    paddingVertical: 0,
  },
  error: typography.caption,
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
});
