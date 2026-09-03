import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppUsageGrid } from '../components/AppUsageGrid';
import { CategoryLegend } from '../components/CategoryLegend';
import { EmptyState } from '../components/EmptyState';
import { HourlyChart } from '../components/HourlyChart';
import { LogoLoader } from '../components/LogoLoader';
import { PrimaryButton } from '../components/PrimaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { FadeIn } from '../components/motion';
import { radius, spacing, typography, useTheme } from '../constants/theme';
import type { ScreenProps } from '../navigation/types';
import { LockService } from '../services/LockService';
import { ScreenTimeService } from '../services/ScreenTimeService';
import {
  busiestHour,
  dailyAverage,
  EMPTY_REPORT,
  formatDuration,
  formatHour,
  splitDuration,
  totalForWindow,
  totalsByCategory,
  totalToday,
  type ScreenTimeReport,
} from '../utils/screenTime';

/**
 * Where your time actually went.
 *
 * This screen exists because the rest of the app asks people to make decisions
 * — which apps to block, for how long, what the daily allowance should be —
 * without ever showing them the evidence those decisions should rest on. A
 * limit of fifteen minutes means nothing until you know you spent two hours.
 *
 * The shape is deliberately the one every phone owner already knows from their
 * OS's own screen-time report: total, when it happened, what kind of thing it
 * was, then which apps. Familiar beats novel for a screen whose whole job is to
 * be read at a glance.
 *
 * Everything here is read from Android on demand and never stored or sent
 * anywhere. There is no history beyond what the OS itself keeps.
 */
export function InsightsScreen({ navigation }: ScreenProps<'Insights'>) {
  const { colors } = useTheme();
  const [report, setReport] = useState<ScreenTimeReport>(EMPTY_REPORT);
  const [icons, setIcons] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;

    ScreenTimeService.getReport(7)
      .then(async (next) => {
        if (cancelled) return;
        setReport(next);
        setLoading(false);
        setRefreshing(false);

        // Icons come second and separately: they are the expensive part of the
        // installed-app query, and the figures should not wait on them.
        const installed = await LockService.getInstalledApps();
        if (cancelled) return;
        setIcons(
          Object.fromEntries(installed.map((app) => [app.id, app.iconBase64 ?? null]))
        );
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        setRefreshing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloads]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setReloads((n) => n + 1);
  }, []);

  const categories = totalsByCategory(report.apps);
  const today = totalToday(report);
  const peak = busiestHour(report.hourly);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.centered}>
          <LogoLoader label="Reading your screen time" />
        </View>
      </SafeAreaView>
    );
  }

  if (!report.available) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.centered}>
          <EmptyState
            icon="📊"
            title="Usage access is off"
            description="Android only shares screen time with your permission. Turn it on and this fills in."
          />
        </View>
        <View style={styles.footer}>
          <PrimaryButton
            testID="insights-permissions"
            label="Turn on Usage Access"
            onPress={() => navigation.navigate('Permissions')}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
      >
        {/* The report card: today's total, when it happened, and what kind of
            thing it was. One surface, because those are one thought. */}
        <FadeIn>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.eyebrow, { color: colors.textFaint }]}>Today</Text>

            <View style={styles.total}>
              {splitDuration(today).map((part) => (
                <View key={part.unit} style={styles.totalPart}>
                  <Text style={[styles.totalValue, { color: colors.text }]}>
                    {part.value}
                  </Text>
                  <Text style={[styles.totalUnit, { color: colors.textMuted }]}>
                    {part.unit}
                  </Text>
                </View>
              ))}
            </View>

            <HourlyChart hours={report.hourly} height={116} />

            <View style={[styles.rule, { backgroundColor: colors.border }]} />

            <CategoryLegend categories={categories} />
          </View>
        </FadeIn>

        {peak ? (
          <Text style={[styles.insight, { color: colors.textMuted }]}>
            Your busiest hour was {formatHour(peak.hour)} — {formatDuration(peak.total)}.
          </Text>
        ) : null}

        {report.apps.length > 0 ? (
          <FadeIn index={1}>
            <SectionHeader title="Apps" subtitle="Most used first." />
            <AppUsageGrid apps={report.apps} icons={icons} />
          </FadeIn>
        ) : (
          <Text style={[styles.insight, { color: colors.textMuted }]}>
            Nothing recorded yet today. Come back after you&apos;ve used your phone a
            little.
          </Text>
        )}

        <FadeIn index={2}>
          <SectionHeader title="This week" subtitle="How today compares." />
          <View style={styles.weekRow}>
            <Stat label="Week total" value={formatDuration(totalForWindow(report))} />
            <Stat label="Daily average" value={formatDuration(dailyAverage(report))} />
          </View>
        </FadeIn>

        <Text style={[styles.note, { color: colors.textFaint }]}>
          Read from Android on this device. Categories come from what each app
          declares about itself, so some land in Other. Nothing here is stored or
          sent anywhere.
        </Text>
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border, borderTopWidth: 1 }]}>
        <PrimaryButton
          testID="insights-set-limit"
          label="Set a daily limit"
          onPress={() => navigation.navigate('DailyLimits')}
        />
      </View>
    </SafeAreaView>
  );
}

/** A labelled figure, for the pair under "This week". */
function Stat({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.statLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: spacing.gutter, gap: spacing.lg, paddingBottom: spacing.xxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },

  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  eyebrow: typography.eyebrow,
  total: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: -spacing.sm },
  totalPart: { flexDirection: 'row', alignItems: 'flex-end' },
  totalValue: { fontSize: 44, fontWeight: '800', letterSpacing: -1.5, lineHeight: 50 },
  totalUnit: { fontSize: 20, fontWeight: '600', marginBottom: 6, marginLeft: 2 },
  rule: { height: StyleSheet.hairlineWidth },

  insight: { ...typography.body, fontSize: 15, lineHeight: 21 },

  weekRow: { flexDirection: 'row', gap: spacing.md },
  stat: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  statLabel: { ...typography.caption, fontSize: 12 },
  statValue: { ...typography.heading, fontSize: 20 },

  note: { ...typography.caption, lineHeight: 18, marginTop: spacing.sm },
  footer: { padding: spacing.gutter },
});
