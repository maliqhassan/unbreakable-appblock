import UnbreakableLock from '../../modules/unbreakable-lock';
import type { DailyUsageLimit, DailyUsageStatus } from '../types';
import { LockError } from '../utils/errors';
import { log } from '../utils/logger';
import { nextLocalMidnight, validateLimit } from '../utils/dailyUsage';
import { createId } from '../utils/time';
import { StorageService } from './StorageService';

/**
 * Daily usage limits.
 *
 * Local device configuration, like schedules — never Firebase, never a backend.
 * The foreground service must be able to read these with no network, no
 * signed-in user and no JS runtime, because it is what measures usage.
 *
 * Native is authoritative for both storage and measurement; AsyncStorage is a
 * mirror so the UI can render before the bridge answers, and a fallback for
 * builds with no native module (Expo Go, Jest) where nothing is enforced.
 */

interface NativeLimit {
  id: string;
  packageName: string;
  limitSeconds: number;
  enabled: boolean;
  strictMode: boolean;
}

interface NativeStatusRow extends NativeLimit {
  /** -1 when Android could not be measured. */
  usageSeconds: number;
  resetsAt: number;
  /**
   * Native's authoritative answer, which survives a failed measurement.
   * Without it the UI would show "usage unavailable" beside an app that is
   * genuinely locked.
   */
  lockedNow: boolean;
}

type NativeDailyApi = {
  saveDailyLimits: (json: string) => Promise<unknown>;
  getDailyLimits: () => Promise<string>;
  getDailyUsageStatus: () => Promise<string>;
  refreshDailyLimits: () => Promise<unknown>;
};

function nativeApi(): NativeDailyApi | null {
  if (!UnbreakableLock) return null;
  if (!('saveDailyLimits' in (UnbreakableLock as object))) return null;
  return UnbreakableLock as unknown as NativeDailyApi;
}

function toNative(limit: DailyUsageLimit): NativeLimit {
  return {
    id: limit.id,
    packageName: limit.appPackageName,
    limitSeconds: limit.dailyLimitSeconds,
    enabled: limit.enabled,
    strictMode: limit.strictMode,
  };
}

async function readLocal(): Promise<DailyUsageLimit[]> {
  return StorageService.get<DailyUsageLimit[]>('dailyLimits', []);
}

/**
 * Writes the list locally and hands it to native, which re-evaluates at once.
 *
 * A whole-list replace rather than per-item calls: JS owns the collection, and
 * one atomic write removes any chance of native and the UI disagreeing.
 */
async function sync(limits: DailyUsageLimit[]): Promise<void> {
  await StorageService.set('dailyLimits', limits);

  const api = nativeApi();
  if (!api) {
    log.warn('DailyLimits', 'No native module — limits are stored but not enforced.');
    return;
  }

  try {
    await api.saveDailyLimits(JSON.stringify(limits.map(toNative)));
  } catch (err) {
    log.error('DailyLimits', 'Native sync failed; limits may not be enforced', err);
    throw new LockError(
      'UNKNOWN',
      'The limit was saved but Android could not be told about it. Reopen the app to retry.'
    );
  }
}

export interface CreateDailyLimitInput {
  appPackageName: string;
  dailyLimitSeconds: number;
  strictMode: boolean;
}

export const DailyLimitService = {
  /** True when limits will actually be measured and enforced on this build. */
  isSupported(): boolean {
    return nativeApi() != null;
  },

  async getLimits(): Promise<DailyUsageLimit[]> {
    return readLocal();
  },

  /**
   * Today's usage for every limit.
   *
   * `usageSeconds` is null when Android could not be queried — usually because
   * Usage Access is off. That stays distinct from zero all the way to the UI,
   * because "we could not measure" and "you have used nothing" should never
   * look the same.
   */
  async getStatuses(): Promise<DailyUsageStatus[]> {
    const api = nativeApi();
    const limits = await readLocal();

    if (!api) {
      // No measurement is possible, so report unknown rather than zero.
      const resetsAt = nextLocalMidnight(new Date());
      return limits.map((limit) => ({
        packageName: limit.appPackageName,
        limitSeconds: limit.dailyLimitSeconds,
        usageSeconds: null,
        remainingSeconds: limit.dailyLimitSeconds,
        exhausted: false,
        resetsAt,
      }));
    }

    try {
      const rows = JSON.parse(await api.getDailyUsageStatus()) as NativeStatusRow[];
      return rows.map((row) => {
        const usageSeconds = row.usageSeconds < 0 ? null : row.usageSeconds;
        const remaining =
          usageSeconds == null
            ? row.limitSeconds
            : Math.max(0, row.limitSeconds - usageSeconds);

        return {
          packageName: row.packageName,
          limitSeconds: row.limitSeconds,
          usageSeconds,
          remainingSeconds: remaining,
          // Native decides. A measurement failure must not read as "unlocked",
          // and an unmeasured limit must not read as "exhausted".
          exhausted: row.lockedNow,
          resetsAt: row.resetsAt,
        };
      });
    } catch (err) {
      log.warn('DailyLimits', 'Could not read usage status', err);
      throw new LockError('UNKNOWN', 'Usage data is temporarily unavailable.');
    }
  },

  async createLimit(input: CreateDailyLimitInput): Promise<DailyUsageLimit> {
    const existing = await readLocal();
    const validation = validateLimit(input, existing);
    if (!validation.valid) {
      throw new LockError('INVALID_CONFIGURATION', validation.reason ?? 'Invalid limit.');
    }

    const now = Date.now();
    const limit: DailyUsageLimit = {
      id: createId('limit'),
      appPackageName: input.appPackageName,
      dailyLimitSeconds: input.dailyLimitSeconds,
      enabled: true,
      strictMode: input.strictMode,
      createdAt: now,
      updatedAt: now,
    };

    await sync([...existing, limit]);
    return limit;
  },

  async updateLimit(limit: DailyUsageLimit): Promise<DailyUsageLimit> {
    const existing = await readLocal();
    const validation = validateLimit(limit, existing, limit.id);
    if (!validation.valid) {
      throw new LockError('INVALID_CONFIGURATION', validation.reason ?? 'Invalid limit.');
    }

    const updated: DailyUsageLimit = { ...limit, updatedAt: Date.now() };
    // Native re-evaluates on save, so lowering a limit below today's usage
    // locks immediately rather than at the next app launch.
    await sync(existing.map((l) => (l.id === updated.id ? updated : l)));
    return updated;
  },

  async deleteLimit(id: string): Promise<void> {
    const existing = await readLocal();
    // Native recomputes from what remains, so deleting an exhausted limit
    // releases that app only if no other source still covers it.
    await sync(existing.filter((l) => l.id !== id));
  },

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const existing = await readLocal();
    await sync(
      existing.map((l) => (l.id === id ? { ...l, enabled, updatedAt: Date.now() } : l))
    );
  },

  /** Asks native to re-measure, e.g. on app foreground. */
  async refresh(): Promise<void> {
    const api = nativeApi();
    if (!api) return;
    try {
      await api.refreshDailyLimits();
    } catch (err) {
      log.warn('DailyLimits', 'Native refresh failed', err);
    }
  },
};
