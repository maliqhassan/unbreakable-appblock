import AsyncStorage from '@react-native-async-storage/async-storage';

import type { NativeStatus, UnbreakableLockNativeModule } from '../modules/unbreakable-lock';
import { LockService, __setEngine } from '../src/services/LockService';
import { SimulatedLockEngine } from '../src/services/SimulatedLockEngine';
import { useLockStore } from '../src/store/useLockStore';
import type { LockSession, TargetApp } from '../src/types';

const YOUTUBE: TargetApp = { id: 'com.google.android.youtube', name: 'YouTube' };
const INSTAGRAM: TargetApp = { id: 'com.instagram.android', name: 'Instagram' };
const TIKTOK: TargetApp = { id: 'com.zhiliaoapp.musically', name: 'TikTok' };

const MINUTE = 60 * 1000;

/**
 * A stub standing in for the Android module, so the JS side of enforcement can
 * be tested without a device: what happens when native reports a degraded
 * session, a dead service, or a target list that differs from what was asked.
 */
function fakeNative(status: Partial<NativeStatus>): UnbreakableLockNativeModule {
  const full: NativeStatus = {
    active: true,
    sessionId: 'session_native',
    startTimestamp: Date.now() - MINUTE,
    endTimestamp: Date.now() + 30 * MINUTE,
    strictMode: false,
    blockedIds: [YOUTUBE.id],
    serviceRunning: true,
    degradedReason: null,
    sources: ['manual'],
    scheduleNames: [],
    dailyLimitPackages: [],
    resetsAt: 0,
    ...status,
  };

  return {
    ...SimulatedLockEngine,
    async getLockStatus() {
      return full;
    },
    async startLock() {
      return full;
    },
  };
}

async function resetStore() {
  await AsyncStorage.clear();
  useLockStore.setState({
    selectedApps: [],
    availableApps: [],
    loadingApps: false,
    appsError: null,
    session: null,
    hydrated: false,
  });
}

afterEach(() => __setEngine(null));

describe('native is the enforcement authority', () => {
  beforeEach(resetStore);

  it('carries one session id from JS into native', async () => {
    useLockStore.getState().toggleApp(YOUTUBE);
    const session = await useLockStore.getState().startLock(30, false);

    const status = await LockService.getStatus();
    expect(status.sessionId).toBe(session.id);
  });

  it('adopts the native target list when native drops a protected package', async () => {
    // Native refuses to block the launcher, so it comes back with fewer ids
    // than were requested. The UI must show what is really locked.
    __setEngine(fakeNative({ blockedIds: [YOUTUBE.id] }));

    useLockStore.getState().setSelectedApps([YOUTUBE, { id: 'com.android.launcher', name: 'Launcher' }]);
    const session = await useLockStore.getState().startLock(30, false);

    expect(session.selectedApps).toEqual([YOUTUBE]);
  });

  it('restores a session from native after the JS process died', async () => {
    const nativeEnd = Date.now() + 12 * MINUTE;
    __setEngine(
      fakeNative({ sessionId: 'session_native', endTimestamp: nativeEnd, strictMode: true })
    );

    // Nothing in JS storage: this is a cold start after a process kill.
    await useLockStore.getState().hydrate();

    const session = useLockStore.getState().session;
    expect(session?.status).toBe('active');
    expect(session?.id).toBe('session_native');
    expect(session?.endTimestamp).toBe(nativeEnd);
    expect(session?.strictMode).toBe(true);
  });

  it('prefers the native end timestamp over a stale stored one', async () => {
    const stale: LockSession = {
      id: 'session_native',
      selectedApps: [YOUTUBE],
      startTimestamp: Date.now() - 60 * MINUTE,
      endTimestamp: Date.now() + 99 * MINUTE, // JS thinks there is far more time
      strictMode: false,
      status: 'active',
    };
    await AsyncStorage.setItem('ul.session', JSON.stringify(stale));

    const nativeEnd = Date.now() + 5 * MINUTE;
    __setEngine(fakeNative({ sessionId: 'session_native', endTimestamp: nativeEnd }));

    await useLockStore.getState().hydrate();

    expect(useLockStore.getState().session?.endTimestamp).toBe(nativeEnd);
  });

  it('keeps stored display detail when the native session id matches', async () => {
    const stored: LockSession = {
      id: 'session_native',
      selectedApps: [{ ...YOUTUBE, iconBase64: 'abc' }],
      startTimestamp: Date.now() - MINUTE,
      endTimestamp: Date.now() + 20 * MINUTE,
      strictMode: false,
      status: 'active',
    };
    await AsyncStorage.setItem('ul.session', JSON.stringify(stored));
    __setEngine(fakeNative({ sessionId: 'session_native', blockedIds: [YOUTUBE.id] }));

    await useLockStore.getState().hydrate();

    // The icon survives; it is presentation, not authority.
    expect(useLockStore.getState().session?.selectedApps[0].iconBase64).toBe('abc');
  });

  it('does not reuse stored detail from a different session', async () => {
    const oldSession: LockSession = {
      id: 'session_previous',
      selectedApps: [{ ...INSTAGRAM, iconBase64: 'stale' }],
      startTimestamp: Date.now() - 90 * MINUTE,
      endTimestamp: Date.now() + 20 * MINUTE,
      strictMode: false,
      status: 'active',
    };
    await AsyncStorage.setItem('ul.session', JSON.stringify(oldSession));
    __setEngine(fakeNative({ sessionId: 'session_native', blockedIds: [YOUTUBE.id] }));

    await useLockStore.getState().hydrate();

    const apps = useLockStore.getState().session?.selectedApps ?? [];
    expect(apps).toEqual([{ id: YOUTUBE.id, name: YOUTUBE.id }]);
  });

  it('locks several apps at once', async () => {
    const ids = [YOUTUBE.id, INSTAGRAM.id, TIKTOK.id];
    __setEngine(fakeNative({ blockedIds: ids }));

    useLockStore.getState().setSelectedApps([YOUTUBE, INSTAGRAM, TIKTOK]);
    const session = await useLockStore.getState().startLock(30, false);

    expect(session.selectedApps.map((a) => a.id)).toEqual(ids);
  });
});

describe('degraded enforcement is surfaced, never hidden', () => {
  beforeEach(resetStore);

  it('records the reason when native says it can no longer block', async () => {
    __setEngine(fakeNative({}));
    useLockStore.getState().toggleApp(YOUTUBE);
    await useLockStore.getState().startLock(30, false);

    // The user revokes usage access from Settings mid-session.
    __setEngine(
      fakeNative({ degradedReason: 'Usage access was turned off, so nothing is blocked.' })
    );
    await useLockStore.getState().refreshFromNative();

    const session = useLockStore.getState().session;
    expect(session?.status).toBe('active');
    expect(session?.degradedReason).toMatch(/Usage access/);
  });

  it('clears the reason once enforcement recovers', async () => {
    __setEngine(fakeNative({ degradedReason: 'Overlay permission was turned off.' }));
    useLockStore.getState().toggleApp(YOUTUBE);
    await useLockStore.getState().startLock(30, false);
    await useLockStore.getState().refreshFromNative();
    expect(useLockStore.getState().session?.degradedReason).toBeTruthy();

    __setEngine(fakeNative({ degradedReason: null }));
    await useLockStore.getState().refreshFromNative();

    expect(useLockStore.getState().session?.degradedReason).toBeUndefined();
  });

  it('surfaces degradation restored from native on a cold start', async () => {
    __setEngine(fakeNative({ degradedReason: 'The lock service is not running.' }));

    await useLockStore.getState().hydrate();

    expect(useLockStore.getState().session?.degradedReason).toMatch(/not running/);
  });

  it('fails the session when native stops enforcing before the timer ends', async () => {
    __setEngine(fakeNative({}));
    useLockStore.getState().toggleApp(YOUTUBE);
    await useLockStore.getState().startLock(30, false);

    // Native reports nothing running, but there is time left on the clock.
    __setEngine(fakeNative({ active: false, serviceRunning: false }));
    await useLockStore.getState().refreshFromNative();

    const session = useLockStore.getState().session;
    expect(session?.status).toBe('failed');
    expect(session?.failureReason).toMatch(/stopped before the timer/);
  });

  it('completes rather than fails when native stops after the timer ended', async () => {
    useLockStore.setState({
      session: {
        id: 'session_done',
        selectedApps: [YOUTUBE],
        startTimestamp: Date.now() - 40 * MINUTE,
        endTimestamp: Date.now() - MINUTE,
        strictMode: false,
        status: 'active',
      },
    });
    __setEngine(fakeNative({ active: false, serviceRunning: false }));

    await useLockStore.getState().refreshFromNative();

    expect(useLockStore.getState().session?.status).toBe('completed');
  });
});

describe('capability reporting', () => {
  it('never claims uninstall or settings protection on any engine', () => {
    const capabilities = LockService.getCapabilities();
    expect(capabilities.canPreventUninstall).toBe(false);
    expect(capabilities.canRestrictSettings).toBe(false);
  });

  it('reports the simulated engine as surviving nothing', () => {
    const capabilities = SimulatedLockEngine.getEnforcementCapabilities();
    expect(capabilities.canSurviveJsDeath).toBe(false);
    expect(capabilities.canSurviveReboot).toBe(false);
    expect(capabilities.canShieldApps).toBe(false);
  });

  it('exposes permission status without throwing when native is absent', () => {
    const status = LockService.getPermissionStatus();
    expect(status).toHaveProperty('usageAccess');
    // Deliberately always false: no AccessibilityService ships in this app.
    expect(status.accessibility).toBe(false);
  });
});
