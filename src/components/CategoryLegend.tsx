import { StyleSheet, Text, View } from 'react-native';

import { spacing, typography, useTheme } from '../constants/theme';
import { formatDuration, type CategoryTotal } from '../utils/screenTime';

interface Props {
  categories: CategoryTotal[];
  /** Three fits a phone width without wrapping into a second row of noise. */
  limit?: number;
}

/**
 * The day's biggest categories, named in their own colour.
 *
 * This is the chart's key, so it sits directly under it — a legend a scroll
 * away from the thing it explains is not a legend. The colour is carried by the
 * label itself rather than a separate swatch: one element instead of two, and
 * the name is what the eye is looking for anyway.
 */
export function CategoryLegend({ categories, limit = 3 }: Props) {
  const { colors } = useTheme();
  const shown = categories.slice(0, limit);

  if (shown.length === 0) return null;

  return (
    <View style={styles.row}>
      {shown.map((category) => (
        <View key={category.id} style={styles.item}>
          <Text style={[styles.label, { color: category.color }]} numberOfLines={1}>
            {category.label}
          </Text>
          <Text style={[styles.value, { color: colors.text }]}>
            {formatDuration(category.seconds)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.lg },
  item: { flex: 1, gap: 1 },
  label: { ...typography.body, fontSize: 15, fontWeight: '600' },
  value: { ...typography.body, fontSize: 17, fontWeight: '700' },
});
