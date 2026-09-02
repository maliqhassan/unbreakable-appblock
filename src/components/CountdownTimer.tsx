import { Platform, StyleSheet, Text, View } from 'react-native';

import { spacing, typography, useTheme } from '../constants/theme';
import { useCountdown } from '../hooks/useCountdown';
import { formatClockTime } from '../utils/time';

interface Props {
  /** Absolute epoch ms. The only input — never a duration. */
  endTimestamp: number;
  onExpire?: () => void;
  /** Shown under the digits, e.g. "Lock ends at 6:30 PM". */
  showEndTime?: boolean;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function CountdownTimer({ endTimestamp, onExpire, showEndTime = true }: Props) {
  const { colors } = useTheme();
  const remaining = useCountdown(endTimestamp, onExpire);

  const text = `${pad(remaining.hours)}:${pad(remaining.minutes)}:${pad(remaining.seconds)}`;

  return (
    <View style={styles.container}>
      <Text
        testID="countdown"
        accessibilityRole="timer"
        accessibilityLabel={`${remaining.hours} hours, ${remaining.minutes} minutes, ${remaining.seconds} seconds remaining`}
        style={[styles.digits, { color: colors.text }]}
      >
        {text}
      </Text>
      {showEndTime ? (
        <Text style={[styles.endTime, { color: colors.textMuted }]}>
          Ends at {formatClockTime(endTimestamp)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  digits: {
    ...typography.display,
    // Tabular figures stop the digits shuffling sideways every second.
    fontVariant: ['tabular-nums'],
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  endTime: {
    ...typography.body,
    marginTop: spacing.sm,
  },
});
