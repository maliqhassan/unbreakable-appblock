import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '../components/EmptyState';
import { PrimaryButton } from '../components/PrimaryButton';
import { ProgressRing } from '../components/ProgressRing';
import { StatusBadge } from '../components/StatusBadge';
import { quoteForSession } from '../constants/quotes';
import { radius, spacing, typography, useTheme } from '../constants/theme';
import { useAppForeground } from '../hooks/useAppForeground';
import { useCountdown } from '../hooks/useCountdown';
import type { ScreenProps } from '../navigation/types';
import { useLockStore } from '../store/useLockStore';
import { toLockError } from '../utils/errors';
import { formatClockTime } from '../utils/time';

/**
 * Screen 3 — the running lock.
 *
 * Two rules this screen exists to honour:
 *   1. Remaining time is always `endTimestamp - now`, so closing the app,
 *      changing the clock, or a throttled timer cannot shorten a lock.
 *   2. Under Strict Mode there is no cancel button at all — not a disabled one,
 *      not one that shows an error. The native layer would refuse anyway, and a
 *      button that never works is a lie.
 *
 * The tone is deliberately encouraging rather than explanatory: someone who
 * just hit a block does not need a lecture about the lock, they need a reason
 * to go back to what they were doing.
 */
export function ActiveLockScreen({ navigation }: ScreenProps<'ActiveLock'>) {
  const { colors } = useTheme();
  const [stopping, setStopping] = useState(false);

  const session = useLockStore((s) => s.session);
  const capabilities = useLockStore((s) => s.capabilities);
  const stopLock = useLockStore((s) => s.stopLock);
  const syncExpiry = useLockStore((s) => s.syncExpiry);
  const refreshFromNative = useLockStore((s) => s.refreshFromNative);
  const acknowledgeCompletion = useLockStore((s) => s.acknowledgeCompletion);

  // Coming back from the background is the moment a lock that expired while we
  // were away needs to be settled — and the moment a permission revoked in
  // Settings needs to be noticed.
  useAppForeground(() => {
    void syncExpiry();
    void refreshFromNative();
  });

  // Enforcement can also degrade while this screen is open (a permission pulled
  // from the notification shade), so poll native occasionally too.
  useEffect(() => {
    const interval = setInterval(() => void refreshFromNative(), 10_000);
    return () => clearInterval(interval);
  }, [refreshFromNative]);

  const handleExpire = useCallback(() => {
    void syncExpiry();
  }, [syncExpiry]);

  const handleFinish = useCallback(() => {
    acknowledgeCompletion();
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  }, [acknowledgeCompletion, navigation]);

  const handleStop = useCallback(async () => {
    setStopping(true);
    try {
      await stopLock();
      handleFinish();
    } catch (err) {
      Alert.alert('Cannot end this lock', toLockError(err).message);
    } finally {
      setStopping(false);
    }
  }, [handleFinish, stopLock]);

  const quote = useMemo(
    () => quoteForSession(session?.id ?? 'default'),
    [session?.id]
  );

  /**
   * Leaves the countdown without touching the lock.
   *
   * When ActiveLock is the launch route there is nothing to pop back to, so
   * navigate to Home explicitly rather than leaving a dead chevron.
   */
  const goBackToApp = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Home');
  }, [navigation]);

  if (!session) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.centered}>
          <EmptyState title="No lock running" description="Choose some apps to get started." />
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Back to apps" onPress={handleFinish} />
        </View>
      </SafeAreaView>
    );
  }

  if (session.status === 'completed') {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.centered}>
          <EmptyState
            icon="✅"
            title="Session complete"
            description="Nice work. Your apps are available again."
          />
        </View>
        <View style={styles.footer}>
          <PrimaryButton testID="finish" label="Done" onPress={handleFinish} />
        </View>
      </SafeAreaView>
    );
  }

  if (session.status === 'failed') {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.centered}>
          <EmptyState
            icon="⚠️"
            title="The lock stopped"
            description={
              session.failureReason ??
              'Enforcement ended unexpectedly. Nothing is being blocked right now.'
            }
          />
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Back to apps" onPress={handleFinish} />
        </View>
      </SafeAreaView>
    );
  }

  const strict = session.strictMode;
  const degraded = session.degradedReason;
  const scheduled = session.source === 'schedule';
  const dailyLimit = session.source === 'daily_usage';
  // Only offer an exit the platform will honour.
  const canEndEarly = !strict || !capabilities.canBlockEarlyExit;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.badgeRow}>
          <StatusBadge
            label={
              degraded
                ? 'Not Enforcing'
                : dailyLimit
                  ? 'Daily limit reached'
                  : scheduled
                    ? 'Scheduled Lock'
                    : strict
                      ? 'Strict Mode'
                      : 'Lock Active'
            }
            tone={degraded ? 'danger' : strict ? 'warning' : 'active'}
          />
          {scheduled && session.scheduleName ? (
            <Text style={[styles.scheduleName, { color: colors.textMuted }]}>
              {session.scheduleName}
              {strict ? ' · Strict Mode' : ''}
            </Text>
          ) : null}
        </View>

        {degraded ? (
          <View style={[styles.degraded, { borderColor: colors.danger }]}>
            <Text style={[styles.degradedTitle, { color: colors.danger }]}>
              Your apps are not being blocked
            </Text>
            <Text style={[styles.degradedBody, { color: colors.textMuted }]}>{degraded}</Text>
            <PrimaryButton
              label="Fix permissions"
              variant="secondary"
              onPress={() => navigation.navigate('Permissions')}
            />
          </View>
        ) : null}

        {dailyLimit ? (
          <View style={styles.dailyBlock}>
            <Text style={styles.dailyIcon}>🔒</Text>
            <Text style={[styles.dailyTitle, { color: colors.text }]}>
              Locked until tomorrow
            </Text>
            <Text style={[styles.dailyBody, { color: colors.textMuted }]}>
              You have used today&apos;s allowance
              {session.selectedApps.length === 1
                ? ` for ${session.selectedApps[0].name}`
                : ''}
              . It resets at midnight.
            </Text>
            {strict ? (
              <Text style={[styles.dailyBody, { color: colors.warning }]}>
                Strict Mode is on, so this cannot be ended early.
              </Text>
            ) : null}
          </View>
        ) : (
          <RingTimer
            startTimestamp={session.startTimestamp}
            endTimestamp={session.endTimestamp}
            onExpire={handleExpire}
            degraded={degraded != null}
          />
        )}

        <Text style={[styles.quote, { color: colors.text }]}>{quote}</Text>

        <View style={styles.chips}>
          {session.selectedApps.map((app) => (
            <View
              key={app.id}
              style={[
                styles.chip,
                { backgroundColor: colors.surfaceMuted, borderColor: 'transparent' },
              ]}
            >
              <Text style={styles.chipIcon}>🔒</Text>
              <Text
                style={[styles.chipLabel, { color: colors.text }]}
                numberOfLines={1}
              >
                {app.opaque ? 'Selected app' : app.name}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.footer, { borderColor: colors.border, borderTopWidth: 1 }]}>
        <PrimaryButton
          testID="add-apps"
          label="Add more apps"
          variant="secondary"
          onPress={() => navigation.navigate('AppSelection')}
        />

        {canEndEarly ? (
          <PrimaryButton
            testID="end-lock"
            label="End lock"
            variant="ghost"
            loading={stopping}
            onPress={() => void handleStop()}
          />
        ) : (
          <PrimaryButton
            testID="back-to-app"
            label="Back to app"
            variant="ghost"
            onPress={goBackToApp}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

/** The countdown, drawn as a ring that empties as the session runs down. */
function RingTimer({
  startTimestamp,
  endTimestamp,
  onExpire,
  degraded,
}: {
  startTimestamp: number;
  endTimestamp: number;
  onExpire: () => void;
  degraded: boolean;
}) {
  const { colors } = useTheme();
  const remaining = useCountdown(endTimestamp, onExpire);

  const total = Math.max(1, endTimestamp - startTimestamp);
  const elapsed = total - remaining.totalMs;

  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  const digits = `${pad(remaining.hours)}:${pad(remaining.minutes)}:${pad(remaining.seconds)}`;

  return (
    <View style={styles.ringBlock}>
      <ProgressRing
        progress={elapsed / total}
        size={286}
        thickness={12}
        color={degraded ? colors.danger : colors.accent}
      >
        <Text
          testID="countdown"
          accessibilityRole="timer"
          accessibilityLabel={`${remaining.hours} hours, ${remaining.minutes} minutes, ${remaining.seconds} seconds remaining`}
          style={[styles.digits, { color: colors.text }]}
        >
          {digits}
        </Text>
        <Text style={[styles.untilLabel, { color: colors.textMuted }]}>
          until {formatClockTime(endTimestamp)}
        </Text>
      </ProgressRing>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  centered: {
    flex: 1,
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.xxl,
    alignItems: 'center',
  },
  badgeRow: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  scheduleName: {
    ...typography.caption,
    fontWeight: '600',
  },
  dailyBlock: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  dailyIcon: { fontSize: 48 },
  dailyTitle: {
    ...typography.title,
    textAlign: 'center',
  },
  dailyBody: {
    ...typography.body,
    textAlign: 'center',
    lineHeight: 23,
  },
  ringBlock: {
    alignItems: 'center',
  },
  digits: {
    fontSize: 46,
    fontWeight: '800',
    letterSpacing: -1.5,
    fontVariant: ['tabular-nums'],
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  untilLabel: {
    ...typography.eyebrow,
    marginTop: spacing.md,
  },
  quote: {
    ...typography.title,
    fontSize: 21,
    lineHeight: 30,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: 200,
  },
  chipIcon: {
    fontSize: 12,
  },
  chipLabel: {
    ...typography.caption,
    fontWeight: '600',
    flexShrink: 1,
  },
  degraded: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  degradedTitle: {
    ...typography.label,
    fontSize: 15,
  },
  degradedBody: {
    ...typography.caption,
    lineHeight: 19,
  },
  footer: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
});
