import AsyncStorage from '@react-native-async-storage/async-storage';

import { SimulatedLockEngine } from '../src/services/SimulatedLockEngine';
import { useLockStore } from '../src/store/useLockStore';
import type { TargetApp } from '../src/types';

const YOUTUBE: TargetApp = { id: 'com.google.android.youtube', name: 'YouTube' };
const INSTAGRAM: TargetApp = { id: 'com.instagram.android', name: 'Instagram' };
const TIKTOK: TargetApp = { id: 'com.zhiliaoapp.musically', name: 'TikTok' };

const MINUTE = 60 * 1000;

async function reset() {
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

beforeEach(reset);

describe('adding apps to a running lock', () => {
  it('merges new apps into the session', async () => {
    useLockStore.getState().toggleApp(YOUTUBE);
    await useLockStore.getState().startLock(30, false);

    await useLockStore.getState().addAppsToRunningLock([INSTAGRAM]);

    const ids = useLockStore.getState().session?.selectedApps.map((a) => a.id) ?? [];
    expect(ids).toContain(YOUTUBE.id);
    expect(ids).toContain(INSTAGRAM.id);
  });

  it('works during Strict Mode, because adding only tightens the lock', async () => {
    // The bug this covers: a strict lock refused every change, including ones
    // that make it stronger. Strict Mode exists to stop someone weakening a
    // commitment, not committing harder.
    useLockStore.getState().toggleApp(YOUTUBE);
    await useLockStore.getState().startLock(30, true);

    await useLockStore.getState().addAppsToRunningLock([INSTAGRAM]);

    const session = useLockStore.getState().session;
    expect(session?.strictMode).toBe(true);
    expect(session?.selectedApps.map((a) => a.id)).toContain(INSTAGRAM.id);
  });

  it('leaves the deadline untouched', async () => {
    useLockStore.getState().toggleApp(YOUTUBE);
    const started = await useLockStore.getState().startLock(30, true);

    await useLockStore.getState().addAppsToRunningLock([INSTAGRAM]);

    // Adding must not extend or shorten the session the user committed to.
    expect(useLockStore.getState().session?.endTimestamp).toBe(started.endTimestamp);
  });

  it('keeps the session active rather than restarting it', async () => {
    useLockStore.getState().toggleApp(YOUTUBE);
    const started = await useLockStore.getState().startLock(30, false);

    await useLockStore.getState().addAppsToRunningLock([INSTAGRAM]);

    const session = useLockStore.getState().session;
    expect(session?.status).toBe('active');
    expect(session?.id).toBe(started.id);
  });

  it('adds several apps at once', async () => {
    useLockStore.getState().toggleApp(YOUTUBE);
    await useLockStore.getState().startLock(30, false);

    await useLockStore.getState().addAppsToRunningLock([INSTAGRAM, TIKTOK]);

    expect(useLockStore.getState().session?.selectedApps).toHaveLength(3);
  });

  it('is idempotent for an app already locked', async () => {
    useLockStore.getState().toggleApp(YOUTUBE);
    await useLockStore.getState().startLock(30, false);

    await useLockStore.getState().addAppsToRunningLock([YOUTUBE]);

    expect(useLockStore.getState().session?.selectedApps).toHaveLength(1);
  });

  it('refuses when no lock is running', async () => {
    await expect(
      useLockStore.getState().addAppsToRunningLock([YOUTUBE])
    ).rejects.toMatchObject({ code: 'NOT_ACTIVE' });
  });

  it('refuses at the engine level too, not just in the store', async () => {
    await expect(SimulatedLockEngine.addAppsToLock([YOUTUBE.id])).rejects.toMatchObject({
      code: 'NOT_ACTIVE',
    });
  });

  it('refuses once the session has expired', async () => {
    useLockStore.setState({
      session: {
        id: 'session_old',
        selectedApps: [YOUTUBE],
        startTimestamp: Date.now() - 60 * MINUTE,
        endTimestamp: Date.now() - MINUTE,
        strictMode: false,
        status: 'active',
      },
    });

    await expect(
      useLockStore.getState().addAppsToRunningLock([INSTAGRAM])
    ).rejects.toMatchObject({ code: 'NOT_ACTIVE' });
  });
});
