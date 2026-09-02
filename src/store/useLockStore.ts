import { create } from 'zustand';

import { LockService } from '../services/LockService';
import { StorageService } from '../services/StorageService';
import type { EnforcementCapabilities, LockSession, TargetApp } from '../types';
import { LockError, toLockError } from '../utils/errors';
import { log } from '../utils/logger';
import { createId, minutesToMs } from '../utils/time';

interface LockState {
  /** What the user has ticked, not yet locked. */
  selectedApps: TargetApp[];
  /** The device's app list (Android) or the system selection (iOS). */
  availableApps: TargetApp[];
  loadingApps: boolean;
  appsError: string | null;

  session: LockSession | null;
  capabilities: EnforcementCapabilities;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  loadAvailableApps: () => Promise<void>;
  toggleApp: (app: TargetApp) => void;
  setSelectedApps: (apps: TargetApp[]) => void;
  clearSelection: () => void;
  isSelected: (id: string) => boolean;

  startLock: (durationMinutes: number, strictMode: boolean) => Promise<LockSession>;
  stopLock: () => Promise<void>;
  /**
   * Adds apps to the lock that is already running, leaving its timer alone.
   * Permitted under Strict Mode — it only tightens the session.
   */
  addAppsToRunningLock: (apps: TargetApp[]) => Promise<void>;
  /** Ends the session when its end timestamp has passed. Safe to call often. */
  syncExpiry: () => Promise<boolean>;
  /**
   * Re-reads native status into the active session — picks up a permission
   * revoked mid-lock, or a service that died. Safe to call often.
   */
  refreshFromNative: () => Promise<void>;
  acknowledgeCompletion: () => void;
}

const NO_CAPABILITIES: EnforcementCapabilities = {
  canShieldApps: false,
  canMonitorUsage: false,
  canSurviveJsDeath: false,
  canSurviveReboot: false,
  canPreventUninstall: false,
  canRestrictSettings: false,
  canBlockEarlyExit: false,
};

/**
 * Aligns the JS view of a session with what native actually locked.
 *
 * Native silently drops protected packages (the launcher, Settings, this app),
 * so the returned id list can be shorter than what the user ticked. We keep the
 * rich TargetApp objects we already have and fall back to a bare id for
 * anything native knows about that we do not.
 */
function reconcileTargets(selected: TargetApp[], blockedIds: string[]): TargetApp[] {
  if (blockedIds.length === 0) return selected;
  const bySelectedId = new Map(selected.map((app) => [app.id, app]));
  return blockedIds.map((id) => bySelectedId.get(id) ?? { id, name: id });
}

export const useLockStore = create<LockState>((set, get) => ({
  selectedApps: [],
  availableApps: [],
  loadingApps: false,
  appsError: null,
  session: null,
  capabilities: NO_CAPABILITIES,
  hydrated: false,

  /**
   * Restores state on launch.
   *
   * Native is the authority: whatever the OS says is running wins over what JS
   * last wrote down. That is what makes a lock survive the app being killed.
   */
  async hydrate() {
    const capabilities = LockService.getCapabilities();
    const [storedSession, storedSelection, nativeStatus] = await Promise.all([
      StorageService.get<LockSession | null>('session', null),
      StorageService.get<TargetApp[]>('selectedApps', []),
      LockService.getStatus(),
    ]);

    let session = storedSession;

    if (nativeStatus.active) {
      // Native says a lock is running. Everything authoritative comes from it:
      // its timestamps, its target list, and whether enforcement is degraded.
      // The stored session only supplies display detail (icons, app names).
      const sameSession =
        nativeStatus.sessionId !== '' && nativeStatus.sessionId === storedSession?.id;

      session = {
        id: nativeStatus.sessionId || storedSession?.id || createId('session'),
        selectedApps: reconcileTargets(
          sameSession ? (storedSession?.selectedApps ?? []) : [],
          nativeStatus.blockedIds
        ),
        startTimestamp:
          nativeStatus.startTimestamp > 0
            ? nativeStatus.startTimestamp
            : (storedSession?.startTimestamp ?? Date.now()),
        endTimestamp: nativeStatus.endTimestamp,
        strictMode: nativeStatus.strictMode,
        status: 'active',
        degradedReason: nativeStatus.degradedReason ?? undefined,
        // A lock the user did not start by hand is labelled as such rather than
        // implying they chose this moment.
        // A daily limit is the most specific explanation, so it wins the label.
        source: nativeStatus.sources.includes('daily_usage')
          ? 'daily_usage'
          : nativeStatus.sources.includes('schedule')
            ? 'schedule'
            : 'manual',
        scheduleName: nativeStatus.scheduleNames[0],
        resetsAt: nativeStatus.resetsAt,
      };
    } else if (session?.status === 'active') {
      // JS thought a lock was running but the OS disagrees. The end timestamp
      // decides: expired means completed, otherwise enforcement was lost.
      if (session.endTimestamp <= Date.now()) {
        session = { ...session, status: 'completed' };
      } else {
        log.warn('LockStore', 'Native reports no lock, but a session was still open.');
        session = {
          ...session,
          status: 'failed',
          failureReason: 'Enforcement stopped unexpectedly.',
        };
      }
    }

    set({
      capabilities,
      session,
      selectedApps: storedSelection,
      hydrated: true,
    });

    if (session !== storedSession) await StorageService.set('session', session);
  },

  async loadAvailableApps() {
    set({ loadingApps: true, appsError: null });
    try {
      const apps = await LockService.getInstalledApps();
      set({ availableApps: apps, loadingApps: false });
    } catch (err) {
      const error = toLockError(err);
      if (error.code === 'UNSUPPORTED_PLATFORM') {
        // iOS: apps are chosen in Apple's picker, so an in-app list is not a
        // failure — there simply isn't one to show.
        const selection = await LockService.getSystemSelection();
        set({ availableApps: [], selectedApps: selection, loadingApps: false });
        return;
      }
      set({ loadingApps: false, appsError: error.message });
    }
  },

  toggleApp(app) {
    const { selectedApps } = get();
    const exists = selectedApps.some((a) => a.id === app.id);
    const next = exists
      ? selectedApps.filter((a) => a.id !== app.id)
      : [...selectedApps, app];
    set({ selectedApps: next });
    void StorageService.set('selectedApps', next);
  },

  setSelectedApps(apps) {
    set({ selectedApps: apps });
    void StorageService.set('selectedApps', apps);
  },

  clearSelection() {
    set({ selectedApps: [] });
    void StorageService.set('selectedApps', []);
  },

  isSelected(id) {
    return get().selectedApps.some((a) => a.id === id);
  },

  async startLock(durationMinutes, strictMode) {
    const { selectedApps } = get();
    const startTimestamp = Date.now();
    const endTimestamp = startTimestamp + minutesToMs(durationMinutes);
    // One id, generated here and handed to native, so the JS session and the
    // persisted native session are the same session and can be reconciled.
    const sessionId = createId('session');

    const pending: LockSession = {
      id: sessionId,
      selectedApps,
      startTimestamp,
      endTimestamp,
      strictMode,
      status: 'preparing',
    };
    set({ session: pending });

    try {
      const status = await LockService.startLock(
        selectedApps,
        endTimestamp,
        strictMode,
        sessionId
      );
      const active: LockSession = {
        ...pending,
        // Native is authoritative: it may drop protected packages from the
        // selection, so reflect what it actually locked.
        selectedApps: reconcileTargets(selectedApps, status.blockedIds),
        endTimestamp: status.endTimestamp > 0 ? status.endTimestamp : endTimestamp,
        status: 'active',
      };
      set({ session: active });
      await StorageService.set('session', active);
      return active;
    } catch (err) {
      const error = toLockError(err);

      // ALREADY_ACTIVE is not a failure: a lock genuinely is running, and the
      // right answer is to show it. Marking the session failed here is what
      // produced "The lock stopped — a lock is already running", which is both
      // wrong and alarming.
      if (error.code === 'ALREADY_ACTIVE') {
        await get().hydrate();
        throw error;
      }

      const failed: LockSession = {
        ...pending,
        status: 'failed',
        failureReason: error.message,
      };
      set({ session: failed });
      await StorageService.set('session', failed);
      throw error;
    }
  },

  async addAppsToRunningLock(apps) {
    const { session } = get();
    if (!session || session.status !== 'active') {
      throw new LockError('NOT_ACTIVE', 'No lock is currently running.');
    }

    const status = await LockService.addAppsToRunningLock(apps);

    const merged = reconcileTargets(
      [...session.selectedApps, ...apps],
      status.blockedIds
    );
    const next: LockSession = { ...session, selectedApps: merged };

    set({ session: next });
    await StorageService.set('session', next);
  },

  /**
   * Ends the lock at the user's request.
   *
   * Throws STRICT_MODE_ACTIVE when Strict Mode forbids it — the guard lives in
   * native, not here, so hiding the UI is not the only thing stopping it.
   */
  async stopLock() {
    const { session } = get();
    if (!session) return;

    await LockService.stopLock(false);

    const completed: LockSession = { ...session, status: 'completed' };
    set({ session: completed });
    await StorageService.set('session', completed);
  },

  /** @returns true when this call ended an expired session. */
  async syncExpiry() {
    const { session } = get();
    if (!session || session.status !== 'active') return false;
    if (session.endTimestamp > Date.now()) return false;

    try {
      // force: this is the timer expiring, not the user backing out, so the
      // Strict Mode guard does not apply.
      await LockService.stopLock(true);
    } catch (err) {
      log.warn('LockStore', 'Native cleanup after expiry failed', err);
    }

    const completed: LockSession = { ...session, status: 'completed' };
    set({ session: completed });
    await StorageService.set('session', completed);
    return true;
  },

  async refreshFromNative() {
    const { session } = get();
    if (!session || session.status !== 'active') return;

    const status = await LockService.getStatus();

    if (!status.active) {
      // Native dropped the lock. Expiry is the benign explanation; anything
      // else means enforcement was lost and the user needs to know.
      const expired = session.endTimestamp <= Date.now();
      const next: LockSession = expired
        ? { ...session, status: 'completed' }
        : {
            ...session,
            status: 'failed',
            failureReason: 'Enforcement stopped before the timer ended.',
          };
      set({ session: next });
      await StorageService.set('session', next);
      return;
    }

    // A session that native says is active but with no service running is not
    // enforcing anything. Say so rather than showing a confident countdown.
    const degradedReason =
      status.degradedReason ??
      (status.serviceRunning
        ? undefined
        : 'The lock service is not running, so apps are not being blocked.');
    const source: LockSession['source'] = status.sources.includes('daily_usage')
      ? 'daily_usage'
      : status.sources.includes('schedule')
        ? 'schedule'
        : 'manual';
    const scheduleName = status.scheduleNames[0];

    if (
      degradedReason === session.degradedReason &&
      source === session.source &&
      scheduleName === session.scheduleName
    ) {
      return;
    }

    const next: LockSession = { ...session, degradedReason, source, scheduleName };
    set({ session: next });
    await StorageService.set('session', next);
  },

  acknowledgeCompletion() {
    set({ session: null });
    void StorageService.set('session', null);
  },
}));

export { LockError };
