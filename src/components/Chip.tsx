import { StyleSheet, Text } from 'react-native';

import { HIT_SIZE, radius, spacing, typography, useTheme } from '../constants/theme';
import { PressableScale } from './motion';

interface Props {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}

/**
 * A single choice from a short row of them — duration presets, mostly.
 *
 * Selection is carried by a tinted fill and an accent border rather than by a
 * solid block of colour. A row of chips where the chosen one is fully filled
 * reads as a row of buttons with one pressed; this reads as a choice.
 *
 * The 44pt minimum height is not decoration: chips are the smallest tap target
 * in the app and the easiest to get wrong.
 */
export function Chip({ label, selected, onPress, disabled = false, testID }: Props) {
  const { colors } = useTheme();

  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.surfaceSelected : colors.surfaceMuted,
          borderColor: selected ? colors.accent : 'transparent',
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.label,
          { color: selected ? colors.text : colors.textMuted },
          selected && styles.labelSelected,
        ]}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: HIT_SIZE - 4,
    justifyContent: 'center',
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
  },
  label: { ...typography.label, textAlign: 'center' },
  labelSelected: { fontWeight: '700' },
});
