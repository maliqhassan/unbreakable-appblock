import DateTimePicker from '@react-native-community/datetimepicker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { Toggle } from '../components/Toggle';
import { WeekdayPicker } from '../components/WeekdayPicker';
import { radius, spacing, typography, useTheme } from '../constants/theme';
import { SCHEDULE_PRESETS } from '../constants/schedulePresets';
import { useSubscription } from '../hooks/useSubscription';
import type { ScreenProps } from '../navigation/types';
import { useLockStore } from '../store/useLockStore';
import { useScheduleStore } from '../store/useScheduleStore';
import type { Weekday } from '../types';
import { toLockError } from '../utils/errors';
import {
  formatTime24,
  formatTimeLabel,
  isOvernight,
  parseTime,
  scheduleDurationMinutes,
  validateSchedule,
} from '../utils/schedule';
import { formatDuration } from '../utils/time';

const DEFAULT_DAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

/**
 * Create or edit a schedule.
 *
 * Deliberately one short screen rather than a wizard: name, apps, days, times,
 * strict. The common case — "block social media on weeknights" — should take
 * about twenty seconds.
 *
 * Apps are chosen through the shared picker, which hands its answer back as a
 * route param. The schedule owns that answer: picking apps here does not
 * change what a manual lock would block.
 */
export function CreateScheduleScreen({ navigation, route }: ScreenProps<'CreateSchedule'>) {
  const { colors } = useTheme();
  const { isPro, limits } = useSubscription();

  const editingId = route.params?.scheduleId;
  const schedules = useScheduleStore((s) => s.schedules);
  const create = useScheduleStore((s) => s.create);
  const update = useScheduleStore((s) => s.update);

  const existing = useMemo(
    () => schedules.find((s) => s.id === editingId) ?? null,
    [editingId, schedules]
  );

  // A preset only seeds the initial form values; nothing is saved until the
  // user saves, and every field stays editable.
  const preset = useMemo(
    () => SCHEDULE_PRESETS.find((p) => p.id === route.params?.presetId) ?? null,
    [route.params?.presetId]
  );

  const selectedApps = useLockStore((s) => s.selectedApps);
  const availableApps = useLockStore((s) => s.availableApps);

  /**
   * The packages this schedule covers.
   *
   * Sourced from the picker's answer, then the schedule being edited, and only
   * then the manual lock's selection as a starting point. The picker used to
   * write straight into that manual selection, so setting up a schedule
   * silently changed which apps a manual lock would block.
   */
  const chosenPackages = useMemo<string[]>(
    () =>
      route.params?.packageNames ??
      existing?.appPackageNames ??
      selectedApps.map((app) => app.id),
    [existing?.appPackageNames, route.params?.packageNames, selectedApps]
  );

  const chosenNames = useMemo(
    () => chosenPackages.map((id) => availableApps.find((a) => a.id === id)?.name ?? id),
    [availableApps, chosenPackages]
  );

  const [name, setName] = useState(existing?.name ?? preset?.name ?? 'Focus Schedule');
  const [days, setDays] = useState<Weekday[]>(
    existing?.daysOfWeek ?? preset?.daysOfWeek ?? DEFAULT_DAYS
  );
  const [startTime, setStartTime] = useState(
    existing?.startTime ?? preset?.startTime ?? '22:00'
  );
  const [endTime, setEndTime] = useState(existing?.endTime ?? preset?.endTime ?? '06:00');
  const [strictMode, setStrictMode] = useState(
    existing?.strictMode ?? preset?.strictMode ?? false
  );
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const [saving, setSaving] = useState(false);

  // Defensive: the list screen gates creation, but a deep link or a lapsed
  // subscription could land someone here without Pro.
  useEffect(() => {
    if (!isPro) {
      navigation.replace('Subscription', {
        reason: 'Recurring schedules are a Pro feature.',
      });
    }
  }, [isPro, navigation]);

  const draft = useMemo(
    () => ({
      name,
      appPackageNames: chosenPackages,
      daysOfWeek: days,
      startTime,
      endTime,
    }),
    [chosenPackages, days, endTime, name, startTime]
  );

  const validation = useMemo(() => validateSchedule(draft), [draft]);

  // A throwaway full schedule, only so the shared helpers can be reused rather
  // than re-implementing the overnight rule here.
  const preview = useMemo(
    () => ({
      ...draft,
      id: '',
      enabled: true,
      strictMode,
      createdAt: 0,
      updatedAt: 0,
    }),
    [draft, strictMode]
  );

  const overnight = isOvernight(preview);
  const durationMinutes = scheduleDurationMinutes(preview);

  const tooManyApps = chosenPackages.length > limits.maxApps;

  const handleSave = useCallback(async () => {
    if (!validation.valid) {
      Alert.alert('Cannot save', validation.reason ?? 'This schedule is not valid.');
      return;
    }
    if (tooManyApps) {
      navigation.navigate('Subscription', {
        reason: `Your plan blocks ${limits.maxApps} app at a time.`,
      });
      return;
    }

    setSaving(true);
    try {
      if (existing) {
        await update({ ...existing, ...draft, strictMode });
      } else {
        await create({ ...draft, strictMode });
      }
      navigation.goBack();
    } catch (err) {
      Alert.alert('Could not save', toLockError(err).message);
    } finally {
      setSaving(false);
    }
  }, [
    create,
    draft,
    existing,
    limits.maxApps,
    navigation,
    strictMode,
    tooManyApps,
    update,
    validation,
  ]);

  const onPicked = useCallback(
    (_event: unknown, date?: Date) => {
      const which = picking;
      setPicking(null);
      if (!date || !which) return;

      const value = formatTime24(date.getHours() * 60 + date.getMinutes());
      if (which === 'start') setStartTime(value);
      else setEndTime(value);
    },
    [picking]
  );

  const pickerValue = useMemo(() => {
    const minutes = parseTime(picking === 'end' ? endTime : startTime) ?? 0;
    return new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
  }, [endTime, picking, startTime]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card title="Name">
          <View
            style={[
              styles.inputWrap,
              { backgroundColor: colors.background, borderColor: colors.border },
            ]}
          >
            <TextInput
              testID="schedule-name"
              accessibilityLabel="Schedule name"
              value={name}
              onChangeText={setName}
              maxLength={40}
              placeholder="Sleep, Work, Study…"
              placeholderTextColor={colors.textFaint}
              style={[styles.input, { color: colors.text }]}
            />
          </View>
        </Card>

        <Card
          title="Apps"
          subtitle={
            chosenPackages.length === 0
              ? 'Choose which apps this schedule blocks.'
              : chosenNames.join(', ')
          }
        >
          <PrimaryButton
            testID="schedule-apps"
            label={chosenPackages.length === 0 ? 'Choose apps' : 'Change apps'}
            variant="secondary"
            onPress={() =>
              navigation.navigate('AppSelection', {
                purpose: 'schedule',
                preselected: chosenPackages,
              })
            }
          />
          {tooManyApps ? (
            <Text style={[styles.warning, { color: colors.warning }]}>
              Your plan blocks {limits.maxApps} app at a time.
            </Text>
          ) : null}
        </Card>

        <Card title="Days">
          <WeekdayPicker value={days} onChange={setDays} />
        </Card>

        <Card title="Time">
          <TimeRow
            label="Starts"
            value={startTime}
            testID="pick-start"
            onPress={() => setPicking('start')}
          />
          <TimeRow
            label="Ends"
            value={endTime}
            testID="pick-end"
            onPress={() => setPicking('end')}
          />

          <Text style={[styles.hint, { color: colors.textMuted }]}>
            {overnight
              ? `Overnight — runs into the next morning, ${formatDuration(durationMinutes)} in total.`
              : `${formatDuration(durationMinutes)} each selected day.`}
          </Text>
        </Card>

        <Card>
          <Toggle
            testID="schedule-strict"
            label="Strict Mode"
            description="Use the strongest enforcement available on this device. The session cannot be ended early from inside the app."
            value={strictMode}
            onChange={setStrictMode}
            locked={!limits.strictMode}
            onLockedPress={() =>
              navigation.navigate('Subscription', {
                reason: 'Strict Mode is a Pro feature.',
              })
            }
          />
        </Card>

        {!validation.valid ? (
          <Text style={[styles.warning, { color: colors.danger }]}>
            {validation.reason}
          </Text>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { borderColor: colors.border }]}>
        <PrimaryButton
          testID="save-schedule"
          label={existing ? 'Save changes' : 'Save Schedule'}
          loading={saving}
          onPress={() => void handleSave()}
        />
      </View>

      {picking ? (
        <DateTimePicker
          value={pickerValue}
          mode="time"
          is24Hour={false}
          display="clock"
          onChange={onPicked}
        />
      ) : null}
    </SafeAreaView>
  );
}

function TimeRow({
  label,
  value,
  testID,
  onPress,
}: {
  label: string;
  value: string;
  testID: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${formatTimeLabel(value)}. Change.`}
      onPress={onPress}
      style={[styles.timeRow, { borderColor: colors.border }]}
    >
      <Text style={[styles.timeLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.timeValue, { color: colors.text }]}>
        {formatTimeLabel(value)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    padding: spacing.gutter,
    gap: spacing.lg,
  },
  inputWrap: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  input: {
    ...typography.body,
    minHeight: 48,
    paddingVertical: 0,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  timeLabel: typography.body,
  timeValue: {
    ...typography.heading,
    fontSize: 19,
    fontVariant: ['tabular-nums'],
  },
  hint: {
    ...typography.caption,
    marginTop: spacing.md,
    lineHeight: 18,
  },
  warning: {
    ...typography.caption,
    lineHeight: 18,
  },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
});
