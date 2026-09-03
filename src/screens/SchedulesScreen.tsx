import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SCHEDULE_PRESETS, iconForSchedule } from '../constants/schedulePresets';
import { PrimaryButton } from '../components/PrimaryButton';
import { radius, spacing, typography, useTheme } from '../constants/theme';
import { useSubscription } from '../hooks/useSubscription';
import type { ScreenProps } from '../navigation/types';
import { ScheduleService } from '../services/ScheduleService';
import { useScheduleStore } from '../store/useScheduleStore';
import type { LockSchedule } from '../types';
import { toLockError } from '../utils/errors';
import { formatDays, formatTimeRange, isScheduleActive } from '../utils/schedule';

/**
 * The schedule list.
 *
 * Free users can see this screen — the feature is worth understanding before
 * paying for it — but creation routes to the existing subscription screen
 * rather than a second paywall.
 */
export function SchedulesScreen({ navigation }: ScreenProps<'Schedules'>) {
  const { colors } = useTheme();
  const { isPro } = useSubscription();

  const schedules = useScheduleStore((s) => s.schedules);
  const hydrate = useScheduleStore((s) => s.hydrate);
  const setEnabled = useScheduleStore((s) => s.setEnabled);
  const remove = useScheduleStore((s) => s.remove);

  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    void hydrate();
    void ScheduleService.refresh();
  }, [hydrate]);

  // A schedule can start while this screen is open; a minute is plenty to keep
  // the Active/Paused dots honest without churning.
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const handleCreate = useCallback(
    (presetId?: string) => {
      if (!isPro) {
        navigation.navigate('Subscription', {
          reason: 'Recurring schedules are a Pro feature.',
        });
        return;
      }
      navigation.navigate('CreateSchedule', presetId ? { presetId } : {});
    },
    [isPro, navigation]
  );

  const handleDelete = useCallback(
    (schedule: LockSchedule) => {
      Alert.alert(
        'Delete this schedule?',
        'This schedule will no longer automatically lock your apps.',
        [
          { text: 'Keep', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              void remove(schedule.id).catch((err) =>
                Alert.alert('Could not delete', toLockError(err).message)
              );
            },
          },
        ]
      );
    },
    [remove]
  );

  const supported = ScheduleService.isSupported();

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Schedules</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            Automatically lock distracting apps at the times you choose.
          </Text>
        </View>

        {!supported ? (
          <Notice
            tone="warning"
            text="This build has no native scheduling, so schedules are saved but will not fire. Use a development build."
          />
        ) : !ScheduleService.canScheduleExactAlarms() ? (
          <Notice
            tone="warning"
            text="Android is not allowing exact alarms for this app, so a schedule may start or end a few minutes late. Allow “Alarms & reminders” in system settings for to-the-minute accuracy."
          />
        ) : null}

        {!isPro ? (
          <Notice
            tone="info"
            text="Schedules are a Pro feature. You can look around, but creating one needs Pro."
          />
        ) : null}

        {schedules.length === 0 ? (
          <View style={styles.presets}>
            <Text style={[styles.presetsTitle, { color: colors.text }]}>
              Start from a routine
            </Text>
            <Text style={[styles.presetsBody, { color: colors.textMuted }]}>
              Pick one and choose which apps it blocks. You can change everything after.
            </Text>

            {SCHEDULE_PRESETS.map((preset) => (
              <Pressable
                key={preset.id}
                testID={`preset-${preset.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${preset.name}. ${preset.description}`}
                onPress={() => handleCreate(preset.id)}
                style={({ pressed }) => [
                  styles.preset,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <View style={[styles.presetIcon, { backgroundColor: colors.accentSoft }]}>
                  <Text style={styles.presetEmoji}>{preset.icon}</Text>
                </View>
                <View style={styles.presetText}>
                  <Text style={[styles.presetName, { color: colors.text }]}>
                    {preset.name}
                  </Text>
                  <Text style={[styles.presetMeta, { color: colors.textMuted }]}>
                    {preset.description}
                  </Text>
                </View>
                <Text style={[styles.presetChevron, { color: colors.textFaint }]}>›</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          schedules.map((schedule) => (
            <ScheduleCard
              key={schedule.id}
              schedule={schedule}
              active={isScheduleActive(schedule, now)}
              onToggle={(enabled) => {
                void setEnabled(schedule.id, enabled).catch((err) =>
                  Alert.alert('Could not update', toLockError(err).message)
                );
              }}
              onEdit={() =>
                navigation.navigate('CreateSchedule', { scheduleId: schedule.id })
              }
              onDelete={() => handleDelete(schedule)}
            />
          ))
        )}
      </ScrollView>

      <View style={[styles.footer, { borderColor: colors.border }]}>
        <PrimaryButton
          testID="create-schedule"
          label="+ Create Schedule"
          onPress={() => handleCreate()}
        />
      </View>
    </SafeAreaView>
  );
}

function Notice({ tone, text }: { tone: 'warning' | 'info'; text: string }) {
  const { colors } = useTheme();
  const edge = tone === 'warning' ? colors.warning : colors.accent;
  // The border can carry the brand purple; the text needs the legible tone.
  const ink = tone === 'warning' ? colors.warning : colors.accentOnSurface;

  return (
    <View style={[styles.notice, { borderColor: edge }]}>
      <Text style={[styles.noticeText, { color: ink }]}>{text}</Text>
    </View>
  );
}

function ScheduleCard({
  schedule,
  active,
  onToggle,
  onEdit,
  onDelete,
}: {
  schedule: LockSchedule;
  active: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { colors } = useTheme();
  const running = active && schedule.enabled;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: running ? colors.success : colors.border,
        },
      ]}
    >
      <View style={styles.cardHead}>
        <View
          style={[
            styles.presetIcon,
            { backgroundColor: running ? colors.successSoft : colors.surfaceMuted },
          ]}
        >
          <Text style={styles.presetEmoji}>{iconForSchedule(schedule.name)}</Text>
        </View>

        <Pressable
          testID={`schedule-${schedule.id}`}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${schedule.name}`}
          onPress={onEdit}
          style={styles.cardHeadText}
        >
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {schedule.name}
          </Text>
          <Text style={[styles.days, { color: colors.textMuted }]}>
            {formatDays(schedule.daysOfWeek)}
          </Text>
        </Pressable>

        <Switch
          accessibilityLabel={`${schedule.name} enabled`}
          value={schedule.enabled}
          onValueChange={onToggle}
          trackColor={{ false: colors.surfaceMuted, true: colors.accent }}
          thumbColor={colors.surface}
        />
      </View>

      <Text style={[styles.range, { color: colors.text }]}>
        {formatTimeRange(schedule)}
      </Text>

      <View style={styles.metaRow}>
        <Text style={[styles.meta, { color: colors.textMuted }]}>
          {schedule.appPackageNames.length} app
          {schedule.appPackageNames.length === 1 ? '' : 's'}
        </Text>
        {schedule.strictMode ? (
          <Text style={[styles.meta, { color: colors.warning }]}>Strict Mode</Text>
        ) : null}
      </View>

      <View style={styles.cardFoot}>
        <Text
          style={[
            styles.status,
            { color: running ? colors.success : colors.textFaint },
          ]}
        >
          {!schedule.enabled ? '○ Paused' : running ? '● Active' : '○ Scheduled'}
        </Text>

        <Pressable
          testID={`delete-${schedule.id}`}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${schedule.name}`}
          onPress={onDelete}
          hitSlop={8}
          style={styles.delete}
        >
          <Text style={[styles.deleteLabel, { color: colors.danger }]}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  header: { gap: spacing.sm },
  title: typography.display,
  subtitle: {
    ...typography.body,
    lineHeight: 22,
  },
  notice: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  noticeText: {
    ...typography.caption,
    lineHeight: 18,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  cardHeadText: { flex: 1, gap: 2 },
  name: {
    ...typography.body,
    fontWeight: '700',
    fontSize: 17,
  },
  days: typography.caption,
  range: {
    ...typography.heading,
    fontSize: 18,
    fontVariant: ['tabular-nums'],
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  meta: typography.caption,
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  status: {
    ...typography.caption,
    fontWeight: '700',
  },
  delete: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  deleteLabel: typography.label,
  presets: {
    gap: spacing.md,
  },
  presetsTitle: {
    ...typography.heading,
    marginTop: spacing.sm,
  },
  presetsBody: {
    ...typography.caption,
    marginBottom: spacing.xs,
  },
  preset: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  presetIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetEmoji: { fontSize: 20 },
  presetText: { flex: 1, gap: 2 },
  presetName: {
    ...typography.body,
    fontWeight: '700',
  },
  presetMeta: typography.caption,
  presetChevron: { fontSize: 22, lineHeight: 22 },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
});
