import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PRIVACY_POLICY_URL } from '../constants/legal';
import { radius, spacing, typography, useTheme } from '../constants/theme';
import { sheetPadding } from './PermissionExplainer';
import { PrimaryButton } from './PrimaryButton';

interface Props {
  visible: boolean;
  onAgree: () => void;
  onCancel: () => void;
}

/**
 * What creating an account means, said before the account exists.
 *
 * Signing in is the only point at which this app sends anything about a person
 * anywhere, so it is the only point that needs an explicit "yes". Everything
 * else — the app list, usage figures, schedules, limits — stays on the device,
 * and asking permission to keep data on someone's own phone would be noise.
 *
 * Deliberately not shown for guest mode. A guest creates no account and hands
 * over nothing, so there is nothing for them to agree to; a consent gate there
 * would be a consent theatre that trains people to tap through.
 *
 * The agreement is recorded so it is asked once rather than at every sign-in.
 */
export function ConsentSheet({ visible, onAgree, onCancel }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const openPolicy = () => {
    void Linking.openURL(PRIVACY_POLICY_URL).catch(() => {});
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
      accessibilityViewIsModal
      statusBarTranslucent
      navigationBarTranslucent
    >
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
      >
        <Pressable
          testID="consent-sheet"
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              ...sheetPadding(insets),
            },
          ]}
          onPress={() => {}}
        >
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <Text style={[styles.eyebrow, { color: colors.textFaint }]}>
              Before you create an account
            </Text>
            <Text style={[styles.title, { color: colors.text }]}>
              What we&apos;ll know about you
            </Text>

            <View style={[styles.list, { backgroundColor: colors.surfaceMuted }]}>
              <Row
                icon="✉️"
                title="Your email address"
                body="Used to identify your account so a Pro subscription follows you to a new phone."
              />
              <Row
                icon="🙂"
                title="Your name and picture, with Google"
                body="Only if you choose Google Sign-In. Shown on this screen and nowhere else."
              />
              <Row
                icon="🔑"
                title="Never your password"
                body="Google Firebase handles sign-in. We never see or store it."
              />
            </View>

            <Text style={[styles.paragraph, { color: colors.textMuted }]}>
              Your blocked apps, schedules, daily limits and usage figures stay on this
              phone. They are never uploaded — there is no server of ours to upload them
              to.
            </Text>

            <Text style={[styles.paragraph, { color: colors.textMuted }]}>
              You can delete your account, and the data on this device with it, at any time
              from the Account screen.
            </Text>

            <Text
              testID="consent-policy-link"
              style={[styles.link, { color: colors.accent }]}
              onPress={openPolicy}
              accessibilityRole="link"
            >
              Read the full privacy policy
            </Text>
          </ScrollView>

          <View style={styles.actions}>
            <PrimaryButton testID="consent-agree" label="I agree" onPress={onAgree} />
            <PrimaryButton
              testID="consent-cancel"
              label="Cancel"
              variant="ghost"
              onPress={onCancel}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Row({ icon, title, body }: { icon: string; title: string; body: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <Text style={styles.rowIcon}>{icon}</Text>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.rowBody, { color: colors.textMuted }]}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    paddingTop: spacing.md,
    // Horizontal and bottom padding come from sheetPadding(), which absorbs the
    // safe-area insets so the buttons clear the navigation bar.
    maxHeight: '88%',
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: spacing.lg,
  },
  body: { gap: spacing.md, paddingBottom: spacing.lg },
  eyebrow: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  title: { ...typography.heading, marginTop: -spacing.xs },
  list: { borderRadius: radius.md, padding: spacing.lg, gap: spacing.lg },
  row: { flexDirection: 'row', gap: spacing.md },
  rowIcon: { fontSize: 18, marginTop: 1 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...typography.body, fontWeight: '700' },
  rowBody: { ...typography.caption, lineHeight: 19 },
  paragraph: { ...typography.caption, lineHeight: 20 },
  link: { ...typography.body, fontWeight: '600' },
  actions: { gap: spacing.sm, paddingTop: spacing.md },
});
