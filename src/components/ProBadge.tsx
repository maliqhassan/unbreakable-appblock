import { StyleSheet, Text } from 'react-native';

import { radius, typography, useTheme } from '../constants/theme';

/**
 * Marks a Pro-only feature.
 *
 * Small and quiet on purpose. The badge's job is to answer "why can't I turn
 * this on?" at the moment the question occurs — not to sell. The paywall is
 * reached by trying the feature, which is a better pitch than a banner.
 */
export function ProBadge({ testID }: { testID?: string }) {
  const { colors } = useTheme();

  return (
    <Text
      testID={testID}
      accessibilityLabel="Pro feature"
      style={[
        styles.badge,
        { backgroundColor: colors.accentSoft, color: colors.accentOnSurface },
      ]}
    >
      PRO
    </Text>
  );
}

const styles = StyleSheet.create({
  badge: {
    ...typography.eyebrow,
    fontSize: 10,
    letterSpacing: 0.8,
    borderRadius: radius.sm,
    paddingHorizontal: 7,
    paddingVertical: 3,
    overflow: 'hidden',
  },
});
