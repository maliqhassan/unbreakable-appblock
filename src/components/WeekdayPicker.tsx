import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, spacing, typography, useTheme } from '../constants/theme';
import type { Weekday } from '../types';
import { WEEKDAY_INITIAL, WEEKDAY_ORDER, WEEKDAY_SHORT } from '../utils/schedule';

interface Props {
  value: Weekday[];
  onChange: (days: Weekday[]) => void;
}

const WEEKDAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const WEEKEND: Weekday[] = ['saturday', 'sunday'];

/**
 * Day-of-week selector.
 *
 * The shortcuts are presentation only — the stored value is always the explicit
 * list of weekdays, never "weekdays" as a concept. That keeps the recurrence
 * model dumb and the engine simple: it only ever asks "is today in this set?"
 */
export function WeekdayPicker({ value, onChange }: Props) {
  const { colors } = useTheme();
  const selected = new Set(value);

  const toggle = (day: Weekday) => {
    const next = new Set(selected);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    onChange(WEEKDAY_ORDER.filter((d) => next.has(d)));
  };

  const setAll = (days: Weekday[]) => onChange(days);

  const shortcuts: { label: string; days: Weekday[] }[] = [
    { label: 'Weekdays', days: WEEKDAYS },
    { label: 'Weekends', days: WEEKEND },
    { label: 'Every day', days: WEEKDAY_ORDER },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {WEEKDAY_ORDER.map((day) => {
          const on = selected.has(day);
          return (
            <Pressable
              key={day}
              testID={`day-${day}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={WEEKDAY_SHORT[day]}
              onPress={() => toggle(day)}
              style={[
                styles.day,
                {
                  backgroundColor: on ? colors.accent : colors.surface,
                  borderColor: on ? colors.accent : colors.border,
                },
              ]}
            >
              <Text
                style={[styles.dayLabel, { color: on ? colors.accentText : colors.text }]}
              >
                {WEEKDAY_INITIAL[day]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.shortcuts}>
        {shortcuts.map((shortcut) => (
          <Pressable
            key={shortcut.label}
            testID={`shortcut-${shortcut.label.toLowerCase().replace(' ', '-')}`}
            accessibilityRole="button"
            accessibilityLabel={`Select ${shortcut.label}`}
            onPress={() => setAll(shortcut.days)}
            style={[styles.shortcut, { borderColor: colors.border }]}
          >
            <Text style={[styles.shortcutLabel, { color: colors.textMuted }]}>
              {shortcut.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  day: {
    flex: 1,
    // 44pt minimum touch target; minHeight so a large font scale grows the
    // chip rather than clipping the day letter.
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayLabel: {
    ...typography.label,
    fontSize: 15,
  },
  shortcuts: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  shortcut: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  shortcutLabel: {
    ...typography.caption,
    fontWeight: '600',
  },
});
