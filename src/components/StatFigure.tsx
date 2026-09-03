import { StyleSheet, Text, View } from 'react-native';

import { typography, useTheme } from '../constants/theme';
import { splitDuration } from '../utils/screenTime';

interface Props {
  label: string;
  seconds: number;
  /** The hero figure on a card is larger than the ones beside it. */
  size?: 'regular' | 'large';
}

/**
 * A duration, written the way a stat should be read.
 *
 * The number carries the weight and the unit is set small beside it, so
 * "6h 35m" scans as a quantity rather than as a sentence. Getting this
 * consistent across the trends card and the insights screen is most of what
 * makes the two look like one design.
 */
export function StatFigure({ label, seconds, size = 'regular' }: Props) {
  const { colors } = useTheme();
  const parts = splitDuration(seconds);
  const big = size === 'large';

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text>
      <View style={styles.figure}>
        {parts.map((part) => (
          <View key={part.unit} style={styles.part}>
            <Text
              style={[
                big ? styles.valueLarge : styles.value,
                { color: colors.text },
              ]}
            >
              {part.value}
            </Text>
            <Text
              style={[
                big ? styles.unitLarge : styles.unit,
                { color: colors.textFaint },
              ]}
            >
              {part.unit}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  label: { ...typography.caption, fontSize: 13 },
  figure: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  part: { flexDirection: 'row', alignItems: 'flex-end' },
  value: { fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  unit: { fontSize: 13, fontWeight: '600', marginBottom: 3, marginLeft: 1 },
  valueLarge: { fontSize: 34, fontWeight: '800', letterSpacing: -0.8 },
  unitLarge: { fontSize: 15, fontWeight: '600', marginBottom: 4, marginLeft: 1 },
});
