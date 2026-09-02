import { StyleSheet, Text, View } from 'react-native';

import { radius, useTheme } from '../constants/theme';

interface Props {
  checked: boolean;
  /** Dimmed when the row is gated behind Pro. */
  dimmed?: boolean;
}

/**
 * Presentational only — the whole row owns the press target, so this never
 * needs its own touchable (and never creates a second, smaller tap area).
 */
export function Checkbox({ checked, dimmed = false }: Props) {
  const { colors } = useTheme();

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.box,
        {
          borderColor: checked ? colors.accent : colors.border,
          backgroundColor: checked ? colors.accent : 'transparent',
          opacity: dimmed ? 0.4 : 1,
        },
      ]}
    >
      {checked ? <Text style={[styles.tick, { color: colors.accentText }]}>✓</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
});
