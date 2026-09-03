import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppRow } from '../components/AppRow';
import { EmptyState } from '../components/EmptyState';
import { LogoLoader } from '../components/LogoLoader';
import { PrimaryButton } from '../components/PrimaryButton';
import { SearchBar } from '../components/SearchBar';
import { StatusBadge } from '../components/StatusBadge';
import { radius, spacing, typography, useTheme } from '../constants/theme';
import { useSubscription } from '../hooks/useSubscription';
import { LockService, usesSystemAppPicker } from '../services/LockService';
import { useLockStore } from '../store/useLockStore';
import type { ScreenProps } from '../navigation/types';
import type { TargetApp } from '../types';
import { toLockError } from '../utils/errors';

/**
 * Choose what to block.
 *
 * Android lists the installed apps. iOS cannot: Apple never exposes them, so
 * the same screen offers a button that opens Apple's own picker and then shows
 * a count of what was chosen. The difference is stated in the UI, not hidden.
 */
export function AppSelectionScreen({ navigation, route }: ScreenProps<'AppSelection'>) {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');

  /**
   * Who opened this screen.
   *
   * 'lock' is the original job — pick apps, then set a timer. The other two are
   * *pickers*: a daily limit or a schedule needs an app chosen, and the answer
   * belongs to that screen, not to the manual lock. Before this, both reused
   * the lock flow wholesale, so configuring a daily limit offered "Set Timer",
   * dropped the user into the lock configuration screen, and quietly replaced
   * whatever they had selected for a manual lock.
   */
  const purpose = route.params?.purpose ?? 'lock';
  const picking = purpose !== 'lock';
  /** A daily limit covers exactly one app. */
  const singleChoice = purpose === 'dailyLimit';

  // In picker mode the choice is local and handed back through route params,
  // so it never touches the manual lock's selection.
  const [picked, setPicked] = useState<string[]>(route.params?.preselected ?? []);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);

  const availableApps = useLockStore((s) => s.availableApps);
  const selectedApps = useLockStore((s) => s.selectedApps);
  const loadingApps = useLockStore((s) => s.loadingApps);
  const appsError = useLockStore((s) => s.appsError);
  const loadAvailableApps = useLockStore((s) => s.loadAvailableApps);
  const toggleApp = useLockStore((s) => s.toggleApp);
  const setSelectedApps = useLockStore((s) => s.setSelectedApps);
  const capabilities = useLockStore((s) => s.capabilities);
  const session = useLockStore((s) => s.session);
  const addAppsToRunningLock = useLockStore((s) => s.addAppsToRunningLock);

  /**
   * With a lock already running, this screen becomes "add to it" rather than
   * "start a new one". Starting a second lock is impossible by design; adding
   * to the existing one is what the user actually means by picking another app.
   */
  const lockRunning = session?.status === 'active';
  const lockedIds = useMemo(
    () => new Set((session?.selectedApps ?? []).map((a) => a.id)),
    [session?.selectedApps]
  );
  const [adding, setAdding] = useState(false);

  // The one entitlement entry point; never RevenueCat or the store directly.
  const { tier, limits } = useSubscription();

  useEffect(() => {
    void loadAvailableApps();
  }, [loadAvailableApps]);

  useEffect(() => {
    if (!lockRunning || lockedIds.size === 0) return;
    const missing = (session?.selectedApps ?? []).filter(
      (app) => !selectedApps.some((s) => s.id === app.id)
    );
    if (missing.length > 0) setSelectedApps([...selectedApps, ...missing]);
    // Only when the running session changes; selectedApps is intentionally
    // omitted so ticking another app does not re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockRunning, session?.selectedApps]);


  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return availableApps;
    return availableApps.filter((app) => app.name.toLowerCase().includes(q));
  }, [availableApps, query]);

  const selectedIds = useMemo(
    () => new Set(picking ? picked : selectedApps.map((a) => a.id)),
    [picked, picking, selectedApps]
  );

  // A daily limit is one app by definition, not by plan, so the paywall does
  // not apply to that picker.
  const atFreeLimit = singleChoice
    ? false
    : selectedIds.size >= limits.maxApps;

  const handleToggle = useCallback(
    (app: TargetApp) => {
      // An app the running lock already covers cannot be un-picked here.
      // Native only ever adds; removing a target mid-session would be a way to
      // weaken a lock, which is exactly what Strict Mode forbids.
      if (lockRunning && lockedIds.has(app.id)) {
        Alert.alert(
          `${app.name} is already locked`,
          'Apps cannot be removed while a lock is running. It unlocks when the timer ends.'
        );
        return;
      }

      if (picking) {
        // Local only: the answer goes back to the screen that asked for it.
        setPicked((current) =>
          singleChoice
            ? [app.id]
            : current.includes(app.id)
              ? current.filter((id) => id !== app.id)
              : [...current, app.id]
        );
        return;
      }

      const alreadySelected = selectedIds.has(app.id);
      if (!alreadySelected && atFreeLimit) {
        // The count above already says "1 of 1", so this is a confirmation of
        // something visible rather than a surprise at save time.
        navigation.navigate('Subscription', {
          reason:
            `Free protects ${limits.maxApps} app at a time. ` +
            'Upgrade to Pro for unlimited apps.',
        });
        return;
      }
      toggleApp(app);
    },
    [
      atFreeLimit,
      limits.maxApps,
      lockRunning,
      lockedIds,
      navigation,
      picking,
      selectedIds,
      singleChoice,
      toggleApp,
    ]
  );

  /** Hands the choice back to the screen that opened the picker. */
  const confirmPick = useCallback(() => {
    if (purpose === 'dailyLimit') {
      navigation.navigate({
        name: 'CreateDailyLimit',
        params: { packageName: picked[0] },
        merge: true,
      });
      return;
    }
    navigation.navigate({
      name: 'CreateSchedule',
      params: { packageNames: picked },
      merge: true,
    });
  }, [navigation, picked, purpose]);

  const openSystemPicker = useCallback(async () => {
    setPickerBusy(true);
    setPickerError(null);
    try {
      const chosen = await LockService.pickAppsWithSystemUI();
      if (chosen.length > limits.maxApps) {
        // Apple's picker has no idea about our tiers, so the check lands here.
        navigation.navigate('Subscription', {
          reason: `Your plan blocks ${limits.maxApps} app at a time. You chose ${chosen.length}.`,
        });
      }
      setSelectedApps(chosen);
    } catch (err) {
      const error = toLockError(err);
      setPickerError(
        error.code === 'AUTHORIZATION_DENIED'
          ? 'Screen Time access is needed before you can choose apps.'
          : error.message
      );
    } finally {
      setPickerBusy(false);
    }
  }, [limits.maxApps, navigation, setSelectedApps]);

  const showNoEnforcementWarning = !capabilities.canShieldApps;

  const additions = useMemo(
    () => selectedApps.filter((app) => !lockedIds.has(app.id)),
    [lockedIds, selectedApps]
  );

  /**
   * Merges the newly ticked apps into the running session.
   *
   * Works during Strict Mode: adding targets only ever tightens the lock, and
   * Strict Mode exists to stop someone weakening a commitment, not committing
   * harder. The timer is untouched.
   */
  const handleAddToLock = useCallback(async () => {
    if (additions.length === 0) {
      navigation.navigate('ActiveLock');
      return;
    }

    // The tier ceiling counts the whole session, not just the additions.
    if (lockedIds.size + additions.length > limits.maxApps) {
      navigation.navigate('Subscription', {
        reason:
          `Your plan blocks ${limits.maxApps} app at a time. ` +
          'Pro blocks as many as you like, and lets you add more mid-session.',
      });
      return;
    }

    setAdding(true);
    try {
      await addAppsToRunningLock(additions);
      navigation.navigate('ActiveLock');
    } catch (err) {
      Alert.alert('Could not add', toLockError(err).message);
    } finally {
      setAdding(false);
    }
  }, [addAppsToRunningLock, additions, limits.maxApps, lockedIds.size, navigation]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList
        data={usesSystemAppPicker ? selectedApps : filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          usesSystemAppPicker ? undefined : (
            <RefreshControl
              refreshing={loadingApps}
              onRefresh={() => void loadAvailableApps()}
              tintColor={colors.textMuted}
            />
          )
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>
              {lockRunning ? 'Add to your lock' : 'Choose what to block'}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textMuted }]}>
              {lockRunning
                ? 'Pick more apps to add to the session already running. Your timer will not change.'
                : usesSystemAppPicker
                  ? 'Apple keeps your app list private, so choices are made in the Screen Time picker.'
                  : 'Pick the apps you want out of reach while the lock runs.'}
            </Text>

            {showNoEnforcementWarning ? (
              <View style={[styles.notice, { borderColor: colors.warning }]}>
                <Text style={[styles.noticeText, { color: colors.warning }]}>
                  Enforcement is not available in this build, so nothing will actually be
                  blocked. Run a development build to enable it.
                </Text>
              </View>
            ) : null}

            {usesSystemAppPicker ? (
              <View style={styles.pickerBlock}>
                <PrimaryButton
                  label={selectedApps.length > 0 ? 'Change selection' : 'Choose apps'}
                  onPress={() => void openSystemPicker()}
                  variant="secondary"
                  loading={pickerBusy}
                />
                {pickerError ? (
                  <Text style={[styles.error, { color: colors.danger }]}>{pickerError}</Text>
                ) : null}
              </View>
            ) : (
              <SearchBar value={query} onChange={setQuery} />
            )}

            <View style={styles.countRow}>
              <StatusBadge
                label={
                  tier === 'FREE'
                    ? `${selectedApps.length} of ${limits.maxApps} apps protected`
                    : selectedApps.length === 0
                      ? 'No apps selected'
                      : `${selectedApps.length} selected`
                }
                tone={
                  selectedApps.length === 0
                    ? 'neutral'
                    : atFreeLimit && tier === 'FREE'
                      ? 'warning'
                      : 'active'
                }
              />
              {tier === 'FREE' && atFreeLimit ? (
                <Text style={[styles.limitHint, { color: colors.textFaint }]}>
                  Pro unlocks more
                </Text>
              ) : null}
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <AppRow
            app={item}
            selected={selectedIds.has(item.id)}
            onPress={handleToggle}
            locked={atFreeLimit && !selectedIds.has(item.id)}
          />
        )}
        ListEmptyComponent={
          loadingApps ? (
            <View style={styles.loader}>
              <LogoLoader size={44} label="Reading your apps" />
            </View>
          ) : appsError ? (
            <EmptyState
              icon="⚠️"
              title="Could not read your apps"
              description={appsError}
            />
          ) : usesSystemAppPicker ? (
            <EmptyState
              title="No apps selected"
              description="Open the Screen Time picker to choose apps and categories to block."
            />
          ) : (
            <EmptyState
              title={query ? 'No matches' : 'No apps found'}
              description={
                query
                  ? 'Try a different search.'
                  : Platform.OS === 'android'
                    ? 'Android did not return a list of launchable apps on this device.'
                    : 'Nothing to show here.'
              }
            />
          )
        }
      />

      <View style={[styles.footer, { borderColor: colors.border }]}>
        {picking ? (
          <PrimaryButton
            testID="confirm-pick"
            label={singleChoice ? 'Use this app' : 'Use these apps'}
            size="large"
            disabled={picked.length === 0}
            onPress={confirmPick}
          />
        ) : (
          <PrimaryButton
            testID="set-timer"
            label={lockRunning ? 'Add to running lock' : 'Set Timer'}
            caption={
              lockRunning && additions.length > 0
                ? `${additions.length} new — your timer stays the same`
                : undefined
            }
            size="large"
            loading={adding}
            disabled={selectedApps.length === 0}
            onPress={() =>
              lockRunning ? void handleAddToLock() : navigation.navigate('LockConfiguration')
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.xl,
  },
  header: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
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
  pickerBlock: {
    gap: spacing.sm,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  limitHint: typography.caption,
  error: typography.caption,
  loader: {
    marginTop: spacing.xl,
  },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
});
