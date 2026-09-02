import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { RequirementsCard } from '../components/RequirementsCard';
import { Toggle } from '../components/Toggle';
import {
  DURATION_PRESETS,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
} from '../constants/limits';
import { radius, spacing, typography, useTheme } from '../constants/theme';
import { useAppForeground } from '../hooks/useAppForeground';
import { useSubscription } from '../hooks/useSubscription';
import type { ScreenProps } from '../navigation/types';
import { LockService } from '../services/LockService';
import { PermissionService } from '../services/PermissionService';
import { useLockStore } from '../store/useLockStore';
import { toLockError } from '../utils/errors';
import { formatClockTime, formatDuration, minutesToMs } from '../utils/time';

/**
 * Screen 2 — duration, Strict Mode, and the checks that run before a lock
 * starts: tier validation, then permissions, then native enforcement.
 */
export function LockConfigurationScreen({ navigation }: ScreenProps<'LockConfiguration'>) {
  const { colors } = useTheme();

  const [durationMinutes, setDurationMinutes] = useState(30);
  const [strictMode, setStrictMode] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState(() => PermissionService.getAll());

  const selectedApps = useLockStore((s) => s.selectedApps);
  const startLock = useLockStore((s) => s.startLock);
  const capabilities = useLockStore((s) => s.capabilities);
  const session = useLockStore((s) => s.session);

  // A lock is already running: configuring a second one can only end in
  // ALREADY_ACTIVE, so show the running lock instead of letting the user set up
  // something that cannot start.
  const lockRunning = session?.status === 'active' || session?.status === 'preparing';
  useEffect(() => {
    if (lockRunning) navigation.replace('ActiveLock');
  }, [lockRunning, navigation]);

  // The one entitlement entry point; never RevenueCat or the store directly.
  const { tier, limits } = useSubscription();

  // Permissions are granted in system Settings, so re-check on the way back in.
  useAppForeground(() => setPermissions(PermissionService.getAll()));

  // "Lock until 6:30 PM" is relative to now, so `now` is state on a slow timer
  // rather than a Date.now() read during render — which would drift silently
  // and only update whenever something else happened to re-render.
  const requirementsMet = permissions
    .filter((p) => !p.optional)
    .every((p) => p.status === 'granted' || p.status === 'unavailable');

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(interval);
  }, []);

  const endTimestamp = now + minutesToMs(durationMinutes);

  const validation = useMemo(
    () => LockService.validateConfiguration(selectedApps, durationMinutes, strictMode, tier),
    [durationMinutes, selectedApps, strictMode, tier]
  );

  const goToSubscription = useCallback(
    (reason: string) => navigation.navigate('Subscription', { reason }),
    [navigation]
  );

  // Duration is free for everyone; only the app count and Strict Mode are paid.
  const handlePreset = useCallback((minutes: number) => setDurationMinutes(minutes), []);

  /**
   * Custom duration, clamped to the engine's technical bounds only.
   *
   * MAX_DURATION_MINUTES is a safety ceiling, not a plan restriction — beyond a
   * day a "lock" is really a schedule, which has its own feature.
   */
  const adjustCustom = useCallback((delta: number) => {
    setDurationMinutes((current) =>
      Math.min(MAX_DURATION_MINUTES, Math.max(MIN_DURATION_MINUTES, current + delta))
    );
  }, []);

  const handleStart = useCallback(async () => {
    setError(null);

    if (!validation.valid) {
      if (validation.requiresPro) {
        goToSubscription(validation.reason ?? 'This needs Pro.');
        return;
      }
      setError(validation.reason ?? 'This configuration is not valid.');
      return;
    }

    // The requirements gate: never start a lock that cannot actually enforce.
    const missing = PermissionService.missingRequired();
    if (missing.length > 0) {
      setPermissions(PermissionService.getAll());
      navigation.navigate('Permissions');
      return;
    }

    setStarting(true);
    try {
      await startLock(durationMinutes, strictMode);
      // Replace, not push: the config screen must not sit behind an active lock
      // where a back gesture could reach it.
      navigation.replace('ActiveLock');
    } catch (err) {
      const lockError = toLockError(err);
      if (lockError.code === 'PERMISSION_REQUIRED') {
        setPermissions(PermissionService.getAll());
        navigation.navigate('Permissions');
      } else if (lockError.code === 'ALREADY_ACTIVE') {
        navigation.replace('ActiveLock');
      } else {
        setError(lockError.message);
        Alert.alert('Could not start the lock', lockError.message);
      }
    } finally {
      setStarting(false);
    }
  }, [
    durationMinutes,
    goToSubscription,
    navigation,
    startLock,
    strictMode,
    validation,
  ]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: colors.text }]}>Configure your lock</Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          Blocking {selectedApps.length} app{selectedApps.length === 1 ? '' : 's'}.
        </Text>

        <Card title="Duration">
          <View style={styles.presets}>
            {DURATION_PRESETS.map((preset) => {
              const active = durationMinutes === preset.minutes;
              return (
                <Pressable
                  key={preset.minutes}
                  testID={`duration-${preset.minutes}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={preset.label}
                  onPress={() => handlePreset(preset.minutes)}
                  style={[
                    styles.preset,
                    {
                      borderColor: active ? colors.accent : colors.border,
                      backgroundColor: active ? colors.surfaceMuted : colors.surface,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.presetLabel,
                      { color: active ? colors.accent : colors.text },
                    ]}
                  >
                    {preset.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.customRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Decrease duration by 5 minutes"
              onPress={() => adjustCustom(-5)}
              style={[styles.stepper, { borderColor: colors.border }]}
            >
              <Text style={[styles.stepperLabel, { color: colors.text }]}>−5m</Text>
            </Pressable>

            <Text style={[styles.customValue, { color: colors.text }]}>
              {formatDuration(durationMinutes)}
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Increase duration by 5 minutes"
              onPress={() => adjustCustom(5)}
              style={[styles.stepper, { borderColor: colors.border }]}
            >
              <Text style={[styles.stepperLabel, { color: colors.text }]}>+5m</Text>
            </Pressable>
          </View>

          <Text style={[styles.until, { color: colors.textMuted }]}>
            Lock until {formatClockTime(endTimestamp)}
          </Text>
        </Card>

        <Card>
          <Toggle
            testID="strict-toggle"
            label="Strict Mode"
            description="Uses stronger OS-level restrictions where supported. The lock cannot be ended early."
            value={strictMode}
            onChange={setStrictMode}
            locked={!limits.strictMode}
            onLockedPress={() => goToSubscription('Strict Mode is a Pro feature.')}
          />

          {strictMode && limits.strictMode ? (
            <Text style={[styles.strictNote, { color: colors.warning }]}>
              {capabilities.canBlockEarlyExit
                ? 'Once started, this lock cannot be ended from inside the app until the timer runs out.'
                : 'This build cannot enforce an early-exit block, so Strict Mode will behave like a normal lock.'}
            </Text>
          ) : null}
        </Card>

        <Card title="What this build can do" subtitle="Reported by the OS, not assumed.">
          <CapabilityLine label="Block the selected apps" value={capabilities.canShieldApps} />
          <CapabilityLine label="Keep running if the app is killed" value={capabilities.canSurviveJsDeath} />
          <CapabilityLine label="Survive a restart" value={capabilities.canSurviveReboot} />
          <CapabilityLine label="Prevent uninstalling this app" value={capabilities.canPreventUninstall} />
          <CapabilityLine label="Restrict system Settings" value={capabilities.canRestrictSettings} />
        </Card>

        <RequirementsCard
          permissions={permissions}
          onOpenPermissions={() => navigation.navigate('Permissions')}
        />

        {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
      </ScrollView>

      <View style={[styles.footer, { borderColor: colors.border }]}>
        <PrimaryButton
          testID="start-lock"
          label={requirementsMet ? 'Start Lock' : 'Check Requirements'}
          caption={
            requirementsMet
              ? `Lock until ${formatClockTime(endTimestamp)}`
              : 'Permissions are needed before a lock can run'
          }
          loading={starting}
          disabled={selectedApps.length === 0}
          onPress={() => void handleStart()}
        />
      </View>
    </SafeAreaView>
  );
}

function CapabilityLine({ label, value }: { label: string; value: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.capabilityRow}>
      <Text style={[styles.capabilityMark, { color: value ? colors.success : colors.textFaint }]}>
        {value ? '✓' : '—'}
      </Text>
      <Text style={[styles.capabilityLabel, { color: value ? colors.text : colors.textMuted }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: typography.display,
  subtitle: {
    ...typography.body,
    marginTop: -spacing.sm,
  },
  presets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  preset: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.sm,
  },
  presetLabel: {
    ...typography.label,
  },
  presetPro: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '700',
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  stepper: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.sm,
  },
  stepperLabel: typography.label,
  customValue: {
    ...typography.heading,
    fontVariant: ['tabular-nums'],
  },
  until: {
    ...typography.body,
    marginTop: spacing.md,
  },
  strictNote: {
    ...typography.caption,
    marginTop: spacing.md,
    lineHeight: 18,
  },
  capabilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 3,
  },
  capabilityMark: {
    ...typography.label,
    width: 16,
  },
  capabilityLabel: {
    ...typography.caption,
    flex: 1,
  },
  permissionWarning: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  permissionWarningText: {
    ...typography.caption,
    fontWeight: '600',
  },
  error: typography.caption,
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
});
