import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '../components/EmptyState';
import { LogoLoader } from '../components/LogoLoader';
import { PrimaryButton } from '../components/PrimaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { FadeIn } from '../components/motion';
import { StatFigure } from '../components/StatFigure';
import { TrendBars } from '../components/TrendBars';
import { radius, spacing, typography, useTheme } from '../constants/theme';
import type { ScreenProps } from '../navigation/types';
import { ScreenTimeService } from '../services/ScreenTimeService';
import {
  dailyAverage,
  EMPTY_REPORT,
  formatDuration,
  totalForWindow,
  totalsByCategory,
  totalToday,
  type CategoryTotal,
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
 * Everything here is read from Android on demand and never stored or sent
 * anywhere. There is no history beyond what the OS itself keeps.
 */
export function InsightsScreen({ navigation }: ScreenProps<'Insights'>) {
  const { colors } = useTheme();
  const [report, setReport] = useState<ScreenTimeReport>(EMPTY_REPORT);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // A counter rather than a boolean: bumping it re-runs the effect, which keeps
  // the fetch and its cancellation in one place instead of split across a
  // callback the effect also calls.
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;

    ScreenTimeService.getReport(7)
      .then((next) => {
        if (cancelled) return;
        setReport(next);
        setLoading(false);
        setRefreshing(false);
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
  const week = totalForWindow(report);
  const average = dailyAverage(report);
  const topApps = [...report.apps].sort((a, b) => b.seconds - a.seconds).slice(0, 8);

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
            description="Android only shares screen time with your permission. Turn on Usage Access and this fills in."
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
      >
        {/* One summary card, not three. Today, the week, the average and the
            chart are one thought — splitting them across stacked cards made the
            screen read as a settings list rather than as a report. */}
        <FadeIn>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.pair}>
              <View style={styles.pairItem}>
                <StatFigure label="Today" seconds={today} size="large" />
              </View>
              <View style={styles.pairItem}>
                <StatFigure label="This week" seconds={week} size="large" />
              </View>
            </View>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            <View style={styles.pair}>
              <View style={styles.pairItem}>
                <StatFigure label="Daily average" seconds={average} />
              </View>
              <View style={styles.chart}>
                <TrendBars days={report.days} dominant={categories[0]?.id} />
              </View>
            </View>
          </View>
        </FadeIn>

        <SectionHeader
          title="By category"
          subtitle="Where today went, as each app describes itself."
        />

        {categories.length === 0 ? (
          <Text style={[styles.muted, { color: colors.textMuted }]}>
            Nothing to show yet today. Come back after you&apos;ve used your phone a
            little.
          </Text>
        ) : (
          <>
            <ShareBar categories={categories} />

            {categories.map((category, index) => (
              <FadeIn key={category.id} index={index}>
                <Row
                  color={category.color}
                  title={category.label}
                  subtitle={`${category.appCount} app${category.appCount === 1 ? '' : 's'}`}
                  value={formatDuration(category.seconds)}
                />
              </FadeIn>
            ))}
          </>
        )}

        {topApps.length > 0 ? (
          <>
            <SectionHeader title="Most used today" />
            {topApps.map((app, index) => (
              <FadeIn key={app.packageName} index={index}>
                <Row
                  color={totalsByCategory([app])[0].color}
                  title={app.appName}
                  value={formatDuration(app.seconds)}
                />
              </FadeIn>
            ))}
          </>
        ) : null}

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

/** The day's split as one stacked bar — the shape of the day, before the list. */
function ShareBar({ categories }: { categories: CategoryTotal[] }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.shareTrack, { backgroundColor: colors.surfaceMuted }]}>
      {categories.map((category) => (
        <View
          key={category.id}
          style={{
            flex: Math.max(category.share, 0.001),
            backgroundColor: category.color,
          }}
        />
      ))}
    </View>
  );
}

/** A list row: colour tab, name, and the figure on the right. */
function Row({
  color,
  title,
  subtitle,
  value,
}: {
  color: string;
  title: string;
  subtitle?: string;
  value: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.tab, { backgroundColor: color }]} />
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.rowSubtitle, { color: colors.textFaint }]}>{subtitle}</Text>
        ) : null}
      </View>
      <Text style={[styles.rowValue, { color: colors.textMuted }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: spacing.gutter, gap: spacing.md, paddingBottom: spacing.xxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  divider: { height: StyleSheet.hairlineWidth },
  pair: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  pairItem: { flex: 1 },
  chart: { flex: 1.2 },
  shareTrack: {
    flexDirection: 'row',
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  tab: { width: 4, height: 28, borderRadius: 2 },
  rowText: { flex: 1, gap: 1 },
  rowTitle: { ...typography.body, fontWeight: '600' },
  rowSubtitle: { ...typography.caption, fontSize: 12 },
  rowValue: { ...typography.body, fontWeight: '600' },
  muted: { ...typography.body },
  note: { ...typography.caption, lineHeight: 18, marginTop: spacing.sm },
  footer: { padding: spacing.lg },
});
