import { create } from 'zustand';

import { ScheduleService, type CreateScheduleInput } from '../services/ScheduleService';
import type { LockSchedule } from '../types';
import { toLockError } from '../utils/errors';
import { getActiveSchedules, getNextTransition } from '../utils/schedule';

interface ScheduleState {
  schedules: LockSchedule[];
  loading: boolean;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  create: (input: CreateScheduleInput) => Promise<LockSchedule>;
  update: (schedule: LockSchedule) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
}

/**
 * The schedule list, for the UI.
 *
 * Note what this store does NOT do: it never decides whether a schedule is
 * running for enforcement purposes. That is native's job, from an alarm, with
 * no JS alive. The pure helpers below are for *display* only — "Active",
 * "Next at 9 AM" — and they read from the same rules the Kotlin engine uses.
 */
export const useScheduleStore = create<ScheduleState>((set, get) => ({
  schedules: [],
  loading: false,
  hydrated: false,

  async hydrate() {
    set({ loading: true });
    try {
      const schedules = await ScheduleService.getSchedules();
      set({ schedules, hydrated: true, loading: false });
    } catch {
      set({ loading: false, hydrated: true });
    }
  },

  async create(input) {
    try {
      const schedule = await ScheduleService.createSchedule(input);
      set({ schedules: [...get().schedules, schedule] });
      return schedule;
    } catch (err) {
      throw toLockError(err);
    }
  },

  async update(schedule) {
    try {
      const updated = await ScheduleService.updateSchedule(schedule);
      set({
        schedules: get().schedules.map((s) => (s.id === updated.id ? updated : s)),
      });
    } catch (err) {
      throw toLockError(err);
    }
  },

  async remove(id) {
    try {
      await ScheduleService.deleteSchedule(id);
      set({ schedules: get().schedules.filter((s) => s.id !== id) });
    } catch (err) {
      throw toLockError(err);
    }
  },

  async setEnabled(id, enabled) {
    try {
      await ScheduleService.setScheduleEnabled(id, enabled);
      set({
        schedules: get().schedules.map((s) => (s.id === id ? { ...s, enabled } : s)),
      });
    } catch (err) {
      throw toLockError(err);
    }
  },
}));

export interface ScheduleSummary {
  /** Schedules running right now, by the display rules. */
  active: LockSchedule[];
  /** The next schedule due to start, and when. */
  nextSchedule: LockSchedule | null;
  nextAt: number | null;
}

/**
 * What Home shows: what is running, and what is next.
 *
 * Pure, and takes `now` explicitly, so the "Next at 9 AM" line can be tested
 * without waiting for 9am.
 */
export function summariseSchedules(
  schedules: LockSchedule[],
  now: Date = new Date()
): ScheduleSummary {
  const active = getActiveSchedules(schedules, now);

  let nextSchedule: LockSchedule | null = null;
  let nextAt: number | null = null;

  for (const schedule of schedules) {
    if (!schedule.enabled) continue;
    // Only upcoming starts, not the ends of running ones — "next lock" means
    // the next time something begins.
    const transition = getNextTransition([schedule], now);
    if (transition == null) continue;
    if (active.some((s) => s.id === schedule.id)) continue;

    if (nextAt == null || transition < nextAt) {
      nextAt = transition;
      nextSchedule = schedule;
    }
  }

  return { active, nextSchedule, nextAt };
}
