import UnbreakableLock from '../../modules/unbreakable-lock';
import type { LockSchedule, Weekday } from '../types';
import { LockError } from '../utils/errors';
import { log } from '../utils/logger';
import { WEEKDAYS, parseTime, validateSchedule } from '../utils/schedule';
import { createId } from '../utils/time';
import { StorageService } from './StorageService';

/**
 * Schedule CRUD.
 *
 * Schedules are **local device configuration**. They live in native storage so
 * an alarm receiver at 3am can read them with no network, no signed-in user and
 * no JS runtime alive. Nothing here touches Firebase or any backend, and a
 * guest can use schedules exactly like a signed-in user.
 *
 * The native module is authoritative when present; AsyncStorage is the fallback
 * for builds without it (Expo Go, Jest) so the UI is still exercisable — but in
 * that mode nothing actually fires, and the UI says so.
 */

/** java.util.Calendar day numbers: SUNDAY = 1 .. SATURDAY = 7. */
function weekdayToCalendar(day: Weekday): number {
  return WEEKDAYS.indexOf(day) + 1;
}

function calendarToWeekday(value: number): Weekday | null {
  return WEEKDAYS[value - 1] ?? null;
}

/** The wire shape the Kotlin side parses. Minutes, not "HH:mm". */
interface NativeSchedule {
  id: string;
  name: string;
  enabled: boolean;
  packages: string[];
  days: number[];
  startMinutes: number;
  endMinutes: number;
  strictMode: boolean;
}

function toNative(schedule: LockSchedule): NativeSchedule | null {
  const start = parseTime(schedule.startTime);
  const end = parseTime(schedule.endTime);
  if (start == null || end == null) return null;

  return {
    id: schedule.id,
    name: schedule.name,
    enabled: schedule.enabled,
    packages: schedule.appPackageNames,
    days: schedule.daysOfWeek.map(weekdayToCalendar),
    startMinutes: start,
    endMinutes: end,
    strictMode: schedule.strictMode,
  };
}

function isNativeAvailable(): boolean {
  return UnbreakableLock != null && 'saveSchedules' in (UnbreakableLock as object);
}

async function readLocal(): Promise<LockSchedule[]> {
  return StorageService.get<LockSchedule[]>('schedules', []);
}

async function writeLocal(schedules: LockSchedule[]): Promise<void> {
  await StorageService.set('schedules', schedules);
}

/**
 * Pushes the whole list to native, then lets it re-evaluate immediately.
 *
 * A full replace rather than per-item calls: JS owns the collection, and one
 * atomic write removes any chance of native and the UI disagreeing after an
 * edit. Re-evaluating on the same call is what makes editing an *active*
 * schedule take effect now instead of at the next alarm.
 */
async function sync(schedules: LockSchedule[]): Promise<void> {
  await writeLocal(schedules);

  if (!isNativeAvailable()) {
    log.warn('Schedules', 'No native module — schedules are stored but will not fire.');
    return;
  }

  try {
    const payload = schedules
      .map(toNative)
      .filter((entry): entry is NativeSchedule => entry != null);

    await (
      UnbreakableLock as unknown as {
        saveSchedules: (json: string) => Promise<unknown>;
      }
    ).saveSchedules(JSON.stringify(payload));
  } catch (err) {
    log.error('Schedules', 'Native sync failed; schedules may not fire', err);
    throw new LockError(
      'UNKNOWN',
      'The schedule was saved but could not be handed to Android. Reopen the app to retry.'
    );
  }
}

export interface CreateScheduleInput {
  name: string;
  appPackageNames: string[];
  daysOfWeek: Weekday[];
  startTime: string;
  endTime: string;
  strictMode: boolean;
}

export const ScheduleService = {
  /** True when schedules will actually fire on this build. */
  isSupported(): boolean {
    return isNativeAvailable();
  },

  /**
   * True when Android will let us set exact alarms.
   *
   * False means Doze can delay a transition by minutes. The UI states that
   * rather than promising accuracy the OS will not give.
   */
  canScheduleExactAlarms(): boolean {
    if (!isNativeAvailable()) return false;
    try {
      return (
        UnbreakableLock as unknown as { canScheduleExactAlarms: () => boolean }
      ).canScheduleExactAlarms();
    } catch {
      return false;
    }
  },

  async getSchedules(): Promise<LockSchedule[]> {
    return readLocal();
  },

  async getSchedule(id: string): Promise<LockSchedule | null> {
    const all = await readLocal();
    return all.find((s) => s.id === id) ?? null;
  },

  async createSchedule(input: CreateScheduleInput): Promise<LockSchedule> {
    const validation = validateSchedule(input);
    if (!validation.valid) {
      throw new LockError('INVALID_CONFIGURATION', validation.reason ?? 'Invalid schedule.');
    }

    const now = Date.now();
    const schedule: LockSchedule = {
      id: createId('sched'),
      name: input.name.trim(),
      enabled: true,
      appPackageNames: input.appPackageNames,
      daysOfWeek: input.daysOfWeek,
      startTime: input.startTime,
      endTime: input.endTime,
      strictMode: input.strictMode,
      createdAt: now,
      updatedAt: now,
    };

    const all = await readLocal();
    await sync([...all, schedule]);
    return schedule;
  },

  async updateSchedule(schedule: LockSchedule): Promise<LockSchedule> {
    const validation = validateSchedule(schedule);
    if (!validation.valid) {
      throw new LockError('INVALID_CONFIGURATION', validation.reason ?? 'Invalid schedule.');
    }

    const updated: LockSchedule = {
      ...schedule,
      name: schedule.name.trim(),
      updatedAt: Date.now(),
    };

    const all = await readLocal();
    // Editing an active schedule must not leave stale enforcement running, so
    // the sync below re-evaluates natively straight away.
    await sync(all.map((s) => (s.id === updated.id ? updated : s)));
    return updated;
  },

  async deleteSchedule(id: string): Promise<void> {
    const all = await readLocal();
    // Native recomputes from the remaining list, so deleting a running schedule
    // stops enforcement only if nothing else still covers those apps.
    await sync(all.filter((s) => s.id !== id));
  },

  async setScheduleEnabled(id: string, enabled: boolean): Promise<void> {
    const all = await readLocal();
    await sync(
      all.map((s) => (s.id === id ? { ...s, enabled, updatedAt: Date.now() } : s))
    );
  },

  /** Asks native to recompute, e.g. when the app returns to the foreground. */
  async refresh(): Promise<void> {
    if (!isNativeAvailable()) return;
    try {
      await (
        UnbreakableLock as unknown as { refreshSchedules: () => Promise<unknown> }
      ).refreshSchedules();
    } catch (err) {
      log.warn('Schedules', 'Native refresh failed', err);
    }
  },

  /** Test seam. */
  __calendarToWeekday: calendarToWeekday,
  __toNative: toNative,
};
