import { StyleSheet, Text, View } from 'react-native';

import { spacing, typography, useTheme } from '../constants/theme';

interface Props {
  completed: number;
  total: number;
  label?: string;
}

/**
 * How far through setup you are.
 *
 * A row of segments rather than a boxed "1 of 3 complete" panel. The old panel
 * was the heaviest element on the permissions screen while carrying the least
 * information — it competed with the permissions themselves, which are the
 * things the user actually has to act on.
 *
 * Segments fill left to right and the count sits underneath, small.
 */
export function SetupProgress({ completed, total, label = 'Setup' }: Props) {
  const { colors } = useTheme();
  const safeTotal = Math.max(1, total);
  const done = Math.min(Math.max(0, completed), safeTotal);
  const finished = done >= safeTotal;

  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${label}: ${done} of ${safeTotal} complete`}
    >
      <View style={styles.track}>
        {Array.from({ length: safeTotal }, (_, index) => (
          <View
            key={index}
            style={[
              styles.segment,
              {
                backgroundColor:
                  index < done
                    ? finished
                      ? colors.success
                      : colors.accent
                    : colors.surfaceMuted,
              },
            ]}
          />
        ))}
      </View>

      <Text style={[styles.count, { color: colors.textMuted }]}>
        {finished ? 'All set' : `${done} of ${safeTotal} complete`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  track: { flexDirection: 'row', gap: 6 },
  segment: { flex: 1, height: 5, borderRadius: 3 },
  count: { ...typography.caption, fontSize: 12 },
});
