import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { Toggle } from '../components/Toggle';
import { radius, spacing, typography, useTheme } from '../constants/theme';
import { usePermissionStatus } from '../hooks/usePermissionStatus';
import { useSubscription } from '../hooks/useSubscription';
import type { ScreenProps } from '../navigation/types';
import { useDailyLimitStore } from '../store/useDailyLimitStore';
import { useLockStore } from '../store/useLockStore';
import { toLockError } from '../utils/errors';
import {
  LIMIT_PRESETS_SECONDS,
  MAX_LIMIT_SECONDS,
  MIN_LIMIT_SECONDS,
  formatLimit,
  validateLimit,
} from '../utils/dailyUsage';

/**
 * Create or edit a daily limit.
 *
 * One short screen: app, duration, strict. The common case — "15 minutes of
 * YouTube" — should take a few taps, so durations are presets with a stepper
 * for anything else rather than a picker.
 */
export function CreateDailyLimitScreen({
  navigation,
  route,
}: ScreenProps<'CreateDailyLimit'>) {
  const { colors } = useTheme();
  const { limits: tierLimits } = useSubscription();
  const { permissions } = usePermissionStatus();

  const editingId = route.params?.limitId;
  const limits = useDailyLimitStore((s) => s.limits);
  const create = useDailyLimitStore((s) => s.create);
  const update = useDailyLimitStore((s) => s.update);

  const existing = useMemo(
    () => limits.find((l) => l.id === editingId) ?? null,
    [editingId, limits]
  );

  const availableApps = useLockStore((s) => s.availableApps);
  const selectedApps = useLockStore((s) => s.selectedApps);
  const loadAvailableApps = useLockStore((s) => s.loadAvailableApps);

  const [seconds, setSeconds] = useState(existing?.dailyLimitSeconds ?? 15 * 60);
  const [strictMode, setStrictMode] = useState(existing?.strictMode ?? false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadAvailableApps();
  }, [loadAvailableApps]);

  /**
   * The app this limit governs.
   *
   * Reuses the shared selection the manual flow writes to rather than
   * duplicating installed-app discovery. Editing keeps its own app fixed:
   * changing which app a limit belongs to is really a different limit.
   */
  // The picker hands its answer back through route params, so choosing an app
  // for a limit no longer disturbs whatever is selected for a manual lock.
  const packageName =
    route.params?.packageName ?? existing?.appPackageName ?? selectedApps[0]?.id ?? '';
  const appName = useMemo(() => {
    if (!packageName) return '';
    return availableApps.find((a) => a.id === packageName)?.name ?? packageName;
  }, [availableApps, packageName]);

  const usageAccess = permissions.find((p) => p.id === 'usageAccess');
  const usageAccessMissing = usageAccess != null && usageAccess.status !== 'granted';

  const validation = useMemo(
    () => validateLimit({ appPackageName: packageName, dailyLimitSeconds: seconds }, limits, editingId),
    [editingId, limits, packageName, seconds]
  );

  const adjust = useCallback((deltaMinutes: number) => {
    setSeconds((current) => {
      const next = current + deltaMinutes * 60;
      return Math.min(MAX_LIMIT_SECONDS, Math.max(MIN_LIMIT_SECONDS, next));
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!validation.valid) {
      Alert.alert('Cannot save', validation.reason ?? 'This limit is not valid.');
      return;
    }

    // A limit that cannot be measured cannot be enforced, so send the user to
    // fix that rather than saving something inert.
    if (usageAccessMissing) {
      navigation.navigate('Permissions');
      return;
    }

    setSaving(true);
    try {
      if (existing) {
        await update({ ...existing, dailyLimitSeconds: seconds, strictMode });
      } else {
        await create({ appPackageName: packageName, dailyLimitSeconds: seconds, strictMode });
      }
      navigation.goBack();
    } catch (err) {
      Alert.alert('Could not save', toLockError(err).message);
    } finally {
      setSaving(false);
    }
  }, [
    create,
    existing,
    navigation,
    packageName,
    seconds,
    strictMode,
    update,
    usageAccessMissing,
    validation,
  ]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card
          title="App"
          subtitle={
            existing
              ? 'The app a limit belongs to cannot be changed. Delete it and make a new one instead.'
              : packageName
                ? undefined
                : 'Choose which app this daily limit applies to.'
          }
        >
          {packageName ? (
            <Text style={[styles.appName, { color: colors.text }]}>{appName}</Text>
          ) : null}

          {!existing ? (
            <PrimaryButton
              testID="limit-choose-app"
              label={packageName ? 'Change app' : 'Choose app'}
              variant="secondary"
              onPress={() =>
                navigation.navigate('AppSelection', {
                  purpose: 'dailyLimit',
                  preselected: packageName ? [packageName] : [],
                })
              }
            />
          ) : null}
        </Card>

        <Card title="Daily allowance" subtitle="Measured from real time spent in the app.">
          <View style={styles.presets}>
            {LIMIT_PRESETS_SECONDS.map((preset) => {
              const active = seconds === preset;
              return (
                <Pressable
                  key={preset}
                  testID={`limit-preset-${preset}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={formatLimit(preset)}
                  onPress={() => setSeconds(preset)}
                  style={[
                    styles.preset,
                    {
                      backgroundColor: active ? colors.accentSoft : colors.surfaceMuted,
                      borderColor: active ? colors.accent : 'transparent',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.presetLabel,
                      { color: active ? colors.accent : colors.text },
                    ]}
                  >
                    {formatLimit(preset)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.stepperRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Decrease by 5 minutes"
              onPress={() => adjust(-5)}
              style={[styles.stepper, { borderColor: colors.border }]}
            >
              <Text style={[styles.stepperLabel, { color: colors.text }]}>−5m</Text>
            </Pressable>

            <Text style={[styles.current, { color: colors.text }]}>
              {formatLimit(seconds)}/day
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Increase by 5 minutes"
              onPress={() => adjust(5)}
              style={[styles.stepper, { borderColor: colors.border }]}
            >
              <Text style={[styles.stepperLabel, { color: colors.text }]}>+5m</Text>
            </Pressable>
          </View>
        </Card>

        <Card>
          <Toggle
            testID="limit-strict"
            label="Strict Mode"
            description="Use the strongest enforcement available on this device once the allowance is spent."
            value={strictMode}
            onChange={setStrictMode}
            locked={!tierLimits.strictMode}
            onLockedPress={() =>
              navigation.navigate('Subscription', {
                reason: 'Strict Mode is a Pro feature.',
              })
            }
          />
        </Card>

        {usageAccessMissing ? (
          <Text style={[styles.warning, { color: colors.danger }]}>
            Daily limits need Usage Access before they can be measured or enforced.
          </Text>
        ) : null}

        {!validation.valid ? (
          <Text style={[styles.warning, { color: colors.danger }]}>{validation.reason}</Text>
        ) : null}

        <Text style={[styles.footnote, { color: colors.textFaint }]}>
          The allowance resets at midnight, on your device&apos;s local calendar day. Android
          reports usage in short intervals, so the figure can lag real time by a few seconds.
        </Text>
      </ScrollView>

      <View style={[styles.footer, { borderColor: colors.border }]}>
        <PrimaryButton
          testID="save-daily-limit"
          label={existing ? 'Save changes' : 'Save limit'}
          size="large"
          loading={saving}
          disabled={!packageName}
          onPress={() => void handleSave()}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.lg,
    gap: spacing.lg,
  },
  appName: {
    ...typography.heading,
    marginBottom: spacing.md,
  },
  presets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  preset: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetLabel: typography.label,
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  stepper: {
    borderWidth: 1,
    borderRadius: radius.sm,
    minHeight: 44,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperLabel: typography.label,
  current: {
    ...typography.heading,
    fontSize: 20,
  },
  warning: {
    ...typography.caption,
    lineHeight: 18,
  },
  footnote: {
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
