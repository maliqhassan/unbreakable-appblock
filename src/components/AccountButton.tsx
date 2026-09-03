import { useNavigation } from '@react-navigation/native';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, typography, useTheme } from '../constants/theme';
import { useAuth } from '../hooks/useAuth';

/**
 * The header account control.
 *
 * Guests get a "Sign in" affordance; signed-in users get their avatar or
 * initials. Small on purpose — this is a focus app, and the account is not what
 * anyone opened it for.
 */
export function AccountButton() {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { user, isAuthenticated, isAvailable, isGuest } = useAuth();

  // Nothing useful to offer if this build has no auth configured at all.
  if (!isAvailable && !isAuthenticated) return null;

  if (!isAuthenticated) {
    // Someone who deliberately chose guest mode is not "not signed in yet" —
    // they made a choice. Label it, and route to Account where they can change
    // their mind, rather than nagging them with a sign-in prompt every launch.
    if (isGuest) {
      return (
        <Pressable
          testID="header-guest"
          accessibilityRole="button"
          accessibilityLabel="Guest account. Open account settings."
          onPress={() => navigation.navigate('Account')}
          hitSlop={8}
          style={[styles.guestChip, { borderColor: colors.border }]}
        >
          <Text style={[styles.guestLabel, { color: colors.textMuted }]}>Guest</Text>
        </Pressable>
      );
    }

    return (
      <Pressable
        testID="header-signin"
        accessibilityRole="button"
        accessibilityLabel="Sign in"
        onPress={() => navigation.navigate('Auth')}
        hitSlop={8}
      >
        <Text style={[styles.signIn, { color: colors.accentOnSurface }]}>Sign in</Text>
      </Pressable>
    );
  }

  const seed = user?.displayName ?? user?.email ?? '?';

  return (
    <Pressable
      testID="header-account"
      accessibilityRole="button"
      accessibilityLabel="Account"
      onPress={() => navigation.navigate('Account')}
      hitSlop={8}
    >
      {user?.photoUrl ? (
        <Image
          source={{ uri: user.photoUrl }}
          style={styles.avatar}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.avatar, { backgroundColor: colors.surfaceMuted }]}>
          <Text style={[styles.initials, { color: colors.textMuted }]}>
            {seed.charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  signIn: {
    ...typography.label,
  },
  guestChip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  guestLabel: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '600',
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontSize: 13,
    fontWeight: '700',
  },
});
