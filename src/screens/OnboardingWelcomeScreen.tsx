import { StyleSheet, Text, View } from 'react-native';

import { Logo } from '../components/Logo';
import { FadeIn } from '../components/motion';
import { OnboardingLayout } from '../components/OnboardingLayout';
import { PrimaryButton } from '../components/PrimaryButton';
import { spacing, typography, useTheme } from '../constants/theme';
import { useAuth } from '../hooks/useAuth';
import type { ScreenProps } from '../navigation/types';

/**
 * Step 1 — the only screen a brand-new user sees before deciding to continue.
 *
 * Deliberately does not ask for anything: no account, no permissions, no
 * pitch. Someone who has just installed the app has not yet decided they want
 * it, and a wall of requests is how you lose them at the door.
 */
export function OnboardingWelcomeScreen({ navigation }: ScreenProps<'OnboardingWelcome'>) {
  const { colors } = useTheme();
  const { isAvailable } = useAuth();

  return (
    <OnboardingLayout
      step={1}
      totalSteps={3}
      footer={
        <>
          <PrimaryButton
            testID="onboarding-get-started"
            label="Get Started"
            onPress={() => navigation.navigate('OnboardingHowItWorks')}
          />
          {isAvailable ? (
            <PrimaryButton
              testID="onboarding-login"
              label="Already have an account? Sign in"
              variant="ghost"
              onPress={() => navigation.navigate('Auth', { origin: 'onboarding' })}
            />
          ) : null}
        </>
      }
    >
      <View style={styles.hero}>
        <FadeIn>
          {/* The product mark rather than a stock padlock: the same interlocking
              rings as the launcher icon, so the first screen and the home
              screen icon are recognisably one thing. */}
          <View
            style={[
              styles.badge,
              { backgroundColor: colors.accentSoft, borderColor: colors.accent },
            ]}
          >
            <Logo size={56} color={colors.accent} />
          </View>
        </FadeIn>

        <FadeIn index={1} stagger={90}>
          <Text style={[styles.brand, { color: colors.textFaint }]}>UNBREAKABLE LOCK</Text>
          <Text style={[styles.title, { color: colors.text }]}>Take back your time.</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            Block distracting apps. Set limits. Stay focused.
          </Text>
        </FadeIn>
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
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: {
    ...typography.eyebrow,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.hero,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    fontSize: 17,
    lineHeight: 26,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
});
