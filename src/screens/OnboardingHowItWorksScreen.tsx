import { StyleSheet, Text, View } from 'react-native';

import { OnboardingLayout } from '../components/OnboardingLayout';
import { PrimaryButton } from '../components/PrimaryButton';
import { radius, spacing, typography, useTheme } from '../constants/theme';
import type { ScreenProps } from '../navigation/types';

const STEPS = [
  {
    number: '01',
    title: 'Choose apps',
    body: 'Pick the apps that steal your attention.',
  },
  {
    number: '02',
    title: 'Set a lock',
    body: 'Choose how long you want to stay focused.',
  },
  {
    number: '03',
    title: 'Stay focused',
    body: 'Unbreakable Lock keeps your selected apps restricted until your timer ends.',
  },
] as const;

/**
 * Step 2 — three cards, then straight on.
 *
 * The third card is worded carefully: the *device* enforces the lock, using
 * permissions the user grants. That is what actually happens, and it sets up
 * the permission step rather than surprising them with it.
 */
export function OnboardingHowItWorksScreen({
  navigation,
}: ScreenProps<'OnboardingHowItWorks'>) {
  const { colors } = useTheme();

  return (
    <OnboardingLayout
      step={2}
      totalSteps={3}
      footer={
        <PrimaryButton
          testID="onboarding-how-continue"
          label="Continue"
          onPress={() => navigation.navigate('OnboardingPermissions')}
        />
      }
    >
      <Text style={[styles.title, { color: colors.text }]}>
        How Unbreakable Lock works
      </Text>

      <View style={styles.cards}>
        {STEPS.map((step) => (
          <View
            key={step.title}
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={[styles.iconWrap, { backgroundColor: colors.accentSoft }]}>
              <Text style={[styles.number, { color: colors.accentOnSurface }]}>{step.number}</Text>
            </View>
            <View style={styles.cardText}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>{step.title}</Text>
              <Text style={[styles.cardBody, { color: colors.textMuted }]}>{step.body}</Text>
            </View>
          </View>
        ))}
      </View>
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.display,
    marginTop: spacing.lg,
  },
  cards: {
    gap: spacing.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  cardText: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    ...typography.body,
    fontWeight: '600',
    fontSize: 17,
  },
  cardBody: {
    ...typography.caption,
    lineHeight: 19,
  },
});
