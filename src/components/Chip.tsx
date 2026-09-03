import { Animated, StyleSheet, Text } from 'react-native';

import { HIT_SIZE, radius, spacing, typography, useTheme } from '../constants/theme';
import { PressableScale, useAnimatedProgress } from './motion';

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

  // The tint and the border cross-fade together, so picking a different preset
  // reads as one selection moving rather than two chips blinking.
  const on = useAnimatedProgress(selected ? 1 : 0);

  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, { opacity: disabled ? 0.5 : 1 }]}
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.fill,
          {
            backgroundColor: on.interpolate({
              inputRange: [0, 1],
              outputRange: [colors.surfaceMuted, colors.surfaceSelected],
            }),
            borderColor: on.interpolate({
              inputRange: [0, 1],
              outputRange: ['rgba(0,0,0,0)', colors.accent],
            }),
          },
        ]}
      />
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
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    overflow: 'hidden',
  },
  // The animated layer carries the fill and border so both can interpolate.
  fill: { borderWidth: 1.5, borderRadius: radius.pill },
  label: { ...typography.label, textAlign: 'center' },
  labelSelected: { fontWeight: '700' },
});
