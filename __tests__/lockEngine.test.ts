import AsyncStorage from '@react-native-async-storage/async-storage';

import { SimulatedLockEngine } from '../src/services/SimulatedLockEngine';

const MINUTE = 60 * 1000;

/**
 * The state transitions every engine must implement identically.
 *
 * These run against the simulated engine because Jest has no device, but the
 * assertions are the contract the Kotlin and Swift modules implement too —
 * same error codes, same guards, same expiry semantics.
 */
describe('lock engine state transitions', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('reports no lock before anything starts', async () => {
    const status = await SimulatedLockEngine.getLockStatus();
    expect(status.active).toBe(false);
  });

  it('goes idle -> active on start', async () => {
    const end = Date.now() + 30 * MINUTE;
    const status = await SimulatedLockEngine.startLock(['com.instagram.android'], end, false, 'session_test');

    expect(status).toMatchObject({ active: true, endTimestamp: end, strictMode: false });
    expect(status.blockedIds).toEqual(['com.instagram.android']);
  });

  it('rejects an empty selection', async () => {
    await expect(
      SimulatedLockEngine.startLock([], Date.now() + MINUTE, false, 'session_test')
    ).rejects.toMatchObject({ code: 'NO_SELECTION' });
  });

  it('rejects an end timestamp in the past', async () => {
    await expect(
      SimulatedLockEngine.startLock(['com.whatsapp'], Date.now() - MINUTE, false, 'session_test')
    ).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
  });

  it('rejects a second start while active', async () => {
    await SimulatedLockEngine.startLock(['com.whatsapp'], Date.now() + 30 * MINUTE, false, 'session_test');

    await expect(
      SimulatedLockEngine.startLock(['com.reddit.frontpage'], Date.now() + 30 * MINUTE, false, 'session_test')
    ).rejects.toMatchObject({ code: 'ALREADY_ACTIVE' });
  });

  it('goes active -> idle on a normal stop', async () => {
    await SimulatedLockEngine.startLock(['com.whatsapp'], Date.now() + 30 * MINUTE, false, 'session_test');
    const status = await SimulatedLockEngine.stopLock(false);

    expect(status.active).toBe(false);
  });

  it('rejects stopping when nothing is running', async () => {
    await expect(SimulatedLockEngine.stopLock(false)).rejects.toMatchObject({
      code: 'NOT_ACTIVE',
    });
  });

  describe('strict mode', () => {
    it('refuses an early stop', async () => {
      await SimulatedLockEngine.startLock(['com.whatsapp'], Date.now() + 30 * MINUTE, true, 'session_test');

      await expect(SimulatedLockEngine.stopLock(false)).rejects.toMatchObject({
        code: 'STRICT_MODE_ACTIVE',
      });
      expect((await SimulatedLockEngine.getLockStatus()).active).toBe(true);
    });

    it('allows a forced stop, which is how expiry cleans up', async () => {
      await SimulatedLockEngine.startLock(['com.whatsapp'], Date.now() + 30 * MINUTE, true, 'session_test');

      const status = await SimulatedLockEngine.stopLock(true);
      expect(status.active).toBe(false);
    });
  });

  it('reports an expired lock as inactive without needing a stop call', async () => {
    // Write a lock that already ran out, the way a persisted one would look
    // after the app was closed for an hour.
    await AsyncStorage.setItem(
      'ul.simulated.lock',
      JSON.stringify({
        active: true,
        endTimestamp: Date.now() - MINUTE,
        strictMode: true,
        blockedIds: ['com.whatsapp'],
        sessionId: 'session_old',
        startTimestamp: Date.now() - 60 * MINUTE,
      })
    );

    expect((await SimulatedLockEngine.getLockStatus()).active).toBe(false);

    // ...and starting a new lock is allowed again.
    const next = await SimulatedLockEngine.startLock(['com.reddit.frontpage'], Date.now() + MINUTE, false, 'session_test');
    expect(next.active).toBe(true);
  });

  it('never claims to shield apps', () => {
    // The simulated engine blocks nothing, and must say so — the UI keys its
    // warning banner off exactly this.
    expect(SimulatedLockEngine.getCapabilities().canShieldApps).toBe(false);
    expect(SimulatedLockEngine.getCapabilities().canPreventUninstall).toBe(false);
  });
});
