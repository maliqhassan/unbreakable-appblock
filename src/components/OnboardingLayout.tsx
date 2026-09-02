import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { spacing, useTheme } from '../constants/theme';

interface Props {
  children: ReactNode;
  /** Buttons pinned to the bottom, outside the scroll area. */
  footer: ReactNode;
  /** 1-based step, for the progress dots. Omit to hide them. */
  step?: number;
  totalSteps?: number;
}

/**
 * The common frame for every onboarding step.
 *
 * One layout for all steps so the CTA never shifts position between screens —
 * the button should be exactly where the thumb already is.
 */
export function OnboardingLayout({ children, footer, step, totalSteps }: Props) {
  const { colors } = useTheme();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {step && totalSteps ? (
        <View style={styles.dots}>
          {Array.from({ length: totalSteps }, (_, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                {
                  backgroundColor: index < step ? colors.accent : colors.surfaceMuted,
                  width: index === step - 1 ? 22 : 6,
                },
              ]}
            />
          ))}
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>{footer}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.lg,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.xl,
    flexGrow: 1,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },
});
