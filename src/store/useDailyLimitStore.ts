import { create } from 'zustand';

import {
  DailyLimitService,
  type CreateDailyLimitInput,
} from '../services/DailyLimitService';
import type { DailyUsageLimit, DailyUsageStatus } from '../types';
import { toLockError } from '../utils/errors';

interface DailyLimitState {
  limits: DailyUsageLimit[];
  statuses: DailyUsageStatus[];
  loading: boolean;
  hydrated: boolean;
  /** Set when usage could not be read at all — never rendered as zero. */
  usageError: string | null;

  hydrate: () => Promise<void>;
  refreshUsage: () => Promise<void>;
  create: (input: CreateDailyLimitInput) => Promise<DailyUsageLimit>;
  update: (limit: DailyUsageLimit) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
}

/**
 * The limit list and today's usage, for the UI.
 *
 * This store never decides whether an app should be locked. That is the native
 * engine's job, running from a foreground service with no JS alive. Everything
 * here is display, and it is recomputed from Android's own record rather than
 * counted down in JavaScript.
 */
export const useDailyLimitStore = create<DailyLimitState>((set, get) => ({
  limits: [],
  statuses: [],
  loading: false,
  hydrated: false,
  usageError: null,

  async hydrate() {
    set({ loading: true });
    try {
      const limits = await DailyLimitService.getLimits();
      set({ limits, hydrated: true, loading: false });
      await get().refreshUsage();
    } catch {
      set({ loading: false, hydrated: true });
    }
  },

  async refreshUsage() {
    try {
      const statuses = await DailyLimitService.getStatuses();
      set({ statuses, usageError: null });
    } catch (err) {
      // Report the failure rather than leaving stale numbers on screen that
      // look like fresh ones.
      set({ usageError: toLockError(err).message });
    }
  },

  async create(input) {
    try {
      const limit = await DailyLimitService.createLimit(input);
      set({ limits: [...get().limits, limit] });
      await get().refreshUsage();
      return limit;
    } catch (err) {
      throw toLockError(err);
    }
  },

  async update(limit) {
    try {
      const updated = await DailyLimitService.updateLimit(limit);
      set({ limits: get().limits.map((l) => (l.id === updated.id ? updated : l)) });
      // A lowered limit can exhaust immediately, so re-read at once.
      await get().refreshUsage();
    } catch (err) {
      throw toLockError(err);
    }
  },

  async remove(id) {
    try {
      await DailyLimitService.deleteLimit(id);
      set({
        limits: get().limits.filter((l) => l.id !== id),
        statuses: get().statuses.filter(
          (s) => s.packageName !== get().limits.find((l) => l.id === id)?.appPackageName
        ),
      });
      await get().refreshUsage();
    } catch (err) {
      throw toLockError(err);
    }
  },

  async setEnabled(id, enabled) {
    try {
      await DailyLimitService.setEnabled(id, enabled);
      set({ limits: get().limits.map((l) => (l.id === id ? { ...l, enabled } : l)) });
      await get().refreshUsage();
    } catch (err) {
      throw toLockError(err);
    }
  },
}));

/** Pairs each limit with today's status, for rendering. */
export function pairLimits(
  limits: DailyUsageLimit[],
  statuses: DailyUsageStatus[]
): { limit: DailyUsageLimit; status: DailyUsageStatus | null }[] {
  return limits.map((limit) => ({
    limit,
    status: statuses.find((s) => s.packageName === limit.appPackageName) ?? null,
  }));
}
