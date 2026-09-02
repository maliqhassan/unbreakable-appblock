import { useCallback, useEffect } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdBanner } from '../components/AdBanner';
import { PrimaryButton } from '../components/PrimaryButton';
import { radius, spacing, typography, useTheme } from '../constants/theme';
import { usePermissionStatus } from '../hooks/usePermissionStatus';
import { useSubscription } from '../hooks/useSubscription';
import type { ScreenProps } from '../navigation/types';
import { DailyLimitService } from '../services/DailyLimitService';
import { pairLimits, useDailyLimitStore } from '../store/useDailyLimitStore';
import { useLockStore } from '../store/useLockStore';
import type { DailyUsageLimit, DailyUsageStatus } from '../types';
import { toLockError } from '../utils/errors';
import { formatLimit, formatRemaining, formatUsageSummary, usageFraction } from '../utils/dailyUsage';

/**
 * Daily limits.
 *
 * Progress bars are driven by **measured** usage, so a bar that cannot be
 * measured says so instead of showing an encouraging zero.
 */
export function DailyLimitsScreen({ navigation }: ScreenProps<'DailyLimits'>) {
  const { colors } = useTheme();
  const { isPro, limits: tierLimits } = useSubscription();
  const { permissions } = usePermissionStatus();

  const limits = useDailyLimitStore((s) => s.limits);
  const statuses = useDailyLimitStore((s) => s.statuses);
  const usageError = useDailyLimitStore((s) => s.usageError);
  const loading = useDailyLimitStore((s) => s.loading);
  const hydrated = useDailyLimitStore((s) => s.hydrated);
  const hydrate = useDailyLimitStore((s) => s.hydrate);
  const refreshUsage = useDailyLimitStore((s) => s.refreshUsage);
  const setEnabled = useDailyLimitStore((s) => s.setEnabled);
  const remove = useDailyLimitStore((s) => s.remove);

  const availableApps = useLockStore((s) => s.availableApps);
  const loadAvailableApps = useLockStore((s) => s.loadAvailableApps);

  useEffect(() => {
    void hydrate();
    void loadAvailableApps();
    void DailyLimitService.refresh();
  }, [hydrate, loadAvailableApps]);

  // Usage moves while this screen is open. Fifteen seconds keeps the bars
  // honest without hammering the bridge; enforcement never depends on this.
  useEffect(() => {
    const interval = setInterval(() => void refreshUsage(), 15_000);
    return () => clearInterval(interval);
  }, [refreshUsage]);

  const usageAccess = permissions.find((p) => p.id === 'usageAccess');
  const usageAccessMissing = usageAccess != null && usageAccess.status !== 'granted';

  const nameFor = useCallback(
    (packageName: string) =>
      availableApps.find((app) => app.id === packageName)?.name ?? packageName,
    [availableApps]
  );

  const handleAdd = useCallback(() => {
    if (!isPro && limits.length >= tierLimits.maxApps) {
      navigation.navigate('Subscription', {
        reason: `Your plan allows ${tierLimits.maxApps} daily limit. Pro lets you set one for every app.`,
      });
      return;
    }
    navigation.navigate('CreateDailyLimit', {});
  }, [isPro, limits.length, navigation, tierLimits.maxApps]);

  const handleDelete = useCallback(
    (limit: DailyUsageLimit) => {
      Alert.alert(
        'Delete daily limit?',
        'This app will no longer have a daily usage limit.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              void remove(limit.id).catch((err) =>
                Alert.alert('Could not delete', toLockError(err).message)
              );
            },
          },
        ]
      );
    },
    [remove]
  );

  const rows = pairLimits(limits, statuses);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Daily limits</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            Control how much time you spend in distracting apps each day.
          </Text>
        </View>

        {!DailyLimitService.isSupported() ? (
          <Notice
            tone="warning"
            text="This build has no native usage tracking, so limits are saved but not enforced. Use a development build."
          />
        ) : usageAccessMissing ? (
          <Pressable
            testID="daily-fix-permissions"
            accessibilityRole="button"
            onPress={() => navigation.navigate('Permissions')}
          >
            <Notice
              tone="danger"
              text="Daily limits need Usage Access. Without it your usage cannot be measured and nothing is enforced. Tap to fix."
            />
          </Pressable>
        ) : usageError ? (
          <Notice tone="warning" text={`Usage data temporarily unavailable. ${usageError}`} />
        ) : null}

        {!isPro && limits.length > 0 ? (
          <Notice
            tone="info"
            text={`Free plan: ${tierLimits.maxApps} daily limit. Pro lets you set one for every app.`}
          />
        ) : null}

        {!hydrated || (loading && rows.length === 0) ? (
          <Text style={[styles.muted, { color: colors.textMuted }]}>
            Calculating today&apos;s usage…
          </Text>
        ) : rows.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>⏳</Text>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No limits yet</Text>
            <Text style={[styles.emptyBody, { color: colors.textMuted }]}>
              Set a daily time budget for distracting apps.
            </Text>
          </View>
        ) : (
          rows.map(({ limit, status }) => (
            <LimitCard
              key={limit.id}
              limit={limit}
              status={status}
              appName={nameFor(limit.appPackageName)}
              onToggle={(enabled) => {
                void setEnabled(limit.id, enabled).catch((err) =>
                  Alert.alert('Could not update', toLockError(err).message)
                );
              }}
              onEdit={() => navigation.navigate('CreateDailyLimit', { limitId: limit.id })}
              onDelete={() => handleDelete(limit)}
            />
          ))
        )}
      </ScrollView>

      {/*
        The one new ad placement. A browsing screen, above the footer, well away
        from anything that decides whether an app is blocked — never over the
        active lock, the block screen, permissions, or onboarding. AdBanner
        checks entitlement itself, so Pro users never render or initialise it.
      */}
      <AdBanner />

      <View style={[styles.footer, { borderColor: colors.border }]}>
        <PrimaryButton
          testID="add-daily-limit"
          label="+ Add daily limit"
          size="large"
          onPress={handleAdd}
        />
      </View>
    </SafeAreaView>
  );
}

function Notice({ tone, text }: { tone: 'warning' | 'danger' | 'info'; text: string }) {
  const { colors } = useTheme();
  const fg =
    tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : colors.accent;
  const bg =
    tone === 'danger'
      ? colors.dangerSoft
      : tone === 'warning'
        ? colors.warningSoft
        : colors.accentSoft;

  return (
    <View style={[styles.notice, { backgroundColor: bg, borderColor: fg }]}>
      <Text style={[styles.noticeText, { color: fg }]}>{text}</Text>
    </View>
  );
}

function LimitCard({
  limit,
  status,
  appName,
  onToggle,
  onEdit,
  onDelete,
}: {
  limit: DailyUsageLimit;
  status: DailyUsageStatus | null;
  appName: string;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { colors } = useTheme();

  const exhausted = status?.exhausted ?? false;
  const unknown = status == null || status.usageSeconds == null;

  // An exhausted app shows a full bar even when the latest measurement failed:
  // the lock is real and established, so a 0% bar beside "Locked until
  // tomorrow" would contradict itself.
  const fraction = exhausted ? 1 : status ? usageFraction(status) : 0;

  const barColor = exhausted ? colors.danger : colors.accent;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: exhausted ? colors.danger : colors.border,
          opacity: limit.enabled ? 1 : 0.6,
        },
      ]}
    >
      <View style={styles.cardHead}>
        <Pressable
          testID={`limit-${limit.id}`}
          accessibilityRole="button"
          accessibilityLabel={`Edit daily limit for ${appName}`}
          onPress={onEdit}
          style={styles.cardHeadText}
        >
          <Text style={[styles.appName, { color: colors.text }]} numberOfLines={1}>
            {appName}
          </Text>
          <Text style={[styles.limitLabel, { color: colors.textMuted }]}>
            {formatLimit(limit.dailyLimitSeconds)}/day
            {limit.strictMode ? ' · Strict Mode' : ''}
          </Text>
        </Pressable>

        <Switch
          accessibilityLabel={`${appName} daily limit enabled`}
          value={limit.enabled}
          onValueChange={onToggle}
          trackColor={{ false: colors.surfaceMuted, true: colors.accent }}
          thumbColor={colors.surface}
        />
      </View>

      <View
        accessibilityRole="progressbar"
        accessibilityLabel={
          unknown
            ? `${appName}: usage unavailable`
            : `${appName}: ${formatUsageSummary(status)}`
        }
        style={[styles.track, { backgroundColor: colors.surfaceMuted }]}
      >
        <View
          style={[
            styles.fill,
            { backgroundColor: barColor, width: `${Math.round(fraction * 100)}%` },
          ]}
        />
      </View>

      <View style={styles.cardFoot}>
        <Text style={[styles.usage, { color: unknown ? colors.textFaint : colors.textMuted }]}>
          {status == null
            ? 'Calculating…'
            : unknown
              ? "Can't measure right now"
              : formatUsageSummary(status)}
        </Text>

        {exhausted ? (
          <Text style={[styles.locked, { color: colors.danger }]}>🔒 Locked until tomorrow</Text>
        ) : status && !unknown ? (
          <Text style={[styles.usage, { color: colors.textMuted }]}>
            {formatRemaining(status.remainingSeconds)}
          </Text>
        ) : null}
      </View>

      <Pressable
        testID={`delete-limit-${limit.id}`}
        accessibilityRole="button"
        accessibilityLabel={`Delete daily limit for ${appName}`}
        onPress={onDelete}
        hitSlop={8}
        style={styles.delete}
      >
        <Text style={[styles.deleteLabel, { color: colors.danger }]}>Delete</Text>
      </Pressable>
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
  muted: {
    ...typography.body,
    paddingVertical: spacing.xl,
    textAlign: 'center',
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
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxxl,
  },
  emptyIcon: { fontSize: 34 },
  emptyTitle: typography.heading,
  emptyBody: {
    ...typography.body,
    textAlign: 'center',
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  cardHeadText: { flex: 1, gap: 2 },
  appName: {
    ...typography.body,
    fontWeight: '700',
    fontSize: 17,
  },
  limitLabel: typography.caption,
  track: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: {
    height: 8,
    borderRadius: 4,
  },
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  usage: typography.caption,
  locked: {
    ...typography.caption,
    fontWeight: '700',
  },
  delete: {
    alignSelf: 'flex-start',
    minHeight: 40,
    justifyContent: 'center',
  },
  deleteLabel: {
    ...typography.caption,
    fontWeight: '600',
  },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
});
