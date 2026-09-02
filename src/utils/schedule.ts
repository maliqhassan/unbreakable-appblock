import type { EffectiveLockState, LockSchedule, Weekday } from '../types';

/**
 * Schedule maths.
 *
 * Every function here is pure and takes the reference `Date` explicitly, so the
 * whole recurrence model is testable without a device, a clock, or a timezone
 * mock. The Kotlin engine mirrors these rules — see SCHEDULES.md.
 *
 * The model in one line: a schedule is **weekday + local wall clock**, never an
 * instant. "Weekdays, 10pm" means 10pm wherever the user is, so flying to
 * another timezone moves the schedule with them rather than firing at 3am.
 */

export const WEEKDAYS: Weekday[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export const WEEKDAY_SHORT: Record<Weekday, string> = {
  sunday: 'Sun',
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
};

/** Monday-first, matching how the day picker reads. */
export const WEEKDAY_ORDER: Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export const WEEKDAY_INITIAL: Record<Weekday, string> = {
  monday: 'M',
  tuesday: 'T',
  wednesday: 'W',
  thursday: 'T',
  friday: 'F',
  saturday: 'S',
  sunday: 'S',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** "HH:mm" → minutes from local midnight. Returns null when malformed. */
export function parseTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return hours * 60 + minutes;
}

/** Minutes from midnight → "HH:mm". */
export function formatTime24(minutes: number): string {
  const normalised = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalised / 60);
  const m = normalised % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "22:00" → "10:00 PM", in the device's locale. */
export function formatTimeLabel(value: string): string {
  const minutes = parseTime(value);
  if (minutes == null) return value;

  const date = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function weekdayOf(date: Date): Weekday {
  return WEEKDAYS[date.getDay()];
}

export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function previousWeekday(day: Weekday): Weekday {
  const index = WEEKDAYS.indexOf(day);
  return WEEKDAYS[(index + 6) % 7];
}

/**
 * True when the schedule crosses midnight, e.g. 22:00 → 06:00.
 *
 * Equal times are treated as overnight-invalid by {@link validateSchedule};
 * here they simply are not "same day".
 */
export function isOvernight(schedule: LockSchedule): boolean {
  const start = parseTime(schedule.startTime);
  const end = parseTime(schedule.endTime);
  if (start == null || end == null) return false;
  return end <= start;
}

/**
 * Is this schedule running at `date`?
 *
 * The subtle case is overnight: at 2am on Tuesday, the running occurrence is
 * the one that started *Monday* at 22:00. So we check both the occurrence that
 * could have started today and the one that could have started yesterday.
 */
export function isScheduleActive(schedule: LockSchedule, date: Date): boolean {
  if (!schedule.enabled) return false;
  if (schedule.daysOfWeek.length === 0) return false;

  const start = parseTime(schedule.startTime);
  const end = parseTime(schedule.endTime);
  if (start == null || end == null || start === end) return false;

  const now = minutesOfDay(date);
  const today = weekdayOf(date);
  const days = new Set(schedule.daysOfWeek);

  if (start < end) {
    // Same-day window. End is exclusive so a 09:00-17:00 schedule is over at
    // exactly 17:00 rather than lingering for a minute.
    return days.has(today) && now >= start && now < end;
  }

  // Overnight. Either it started today and has not yet reached midnight...
  if (days.has(today) && now >= start) return true;
  // ...or it started yesterday and is still running into this morning.
  if (days.has(previousWeekday(today)) && now < end) return true;

  return false;
}

export function getActiveSchedules(schedules: LockSchedule[], date: Date): LockSchedule[] {
  return schedules.filter((schedule) => isScheduleActive(schedule, date));
}

function atLocalTime(date: Date, minutes: number, dayOffset = 0): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + dayOffset);
  result.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return result;
}

/**
 * When the currently-running occurrence ends.
 *
 * @returns epoch ms, or null when the schedule is not running at `date`.
 */
export function getScheduleEnd(schedule: LockSchedule, date: Date): number | null {
  if (!isScheduleActive(schedule, date)) return null;

  const start = parseTime(schedule.startTime);
  const end = parseTime(schedule.endTime);
  if (start == null || end == null) return null;

  const now = minutesOfDay(date);

  // Same-day: ends later today.
  if (start < end) return atLocalTime(date, end).getTime();

  // Overnight that started today: ends tomorrow morning.
  if (now >= start) return atLocalTime(date, end, 1).getTime();

  // Overnight that started yesterday: ends later this morning.
  return atLocalTime(date, end).getTime();
}

/**
 * The next moment this schedule starts, strictly after `date`.
 *
 * Searches eight days so a weekly schedule always resolves, including the case
 * where today's occurrence has already begun.
 */
export function getNextScheduleStart(schedule: LockSchedule, date: Date): number | null {
  if (!schedule.enabled || schedule.daysOfWeek.length === 0) return null;

  const start = parseTime(schedule.startTime);
  if (start == null) return null;

  const days = new Set(schedule.daysOfWeek);

  for (let offset = 0; offset < 8; offset += 1) {
    const candidate = atLocalTime(date, start, offset);
    if (candidate.getTime() <= date.getTime()) continue;
    if (!days.has(weekdayOf(candidate))) continue;
    return candidate.getTime();
  }

  return null;
}

/**
 * The next moment the effective state changes — a schedule starting, or a
 * running one ending.
 *
 * This is what the alarm is set for. Returning the *earliest* such moment is
 * what lets the engine sleep instead of polling.
 */
export function getNextTransition(schedules: LockSchedule[], date: Date): number | null {
  const candidates: number[] = [];

  for (const schedule of schedules) {
    if (!schedule.enabled) continue;

    const end = getScheduleEnd(schedule, date);
    if (end != null && end > date.getTime()) candidates.push(end);

    const start = getNextScheduleStart(schedule, date);
    if (start != null) candidates.push(start);
  }

  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

/**
 * Merges every active schedule into one enforcement state.
 *
 * Three rules, each chosen so an overlap can never *weaken* protection:
 *   - apps are the **union**, so no app slips through a gap;
 *   - strict mode is true if **any** schedule wants it;
 *   - the end is the **latest**, so a short schedule ending cannot unlock apps
 *     a longer one is still covering.
 */
export function getEffectiveLockState(
  activeSchedules: LockSchedule[],
  date: Date
): EffectiveLockState {
  if (activeSchedules.length === 0) {
    return {
      active: false,
      packages: [],
      strictMode: false,
      endTimestamp: 0,
      sources: [],
    };
  }

  const packages = new Set<string>();
  let strictMode = false;
  let endTimestamp = 0;

  for (const schedule of activeSchedules) {
    for (const pkg of schedule.appPackageNames) packages.add(pkg);
    if (schedule.strictMode) strictMode = true;

    const end = getScheduleEnd(schedule, date);
    if (end != null && end > endTimestamp) endTimestamp = end;
  }

  return {
    active: true,
    packages: Array.from(packages).sort(),
    strictMode,
    endTimestamp,
    sources: ['schedule'],
  };
}

/** "Mon Tue Wed Thu Fri", "Every day", "Weekends". */
export function formatDays(days: Weekday[]): string {
  if (days.length === 0) return 'No days';
  if (days.length === 7) return 'Every day';

  const set = new Set(days);
  const weekdays: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  const weekend: Weekday[] = ['saturday', 'sunday'];

  if (days.length === 5 && weekdays.every((d) => set.has(d))) return 'Mon–Fri';
  if (days.length === 2 && weekend.every((d) => set.has(d))) return 'Weekends';

  return WEEKDAY_ORDER.filter((d) => set.has(d))
    .map((d) => WEEKDAY_SHORT[d])
    .join(' ');
}

export interface ScheduleValidation {
  valid: boolean;
  reason?: string;
}

/** Shared by the create screen and the service, so both reject the same things. */
export function validateSchedule(
  schedule: Pick<
    LockSchedule,
    'name' | 'appPackageNames' | 'daysOfWeek' | 'startTime' | 'endTime'
  >
): ScheduleValidation {
  const name = schedule.name.trim();
  if (name.length === 0) return { valid: false, reason: 'Give the schedule a name.' };
  if (name.length > 40) {
    return { valid: false, reason: 'Names must be 40 characters or fewer.' };
  }

  if (schedule.appPackageNames.length === 0) {
    return { valid: false, reason: 'Choose at least one app to block.' };
  }
  if (schedule.daysOfWeek.length === 0) {
    return { valid: false, reason: 'Choose at least one day.' };
  }

  const start = parseTime(schedule.startTime);
  const end = parseTime(schedule.endTime);
  if (start == null) return { valid: false, reason: 'The start time is not valid.' };
  if (end == null) return { valid: false, reason: 'The end time is not valid.' };

  // Equal times are the one genuinely ambiguous case: zero-length, or 24 hours?
  // Rather than guess, we refuse it.
  if (start === end) {
    return { valid: false, reason: 'The start and end times cannot be the same.' };
  }

  return { valid: true };
}

/** Human summary for a card: "10:00 PM → 6:00 AM". */
export function formatTimeRange(schedule: LockSchedule): string {
  return `${formatTimeLabel(schedule.startTime)} → ${formatTimeLabel(schedule.endTime)}`;
}

/** How long one occurrence runs, in minutes. Handles the midnight wrap. */
export function scheduleDurationMinutes(schedule: LockSchedule): number {
  const start = parseTime(schedule.startTime);
  const end = parseTime(schedule.endTime);
  if (start == null || end == null) return 0;
  return end > start ? end - start : 1440 - start + end;
}

export { DAY_MS };
