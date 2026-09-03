import { StyleSheet, Text, View } from 'react-native';

import { HIT_SIZE, radius, spacing, typography, useTheme } from '../constants/theme';
import { PressableScale } from './motion';

interface Props {
  /** The formatted value, e.g. "15 min/day". This component does no maths. */
  value: string;
  /** Label under the value, e.g. "per day". */
  caption?: string;
  stepLabel: string;
  onDecrease: () => void;
  onIncrease: () => void;
  canDecrease: boolean;
  canIncrease: boolean;
  testID?: string;
}

/**
 * One control: decrease, the value, increase.
 *
 * Previously these were three separate elements sitting in a row — two small
 * buttons and a number between them — which read as three unrelated controls
 * that happened to be adjacent. Enclosing them in a single surface makes the
 * relationship obvious, and lets the value take the visual weight it deserves,
 * since the value is the thing the user is actually setting.
 *
 * The buttons dim rather than disappear at the ends of the range: a control
 * that changes shape as you use it is disorienting.
 */
export function Stepper({
  value,
  caption,
  stepLabel,
  onDecrease,
  onIncrease,
  canDecrease,
  canIncrease,
  testID,
}: Props) {
  const { colors } = useTheme();

  return (
    <View
      testID={testID}
      style={[
        styles.wrap,
        { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
      ]}
    >
      <Step
        label={`−${stepLabel}`}
        accessibilityLabel={`Decrease by ${stepLabel}`}
        onPress={onDecrease}
        enabled={canDecrease}
        testID="stepper-decrease"
      />

      <View style={styles.center}>
        <Text style={[styles.value, { color: colors.text }]} numberOfLines={1}>
          {value}
        </Text>
        {caption ? (
          <Text style={[styles.caption, { color: colors.textFaint }]}>{caption}</Text>
        ) : null}
      </View>

      <Step
        label={`+${stepLabel}`}
        accessibilityLabel={`Increase by ${stepLabel}`}
        onPress={onIncrease}
        enabled={canIncrease}
        testID="stepper-increase"
      />
    </View>
  );
}

function Step({
  label,
  accessibilityLabel,
  onPress,
  enabled,
  testID,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  enabled: boolean;
  testID: string;
}) {
  const { colors } = useTheme();

  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={[
        styles.step,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: enabled ? 1 : 0.4,
        },
      ]}
    >
      <Text style={[styles.stepLabel, { color: colors.text }]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.sm,
  },
  step: {
    minWidth: 72,
    minHeight: HIT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
  },
  stepLabel: { ...typography.label, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', gap: 1 },
  value: { ...typography.title, fontSize: 24, letterSpacing: -0.5 },
  caption: { ...typography.caption, fontSize: 12 },
});
