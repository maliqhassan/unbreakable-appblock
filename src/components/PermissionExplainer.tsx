import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, spacing, typography, useTheme } from '../constants/theme';
import type { PermissionState } from '../types';
import { PrimaryButton } from './PrimaryButton';

interface Props {
  permission: PermissionState | null;
  onContinue: () => void;
  onCancel: () => void;
}

export interface Insets {
  bottom: number;
  left: number;
  right: number;
}

/**
 * Padding for a sheet that is anchored to the bottom of the screen.
 *
 * The app targets SDK 36, where Android forces edge-to-edge, so this sheet
 * draws *behind* the navigation bar. Padding by the inset is what keeps the
 * bottom button clear of the gesture pill or the three nav buttons — without it
 * the button is under them and simply cannot be tapped.
 *
 * The inset is added to the sheet's own padding rather than replacing it, so
 * the button never ends up flush against the system bar.
 */
export function sheetPadding(insets: Insets) {
  return {
    paddingBottom: spacing.xl + Math.max(insets.bottom, 0),
    // Landscape puts the navigation bar on one side.
    paddingLeft: spacing.xl + Math.max(insets.left, 0),
    paddingRight: spacing.xl + Math.max(insets.right, 0),
  };
}

/**
 * Explains a permission before Android's Settings screen opens.
 *
 * This exists because Usage Access and overlay permission have **no runtime
 * dialog** — Android only offers a Settings page, and the user arrives there
 * with no idea why. Explaining first, in our own words, is the difference
 * between an informed grant and a confused one.
 *
 * It is explicitly *not* a fake permission prompt: it never claims to grant
 * anything, and the only action it offers is "take me to Settings". The privacy
 * note is not decoration either — telling someone what a permission *cannot* do
 * is usually what they actually want to know.
 */
export function PermissionExplainer({ permission, onContinue, onCancel }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={permission != null}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
      accessibilityViewIsModal
      // The app targets SDK 36, where Android forces edge-to-edge, so this
      // window draws *behind* the navigation bar. Declaring that explicitly
      // rather than relying on the default keeps the inset maths below correct
      // on every Android version, instead of only the newest.
      statusBarTranslucent
      navigationBarTranslucent
    >
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
      >
        {/* Swallow taps on the sheet so they do not dismiss it. */}
        <Pressable
          testID="explainer-sheet"
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

          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.titleRow}>
              <View style={[styles.iconWrap, { backgroundColor: colors.surfaceMuted }]}>
                <Text style={styles.icon}>{permission?.icon ?? '🔐'}</Text>
              </View>
              <View style={styles.titleText}>
                <Text style={[styles.eyebrow, { color: colors.textFaint }]}>
                  Why we need this
                </Text>
                <Text style={[styles.title, { color: colors.text }]}>
                  {permission?.title}
                </Text>
              </View>
            </View>

            <Text style={[styles.paragraph, { color: colors.textMuted }]}>
              {permission?.explanation}
            </Text>

            <View style={[styles.privacy, { backgroundColor: colors.surfaceMuted }]}>
              <Text style={[styles.privacyText, { color: colors.textMuted }]}>
                {permission?.privacyNote}
              </Text>
            </View>

            <Text style={[styles.paragraph, { color: colors.textFaint }]}>
              Android only lets you turn this on from its own Settings screen, so
              Continue opens it. Come back here afterwards and it updates by itself.
            </Text>
          </ScrollView>

          <View style={styles.actions}>
            <PrimaryButton
              testID="explainer-continue"
              label="Continue"
              onPress={onContinue}
            />
            <PrimaryButton
              testID="explainer-cancel"
              label="Not now"
              variant="ghost"
              onPress={onCancel}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    paddingTop: spacing.md,
    // Horizontal and bottom padding are applied inline, because they have to
    // absorb the safe-area insets.
    maxHeight: '85%',
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: spacing.lg,
  },
  body: {
    gap: spacing.lg,
    paddingBottom: spacing.lg,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 22 },
  titleText: { flex: 1, gap: 2 },
  eyebrow: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  title: typography.heading,
  paragraph: {
    ...typography.body,
    lineHeight: 23,
  },
  privacy: {
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  privacyText: {
    ...typography.caption,
    lineHeight: 20,
  },
  actions: {
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
});
