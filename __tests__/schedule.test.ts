import {
  formatDays,
  formatTime24,
  getActiveSchedules,
  getEffectiveLockState,
  getNextScheduleStart,
  getNextTransition,
  getScheduleEnd,
  isOvernight,
  isScheduleActive,
  parseTime,
  scheduleDurationMinutes,
  validateSchedule,
} from '../src/utils/schedule';
import type { LockSchedule, Weekday } from '../src/types';

const YOUTUBE = 'com.google.android.youtube';
const INSTAGRAM = 'com.instagram.android';
const TIKTOK = 'com.zhiliaoapp.musically';

const ALL_DAYS: Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];
const WEEKDAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const WEEKEND: Weekday[] = ['saturday', 'sunday'];

function schedule(overrides: Partial<LockSchedule> = {}): LockSchedule {
  return {
    id: 'sched_1',
    name: 'Focus Schedule',
    enabled: true,
    appPackageNames: [YOUTUBE],
    daysOfWeek: ALL_DAYS,
    startTime: '22:00',
    endTime: '06:00',
    strictMode: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/**
 * Local-time helper. January 2024 dates are used throughout:
 * Mon 1st, Tue 2nd, Wed 3rd, Thu 4th, Fri 5th, Sat 6th, Sun 7th.
 */
function at(day: number, hours: number, minutes = 0): Date {
  return new Date(2024, 0, day, hours, minutes, 0, 0);
}

describe('time parsing', () => {
  it('parses valid 24-hour times', () => {
    expect(parseTime('00:00')).toBe(0);
    expect(parseTime('09:30')).toBe(570);
    expect(parseTime('22:00')).toBe(1320);
    expect(parseTime('23:59')).toBe(1439);
  });

  it('rejects malformed or out-of-range times', () => {
    for (const bad of ['', '24:00', '12:60', '9:5', 'noon', '-1:00', '12']) {
      expect(parseTime(bad)).toBeNull();
    }
  });

  it('round-trips through formatting', () => {
    expect(formatTime24(1320)).toBe('22:00');
    expect(formatTime24(0)).toBe('00:00');
    expect(parseTime(formatTime24(570))).toBe(570);
  });
});

describe('same-day schedules', () => {
  const work = schedule({ startTime: '09:00', endTime: '17:00', daysOfWeek: WEEKDAYS });

  it('is inactive before the start', () => {
    expect(isScheduleActive(work, at(1, 8, 59))).toBe(false);
  });

  it('is active from exactly the start time', () => {
    expect(isScheduleActive(work, at(1, 9, 0))).toBe(true);
  });

  it('is active in the middle', () => {
    expect(isScheduleActive(work, at(1, 13, 0))).toBe(true);
  });

  it('is inactive from exactly the end time', () => {
    // End is exclusive, so a 9-5 lock is genuinely over at 17:00.
    expect(isScheduleActive(work, at(1, 17, 0))).toBe(false);
  });

  it('is inactive after the end', () => {
    expect(isScheduleActive(work, at(1, 18, 0))).toBe(false);
  });

  it('ends later the same day', () => {
    expect(getScheduleEnd(work, at(1, 13, 0))).toBe(at(1, 17, 0).getTime());
  });

  it('is not overnight', () => {
    expect(isOvernight(work)).toBe(false);
    expect(scheduleDurationMinutes(work)).toBe(8 * 60);
  });
});

describe('overnight schedules', () => {
  const sleep = schedule({ startTime: '22:00', endTime: '06:00', daysOfWeek: ALL_DAYS });

  it('is recognised as crossing midnight', () => {
    expect(isOvernight(sleep)).toBe(true);
    expect(scheduleDurationMinutes(sleep)).toBe(8 * 60);
  });

  it('is inactive at 9 PM, before it starts', () => {
    expect(isScheduleActive(sleep, at(1, 21, 0))).toBe(false);
  });

  it('is active at 11 PM on the starting day', () => {
    expect(isScheduleActive(sleep, at(1, 23, 0))).toBe(true);
  });

  it('is active at 2 AM, from the occurrence that began yesterday', () => {
    // The whole point of the overnight case: at 2am the running occurrence
    // started the previous calendar day.
    expect(isScheduleActive(sleep, at(2, 2, 0))).toBe(true);
  });

  it('is active at 5:59 AM and inactive at 6:01 AM', () => {
    expect(isScheduleActive(sleep, at(2, 5, 59))).toBe(true);
    expect(isScheduleActive(sleep, at(2, 6, 1))).toBe(false);
  });

  it('is inactive at 7 AM', () => {
    expect(isScheduleActive(sleep, at(2, 7, 0))).toBe(false);
  });

  it('ends tomorrow morning when asked during the evening', () => {
    expect(getScheduleEnd(sleep, at(1, 23, 0))).toBe(at(2, 6, 0).getTime());
  });

  it('ends this morning when asked after midnight', () => {
    expect(getScheduleEnd(sleep, at(2, 2, 0))).toBe(at(2, 6, 0).getTime());
  });

  it('respects the starting day, not the ending day', () => {
    // Friday-only, 22:00-06:00 must still be running at 2am on Saturday, and
    // must NOT start on Saturday evening.
    const fridayNight = schedule({ daysOfWeek: ['friday'] });

    expect(isScheduleActive(fridayNight, at(5, 23, 0))).toBe(true); // Fri 11pm
    expect(isScheduleActive(fridayNight, at(6, 2, 0))).toBe(true); // Sat 2am
    expect(isScheduleActive(fridayNight, at(6, 23, 0))).toBe(false); // Sat 11pm
  });
});

describe('day selection', () => {
  it('honours a single day', () => {
    const mondayOnly = schedule({
      daysOfWeek: ['monday'],
      startTime: '09:00',
      endTime: '17:00',
    });

    expect(isScheduleActive(mondayOnly, at(1, 12, 0))).toBe(true); // Monday
    expect(isScheduleActive(mondayOnly, at(2, 12, 0))).toBe(false); // Tuesday
  });

  it('honours weekdays', () => {
    const work = schedule({
      daysOfWeek: WEEKDAYS,
      startTime: '09:00',
      endTime: '17:00',
    });

    expect(isScheduleActive(work, at(5, 12, 0))).toBe(true); // Friday
    expect(isScheduleActive(work, at(6, 12, 0))).toBe(false); // Saturday
    expect(isScheduleActive(work, at(7, 12, 0))).toBe(false); // Sunday
  });

  it('honours weekends', () => {
    const lazy = schedule({
      daysOfWeek: WEEKEND,
      startTime: '09:00',
      endTime: '17:00',
    });

    expect(isScheduleActive(lazy, at(6, 12, 0))).toBe(true); // Saturday
    expect(isScheduleActive(lazy, at(7, 12, 0))).toBe(true); // Sunday
    expect(isScheduleActive(lazy, at(1, 12, 0))).toBe(false); // Monday
  });

  it('is never active with no days selected', () => {
    expect(isScheduleActive(schedule({ daysOfWeek: [] }), at(1, 23, 0))).toBe(false);
  });

  it('is never active when disabled', () => {
    expect(isScheduleActive(schedule({ enabled: false }), at(1, 23, 0))).toBe(false);
  });

  it('formats day sets for display', () => {
    expect(formatDays(ALL_DAYS)).toBe('Every day');
    expect(formatDays(WEEKDAYS)).toBe('Mon–Fri');
    expect(formatDays(WEEKEND)).toBe('Weekends');
    expect(formatDays(['monday', 'wednesday'])).toBe('Mon Wed');
    expect(formatDays([])).toBe('No days');
  });
});

describe('multiple overlapping schedules', () => {
  const work = schedule({
    id: 'work',
    name: 'Work',
    appPackageNames: [YOUTUBE, INSTAGRAM],
    daysOfWeek: WEEKDAYS,
    startTime: '09:00',
    endTime: '17:00',
  });

  const social = schedule({
    id: 'social',
    name: 'Social',
    appPackageNames: [TIKTOK, INSTAGRAM],
    daysOfWeek: ALL_DAYS,
    startTime: '12:00',
    endTime: '20:00',
    strictMode: true,
  });

  it('finds every schedule running at a moment', () => {
    const active = getActiveSchedules([work, social], at(1, 13, 0));
    expect(active.map((s) => s.id).sort()).toEqual(['social', 'work']);
  });

  it('takes the union of blocked apps', () => {
    const state = getEffectiveLockState([work, social], at(1, 13, 0));

    // No app may slip through because one schedule happened not to list it.
    expect(state.packages).toEqual([INSTAGRAM, TIKTOK, YOUTUBE].sort());
  });

  it('turns Strict Mode on if any active schedule wants it', () => {
    expect(getEffectiveLockState([work, social], at(1, 13, 0)).strictMode).toBe(true);
    expect(getEffectiveLockState([work], at(1, 13, 0)).strictMode).toBe(false);
  });

  it('uses the LATEST end, so a short schedule ending unlocks nothing', () => {
    const state = getEffectiveLockState([work, social], at(1, 13, 0));

    // Work ends at 17:00, social at 20:00. Ending at 17:00 would free apps
    // that social is still covering.
    expect(state.endTimestamp).toBe(at(1, 20, 0).getTime());
  });

  it('reports inactive when nothing is running', () => {
    const state = getEffectiveLockState([], at(1, 3, 0));
    expect(state.active).toBe(false);
    expect(state.packages).toEqual([]);
    expect(state.endTimestamp).toBe(0);
  });
});

describe('next transition', () => {
  const work = schedule({
    id: 'work',
    daysOfWeek: WEEKDAYS,
    startTime: '09:00',
    endTime: '17:00',
  });

  it('finds the next start when nothing is running', () => {
    expect(getNextTransition([work], at(1, 7, 0))).toBe(at(1, 9, 0).getTime());
  });

  it('finds the end when something is running', () => {
    expect(getNextTransition([work], at(1, 13, 0))).toBe(at(1, 17, 0).getTime());
  });

  it('skips to the next selected day', () => {
    // Friday evening: the next weekday start is Monday morning.
    expect(getNextTransition([work], at(5, 18, 0))).toBe(at(8, 9, 0).getTime());
  });

  it('returns the earliest of several candidates', () => {
    const sleep = schedule({ id: 'sleep', startTime: '22:00', endTime: '06:00' });

    // 18:00 Monday: sleep starts 22:00, work starts 09:00 tomorrow.
    expect(getNextTransition([work, sleep], at(1, 18, 0))).toBe(at(1, 22, 0).getTime());
  });

  it('ignores disabled schedules', () => {
    expect(getNextTransition([schedule({ enabled: false })], at(1, 12, 0))).toBeNull();
  });

  it('returns null when there is nothing scheduled', () => {
    expect(getNextTransition([], at(1, 12, 0))).toBeNull();
    expect(getNextTransition([schedule({ daysOfWeek: [] })], at(1, 12, 0))).toBeNull();
  });

  it('never returns a moment in the past', () => {
    const now = at(1, 9, 0);
    const next = getNextTransition([work], now);
    expect(next).not.toBeNull();
    expect(next!).toBeGreaterThan(now.getTime());
  });

  it('finds tomorrow when today has already started', () => {
    const daily = schedule({ startTime: '09:00', endTime: '10:00', daysOfWeek: ALL_DAYS });
    expect(getNextScheduleStart(daily, at(1, 9, 30))).toBe(at(2, 9, 0).getTime());
  });
});

describe('missed transitions and restarts', () => {
  const sleep = schedule({ startTime: '22:00', endTime: '06:00', daysOfWeek: ALL_DAYS });

  it('detects an active schedule when the device boots mid-window', () => {
    // Powered off at 9pm, booted at 2am: the engine must see this as ACTIVE and
    // start enforcing immediately, not wait for the next 10pm.
    expect(isScheduleActive(sleep, at(2, 2, 0))).toBe(true);
    expect(getScheduleEnd(sleep, at(2, 2, 0))).toBe(at(2, 6, 0).getTime());
  });

  it('detects an inactive schedule when the device boots outside the window', () => {
    expect(isScheduleActive(sleep, at(2, 9, 0))).toBe(false);
    expect(getNextTransition([sleep], at(2, 9, 0))).toBe(at(2, 22, 0).getTime());
  });

  it('recomputes correctly after a forward clock jump', () => {
    // Evaluation is a pure function of the supplied instant, so a clock jump is
    // simply a different input — there is no accumulated counter to corrupt.
    expect(isScheduleActive(sleep, at(1, 21, 0))).toBe(false);
    expect(isScheduleActive(sleep, at(1, 23, 0))).toBe(true);
  });

  it('recomputes correctly after a backward clock jump', () => {
    expect(isScheduleActive(sleep, at(2, 5, 0))).toBe(true);
    expect(isScheduleActive(sleep, at(1, 20, 0))).toBe(false);
  });

  it('uses wall-clock so the schedule follows the user across timezones', () => {
    // 22:00 local means 22:00 wherever they are. The same local time is active
    // regardless of what UTC offset the device is on.
    const eveningLocal = at(1, 22, 30);
    expect(isScheduleActive(sleep, eveningLocal)).toBe(true);
    // And the stored definition is still wall-clock, not an instant.
    expect(sleep.startTime).toBe('22:00');
  });
});

describe('validation', () => {
  const base = {
    name: 'Sleep',
    appPackageNames: [YOUTUBE],
    daysOfWeek: ALL_DAYS,
    startTime: '22:00',
    endTime: '06:00',
  };

  it('accepts a sensible schedule', () => {
    expect(validateSchedule(base).valid).toBe(true);
  });

  it('requires a name', () => {
    expect(validateSchedule({ ...base, name: '   ' }).valid).toBe(false);
  });

  it('caps the name length', () => {
    expect(validateSchedule({ ...base, name: 'x'.repeat(41) }).valid).toBe(false);
  });

  it('requires at least one app', () => {
    expect(validateSchedule({ ...base, appPackageNames: [] }).valid).toBe(false);
  });

  it('requires at least one day', () => {
    expect(validateSchedule({ ...base, daysOfWeek: [] }).valid).toBe(false);
  });

  it('rejects malformed times', () => {
    expect(validateSchedule({ ...base, startTime: '25:00' }).valid).toBe(false);
    expect(validateSchedule({ ...base, endTime: 'later' }).valid).toBe(false);
  });

  it('rejects identical start and end, rather than guessing', () => {
    // Zero minutes or twenty-four hours? Refusing beats picking one silently.
    const result = validateSchedule({ ...base, startTime: '09:00', endTime: '09:00' });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/cannot be the same/);
  });

  it('accepts an overnight range that a naive check would reject', () => {
    expect(validateSchedule({ ...base, startTime: '22:00', endTime: '06:00' }).valid).toBe(
      true
    );
  });
});
