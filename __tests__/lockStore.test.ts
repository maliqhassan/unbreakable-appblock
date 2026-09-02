import AsyncStorage from '@react-native-async-storage/async-storage';

import { useLockStore } from '../src/store/useLockStore';
import type { LockSession, TargetApp } from '../src/types';

const YOUTUBE: TargetApp = { id: 'com.google.android.youtube', name: 'YouTube' };
const INSTAGRAM: TargetApp = { id: 'com.instagram.android', name: 'Instagram' };

const MINUTE = 60 * 1000;

/** A fresh store, as if the app had just been installed. */
async function resetEverything() {
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

describe('lock store', () => {
  beforeEach(resetEverything);

  describe('selection', () => {
    it('selects a single app and persists it', async () => {
      useLockStore.getState().toggleApp(YOUTUBE);

      expect(useLockStore.getState().selectedApps).toEqual([YOUTUBE]);
      expect(useLockStore.getState().isSelected(YOUTUBE.id)).toBe(true);

      // Flush the fire-and-forget write before reading it back.
      await Promise.resolve();
      const stored = await AsyncStorage.getItem('ul.selectedApps');
      expect(JSON.parse(stored ?? '[]')).toEqual([YOUTUBE]);
    });

    it('deselects on a second toggle', () => {
      const { toggleApp } = useLockStore.getState();
      toggleApp(YOUTUBE);
      toggleApp(YOUTUBE);

      expect(useLockStore.getState().selectedApps).toEqual([]);
    });

    it('holds multiple apps — tier limits are enforced at validation, not here', () => {
      const { toggleApp } = useLockStore.getState();
      toggleApp(YOUTUBE);
      toggleApp(INSTAGRAM);

      expect(useLockStore.getState().selectedApps).toHaveLength(2);
    });
  });

  describe('starting a lock', () => {
    it('creates an active session with an absolute end timestamp', async () => {
      useLockStore.getState().toggleApp(YOUTUBE);

      const before = Date.now();
      const session = await useLockStore.getState().startLock(30, false);

      expect(session.status).toBe('active');
      expect(session.selectedApps).toEqual([YOUTUBE]);
      expect(session.endTimestamp).toBeGreaterThanOrEqual(before + 30 * MINUTE);
      expect(session.endTimestamp).toBeLessThan(before + 31 * MINUTE);
    });

    it('refuses a second lock, but keeps the running one intact', async () => {
      useLockStore.getState().toggleApp(YOUTUBE);
      const first = await useLockStore.getState().startLock(30, false);

      await expect(useLockStore.getState().startLock(30, false)).rejects.toMatchObject({
        code: 'ALREADY_ACTIVE',
      });

      // ALREADY_ACTIVE is not a failure — a lock genuinely is running. Marking
      // the session 'failed' here used to surface as "The lock stopped: a lock
      // is already running", which was both wrong and alarming.
      const session = useLockStore.getState().session;
      expect(session?.status).toBe('active');
      expect(session?.endTimestamp).toBe(first.endTimestamp);
    });
  });

  describe('ending a lock', () => {
    it('ends a standard lock on request', async () => {
      useLockStore.getState().toggleApp(YOUTUBE);
      await useLockStore.getState().startLock(30, false);

      await useLockStore.getState().stopLock();

      expect(useLockStore.getState().session?.status).toBe('completed');
    });

    it('refuses to end a strict lock early', async () => {
      useLockStore.getState().toggleApp(YOUTUBE);
      await useLockStore.getState().startLock(30, true);

      await expect(useLockStore.getState().stopLock()).rejects.toMatchObject({
        code: 'STRICT_MODE_ACTIVE',
      });
      expect(useLockStore.getState().session?.status).toBe('active');
    });
  });

  describe('expiry', () => {
    it('completes a session whose end timestamp has passed', async () => {
      const expired: LockSession = {
        id: 'session_expired',
        selectedApps: [YOUTUBE],
        startTimestamp: Date.now() - 60 * MINUTE,
        endTimestamp: Date.now() - MINUTE,
        strictMode: true,
        status: 'active',
      };
      useLockStore.setState({ session: expired });

      const changed = await useLockStore.getState().syncExpiry();

      expect(changed).toBe(true);
      // Strict Mode does not block the timer running out — only an early exit.
      expect(useLockStore.getState().session?.status).toBe('completed');
    });

    it('leaves a session that still has time on the clock', async () => {
      useLockStore.getState().toggleApp(YOUTUBE);
      await useLockStore.getState().startLock(30, false);

      expect(await useLockStore.getState().syncExpiry()).toBe(false);
      expect(useLockStore.getState().session?.status).toBe('active');
    });
  });

  describe('restoring after an app restart', () => {
    it('brings back a running session and keeps its original end timestamp', async () => {
      useLockStore.getState().toggleApp(YOUTUBE);
      const original = await useLockStore.getState().startLock(45, true);

      // Simulate a cold start: the store is empty, storage and the engine are not.
      useLockStore.setState({ session: null, selectedApps: [], hydrated: false });
      await useLockStore.getState().hydrate();

      const restored = useLockStore.getState().session;
      expect(restored?.status).toBe('active');
      expect(restored?.endTimestamp).toBe(original.endTimestamp);
      expect(restored?.strictMode).toBe(true);
      expect(useLockStore.getState().selectedApps).toEqual([YOUTUBE]);
    });

    it('completes a session that expired while the app was closed', async () => {
      const expired: LockSession = {
        id: 'session_stale',
        selectedApps: [YOUTUBE],
        startTimestamp: Date.now() - 2 * 60 * MINUTE,
        endTimestamp: Date.now() - 30 * MINUTE,
        strictMode: false,
        status: 'active',
      };
      await AsyncStorage.setItem('ul.session', JSON.stringify(expired));

      await useLockStore.getState().hydrate();

      expect(useLockStore.getState().session?.status).toBe('completed');
    });

    it('starts clean when nothing was persisted', async () => {
      await useLockStore.getState().hydrate();

      expect(useLockStore.getState().session).toBeNull();
      expect(useLockStore.getState().hydrated).toBe(true);
    });
  });
});
