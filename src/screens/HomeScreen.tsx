import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdBanner } from '../components/AdBanner';
import { StatFigure } from '../components/StatFigure';
import { CategoryLegend } from '../components/CategoryLegend';
import { HourlyChart } from '../components/HourlyChart';
import { PrimaryButton } from '../components/PrimaryButton';
import { radius, spacing, typography, useTheme } from '../constants/theme';
import { usePermissionStatus } from '../hooks/usePermissionStatus';
import { useSubscription } from '../hooks/useSubscription';
import type { ScreenProps } from '../navigation/types';
import { useLockStore } from '../store/useLockStore';
import { pairLimits, useDailyLimitStore } from '../store/useDailyLimitStore';
import { summariseSchedules, useScheduleStore } from '../store/useScheduleStore';
import type { DailyUsageLimit, DailyUsageStatus, LockSchedule } from '../types';
import { FREE_FEATURES, PRO_BENEFITS } from '../constants/limits';
import { ScreenTimeService } from '../services/ScreenTimeService';
import { formatUsageSummary } from '../utils/dailyUsage';
import {
  EMPTY_REPORT,
  totalsByCategory,
  totalToday,
  type ScreenTimeReport,
} from '../utils/screenTime';
import { formatDays, formatTimeLabel, formatTimeRange } from '../utils/schedule';
import { formatClockTime } from '../utils/time';

/**
 * The dashboard.
 *
 * One obvious action, one honest status line, everything else quiet. The
 * protection banner is the only thing allowed to break that hierarchy, because
 * a lock that silently cannot enforce is the worst state this app has.
 */
export function HomeScreen({ navigation }: ScreenProps<'Home'>) {
  const { colors } = useTheme();
  const { ready, missing } = usePermissionStatus();
  const { isPro, priceString, priceState } = useSubscription();

  const selectedApps = useLockStore((s) => s.selectedApps);
  const capabilities = useLockStore((s) => s.capabilities);
  const session = useLockStore((s) => s.session);
  const lockRunning = session?.status === 'active';

  const schedules = useScheduleStore((s) => s.schedules);
  const hydrateSchedules = useScheduleStore((s) => s.hydrate);

  const dailyLimits = useDailyLimitStore((s) => s.limits);
  const dailyStatuses = useDailyLimitStore((s) => s.statuses);
  const hydrateDaily = useDailyLimitStore((s) => s.hydrate);

  useEffect(() => {
    void hydrateSchedules();
    void hydrateDaily();
  }, [hydrateDaily, hydrateSchedules]);

  // A schedule can begin while Home is open, so "next lock" is recomputed on a
  // slow tick rather than read once at mount and left stale.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const goToSelection = useCallback(
    () => navigation.navigate('AppSelection'),
    [navigation]
  );

  const blocked = !capabilities.canShieldApps;
  const needsSetup = !blocked && !ready;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {blocked ? (
          <Alert
            tone="warning"
            title="Enforcement unavailable"
            body="This build has no native enforcement, so nothing will be blocked."
          />
        ) : needsSetup ? (
          <Pressable
            testID="protection-warning"
            accessibilityRole="button"
            accessibilityLabel={`Protection setup incomplete. ${missing.length} permissions needed. Tap to finish setup.`}
            onPress={() => navigation.navigate('Permissions')}
          >
            <Alert
              tone="warning"
              title="Protection setup incomplete"
              body={`${missing.length} permission${missing.length === 1 ? '' : 's'} needed before a lock can run.`}
              action="Finish setup"
            />
          </Pressable>
        ) : null}

        {lockRunning && session ? (
          <Pressable
            testID="home-active-lock"
            accessibilityRole="button"
            accessibilityLabel="A lock is running. Tap to view the countdown."
            onPress={() => navigation.navigate('ActiveLock')}
            style={({ pressed }) => [
              styles.running,
              {
                backgroundColor: colors.accentSoft,
                borderColor: colors.accent,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <View style={styles.runningHead}>
              <Text style={[styles.eyebrow, { color: colors.accentOnSurface }]}>
                {session.source === 'schedule' ? 'Scheduled lock' : 'Lock active'}
              </Text>
              <Text style={[styles.chevron, { color: colors.accentOnSurface }]}>›</Text>
            </View>
            <Text style={[styles.runningTime, { color: colors.text }]}>
              Until {formatClockTime(session.endTimestamp)}
            </Text>
            <Text style={[styles.panelBody, { color: colors.textMuted }]}>
              {session.selectedApps.length} app
              {session.selectedApps.length === 1 ? '' : 's'} blocked
              {session.strictMode ? ' · Strict Mode' : ''}
            </Text>
          </Pressable>
        ) : null}

        {/* The hero. Everything above the fold points at one action. */}
        <View style={styles.hero}>
          <Text style={[styles.eyebrow, { color: colors.textFaint }]}>
            {selectedApps.length === 0 ? 'Get started' : 'Ready when you are'}
          </Text>
          <Text style={[styles.heroTitle, { color: colors.text }]}>
            {lockRunning ? 'Add more apps?' : 'Ready to focus?'}
          </Text>
          <Text style={[styles.heroBody, { color: colors.textMuted }]}>
            {lockRunning
              ? 'You can add apps to the running lock at any time. The timer stays the same.'
              : selectedApps.length === 0
                ? 'Choose the apps that pull you away, then set your timer.'
                : `${selectedApps.length} app${selectedApps.length === 1 ? '' : 's'} selected. Set a timer to begin.`}
          </Text>

          <PrimaryButton
            testID="choose-apps"
            label={
              lockRunning
                ? 'Add apps'
                : selectedApps.length === 0
                  ? 'Choose Apps'
                  : 'Continue'
            }
            size="large"
            onPress={goToSelection}
          />
        </View>

        {/* Evidence before decisions: knowing you spent two hours is what makes
            a fifteen-minute limit mean anything. */}
        <FocusTrendsCard />

        {/* A manual lock is what you do today, a daily limit is what keeps
            working every day after. It earns the position. */}
        <DailyLimitsCard limits={dailyLimits} statuses={dailyStatuses} />

        {/* Two-up status grid: protection on the left, plan on the right. */}
        <View style={styles.grid}>
          <Tile
            label="Protection"
            value={ready && !blocked ? 'Ready' : 'Setup'}
            tone={ready && !blocked ? 'success' : 'warning'}
            onPress={() => navigation.navigate('Permissions')}
          />
          <Tile
            label="Plan"
            value={isPro ? 'Pro' : 'Free'}
            tone={isPro ? 'accent' : 'neutral'}
            onPress={() => navigation.navigate('Subscription')}
          />
        </View>

        <SchedulesCard schedules={schedules} now={now} />

        {isPro ? <ProCard /> : <FreeCard priceString={priceString} priceState={priceState} />}
      </ScrollView>

      <AdBanner />
    </SafeAreaView>
  );
}

/** A compact status square. Two per row. */
function Tile({
  label,
  value,
  tone,
  onPress,
}: {
  label: string;
  value: string;
  tone: 'success' | 'warning' | 'accent' | 'neutral';
  onPress: () => void;
}) {
  const { colors } = useTheme();

  const fg = {
    success: colors.success,
    warning: colors.warning,
    accent: colors.accent,
    neutral: colors.textMuted,
  }[tone];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={[styles.tileLabel, { color: colors.textFaint }]}>{label}</Text>
      <Text style={[styles.tileValue, { color: fg }]}>{value}</Text>
    </Pressable>
  );
}

function Alert({
  tone,
  title,
  body,
  action,
}: {
  tone: 'warning' | 'danger';
  title: string;
  body: string;
  action?: string;
}) {
  const { colors } = useTheme();
  const fg = tone === 'danger' ? colors.danger : colors.warning;
  const bg = tone === 'danger' ? colors.dangerSoft : colors.warningSoft;

  return (
    <View style={[styles.alert, { backgroundColor: bg, borderColor: fg }]}>
      <Text style={[styles.alertTitle, { color: fg }]}>{title}</Text>
      <Text style={[styles.alertBody, { color: colors.textMuted }]}>{body}</Text>
      {action ? <Text style={[styles.alertAction, { color: fg }]}>{action} →</Text> : null}
    </View>
  );
}

/**
 * A compact view of today's allowances.
 *
 * Shows measured usage, or says it is unavailable — never an encouraging zero
 * that the user would act on.
 */
function DailyLimitsCard({
  limits,
  statuses,
}: {
  limits: DailyUsageLimit[];
  statuses: DailyUsageStatus[];
}) {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const rows = pairLimits(limits, statuses).slice(0, 3);
  const exhausted = statuses.filter((s) => s.exhausted).length;
  const empty = rows.length === 0;

  const open = () => navigation.navigate('DailyLimits');

  return (
    <Pressable
      testID="home-daily-limits"
      accessibilityRole="button"
      accessibilityLabel="Daily limits"
      onPress={open}
      style={({ pressed }) => [
        styles.featurePanel,
        {
          // Tinted rather than plain: this is the feature people come back to
          // daily, and as a flat panel it read as one more list row.
          backgroundColor: exhausted > 0 ? colors.surface : colors.accentSoft,
          borderColor: exhausted > 0 ? colors.danger : colors.accent,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.panelHead}>
        <Text style={[styles.eyebrow, { color: colors.accentOnSurface }]}>Daily limits</Text>
        <Text style={[styles.chevron, { color: colors.accentOnSurface }]}>›</Text>
      </View>

      <Text style={[styles.featureTitle, { color: colors.text }]}>
        {empty
          ? 'Cap your time, every day'
          : exhausted > 0
            ? `${exhausted} limit${exhausted === 1 ? '' : 's'} reached today`
            : `Tracking ${rows.length} app${rows.length === 1 ? '' : 's'} today`}
      </Text>

      {empty ? (
        <>
          <Text style={[styles.featureBody, { color: colors.textMuted }]}>
            Give an app 15 minutes a day. When the time is gone, it locks itself
            until tomorrow.
          </Text>
          <PrimaryButton
            testID="home-daily-limits-cta"
            label="Set a daily limit"
            variant="secondary"
            onPress={open}
          />
        </>
      ) : (
        rows.map(({ limit, status }) => (
          <DailyLimitBar key={limit.id} limit={limit} status={status} />
        ))
      )}
    </Pressable>
  );
}

/**
 * One app's day, as a bar.
 *
 * A number alone ("12m / 15m used") makes the reader do the arithmetic. The bar
 * answers "how much is left?" before it is read, which is the only question
 * anyone actually opens this screen with.
 */
function DailyLimitBar({
  limit,
  status,
}: {
  limit: DailyUsageLimit;
  status: DailyUsageStatus | null;
}) {
  const { colors } = useTheme();

  const used = status?.usageSeconds ?? null;
  const fraction =
    used == null || status == null || status.limitSeconds <= 0
      ? 0
      : Math.min(1, used / status.limitSeconds);

  // Unknown usage is deliberately not drawn as an empty bar: "we could not
  // measure" and "you have used none of it" must never look the same.
  const unknown = used == null;
  const tone = status?.exhausted
    ? colors.danger
    : fraction >= 0.8
      ? colors.warning
      : colors.accent;

  return (
    <View style={styles.limitBlock}>
      <View style={styles.limitRow}>
        <Text style={[styles.limitName, { color: colors.text }]} numberOfLines={1}>
          {limit.appPackageName.split('.').pop()}
        </Text>
        <Text
          style={[
            styles.panelBody,
            { color: status?.exhausted ? colors.danger : colors.textMuted },
          ]}
        >
          {status?.exhausted
            ? '🔒 Resets tomorrow'
            : status
              ? formatUsageSummary(status)
              : 'Calculating…'}
        </Text>
      </View>

      <View style={[styles.homeTrack, { backgroundColor: colors.surfaceMuted }]}>
        {unknown ? null : (
          <View
            style={[
              styles.homeFill,
              { width: `${Math.round(fraction * 100)}%`, backgroundColor: tone },
            ]}
          />
        )}
      </View>
    </View>
  );
}

/** What is running now, and what is next. Never both stale. */
function SchedulesCard({ schedules, now }: { schedules: LockSchedule[]; now: Date }) {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { active, nextSchedule, nextAt } = summariseSchedules(schedules, now);

  return (
    <Pressable
      testID="home-schedules"
      accessibilityRole="button"
      accessibilityLabel="Schedules"
      onPress={() => navigation.navigate('Schedules')}
      style={({ pressed }) => [
        styles.panel,
        {
          backgroundColor: colors.surface,
          borderColor: active.length > 0 ? colors.success : colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.panelHead}>
        <Text style={[styles.eyebrow, { color: colors.textFaint }]}>Schedules</Text>
        <Text style={[styles.chevron, { color: colors.textFaint }]}>›</Text>
      </View>

      {schedules.length === 0 ? (
        <Text style={[styles.panelBody, { color: colors.textMuted }]}>
          No schedules yet — set one up to lock apps automatically.
        </Text>
      ) : active.length > 0 ? (
        <>
          <Text style={[styles.panelTitle, { color: colors.success }]}>
            {active[0].name} · locked now
          </Text>
          <Text style={[styles.panelBody, { color: colors.textMuted }]}>
            Ends {formatTimeLabel(active[0].endTime)}
          </Text>
        </>
      ) : nextSchedule && nextAt ? (
        <>
          <Text style={[styles.panelTitle, { color: colors.text }]}>{nextSchedule.name}</Text>
          <Text style={[styles.panelBody, { color: colors.textMuted }]}>
            {formatDays(nextSchedule.daysOfWeek)} · {formatTimeRange(nextSchedule)}
          </Text>
          <Text style={[styles.panelBody, { color: colors.textFaint }]}>
            Starts {formatClockTime(nextAt)}
          </Text>
        </>
      ) : (
        <Text style={[styles.panelBody, { color: colors.textMuted }]}>
          {schedules.length} schedule{schedules.length === 1 ? '' : 's'}, none upcoming.
        </Text>
      )}
    </Pressable>
  );
}

/**
 * Free plan summary. Present, not pushy.
 *
 * The price comes from the store, so it is whatever Google Play will actually
 * charge this customer in their currency. When it is not known the card says
 * "Unlock Pro" without a figure rather than inventing one.
 */
function FreeCard({
  priceString,
  priceState,
}: {
  priceString: string | null;
  priceState: 'loading' | 'ready' | 'unavailable';
}) {
  const { colors } = useTheme();
  const navigation = useNavigation();

  const upgradeLabel =
    priceState === 'ready' && priceString
      ? `Unlock Pro — ${priceString}/month`
      : priceState === 'loading'
        ? 'Unlock Pro — loading price…'
        : 'Unlock Pro';

  return (
    <Pressable
      testID="home-upgrade"
      accessibilityRole="button"
      accessibilityLabel={upgradeLabel}
      onPress={() => navigation.navigate('Subscription')}
      style={({ pressed }) => [
        styles.panel,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.panelHead}>
        <Text style={[styles.eyebrow, { color: colors.textFaint }]}>Your plan · Free</Text>
        <Text style={[styles.chevron, { color: colors.textFaint }]}>›</Text>
      </View>

      <View style={styles.perks}>
        {FREE_FEATURES.map((feature) => (
          <Text key={feature} style={[styles.perk, { color: colors.textMuted }]}>
            • {feature}
          </Text>
        ))}
      </View>

      <View style={[styles.upgrade, { backgroundColor: colors.accentSoft }]}>
        <Text style={[styles.upgradeLabel, { color: colors.accentOnSurface }]}>{upgradeLabel}</Text>
      </View>
    </Pressable>
  );
}

/** Pro summary. No upselling — they already bought it. */
function ProCard() {
  const { colors } = useTheme();

  return (
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.accent }]}>
      <Text style={[styles.eyebrow, { color: colors.accentOnSurface }]}>Your plan · Pro</Text>
      <View style={styles.perks}>
        {PRO_BENEFITS.map((perk) => (
          <Text key={perk} style={[styles.perk, { color: colors.textMuted }]}>
            ✓ {perk}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  eyebrow: typography.eyebrow,

  running: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.xs,
  },
  runningHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  runningTime: {
    ...typography.title,
    fontSize: 22,
  },
  hero: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  heroTitle: {
    ...typography.hero,
    marginTop: -spacing.xs,
  },
  heroBody: {
    ...typography.body,
    marginBottom: spacing.sm,
  },

  grid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  tile: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.xs,
  },
  tileLabel: typography.eyebrow,
  tileValue: {
    ...typography.heading,
    fontSize: 20,
  },

  panel: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.xs,
  },
  /** Same shape as `panel`, given more room and a heavier edge to lead with. */
  featurePanel: {
    borderWidth: 1.5,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  featureTitle: {
    ...typography.heading,
    fontSize: 19,
    marginBottom: spacing.xs,
  },
  featureBody: {
    ...typography.body,
    lineHeight: 21,
    marginBottom: spacing.xs,
  },
  limitBlock: { gap: spacing.xs, marginTop: spacing.xs },
  homeTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  homeFill: {
    height: 6,
    borderRadius: 3,
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  panelTitle: {
    ...typography.body,
    fontWeight: '700',
    fontSize: 17,
  },
  panelBody: typography.caption,
  limitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 3,
  },
  limitName: {
    ...typography.caption,
    fontWeight: '600',
    flex: 1,
  },
  chevron: {
    fontSize: 22,
    lineHeight: 22,
    fontWeight: '400',
  },

  upgrade: {
    marginTop: spacing.md,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  upgradeLabel: {
    ...typography.label,
    fontSize: 14,
  },

  perks: { gap: spacing.sm, marginTop: spacing.xs },
  perk: typography.caption,

  alert: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  alertTitle: {
    ...typography.label,
    fontSize: 15,
  },
  alertBody: typography.caption,
  alertAction: {
    ...typography.label,
    fontSize: 14,
    marginTop: spacing.xs,
  },
});

/**
 * Today's screen time, and the week's shape, on the way past.
 *
 * A summary rather than the full breakdown: enough to notice a bad week
 * without turning Home into a dashboard. Tapping opens the real thing.
 *
 * Renders nothing at all when usage access is off. The Home screen already
 * carries a protection warning in that case, and a second empty card saying
 * the same thing would be noise.
 */
function FocusTrendsCard() {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const [report, setReport] = useState<ScreenTimeReport>(EMPTY_REPORT);

  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ScreenTimeService.getReport(7)
      .then((next) => {
        if (cancelled) return;
        setReport(next);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing at all until the first read settles, so the card does not flash an
  // empty state on the way to having data.
  if (!loaded) return null;

  const categories = totalsByCategory(report.apps);
  // The chart needs day totals, not the per-app list. Gating it on `apps`
  // hid the whole card — and with it the only route to the Screen time
  // screen — whenever today happened to be quiet.
  const hasChart = report.days.some((seconds) => seconds > 0);

  return (
    <Pressable
      testID="home-focus-trends"
      accessibilityRole="button"
      accessibilityLabel="Screen time and focus trends"
      onPress={() => navigation.navigate('Insights')}
      style={({ pressed }) => [
        styles.panel,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.panelHead}>
        <Text style={[styles.eyebrow, { color: colors.textFaint }]}>Focus trends</Text>
        <Text style={[styles.chevron, { color: colors.textFaint }]}>›</Text>
      </View>

      {!report.available ? (
        // Say why there is no chart. A card that silently renders nothing is
        // indistinguishable from a broken one.
        <Text style={[styles.panelBody, { color: colors.textMuted }]}>
          Turn on Usage Access to see where your time goes.
        </Text>
      ) : (
        <>
          <StatFigure label="Today" seconds={totalToday(report)} size="large" />

          {/* Axis labels are dropped here: on a summary card the shape of the
              day is the message, and three extra label rows would crowd it. */}
          <HourlyChart hours={report.hourly} height={54} showAxis={false} />

          {categories.length > 0 ? (
            <CategoryLegend categories={categories} limit={3} />
          ) : (
            <Text style={[styles.panelBody, { color: colors.textMuted }]}>
              {hasChart
                ? 'Tap to see the breakdown by category.'
                : 'Android has no usage recorded yet. Come back after using your phone a little.'}
            </Text>
          )}
        </>
      )}
    </Pressable>
  );
}
