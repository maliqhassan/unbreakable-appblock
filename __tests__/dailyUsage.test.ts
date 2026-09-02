import {
  exhaustedPackages,
  formatLimit,
  formatRemaining,
  formatUsageSummary,
  nextLocalMidnight,
  startOfLocalDay,
  statusFor,
  usageFraction,
  usageSecondsFromEvents,
  validateLimit,
  type ForegroundEvent,
} from '../src/utils/dailyUsage';
import type { DailyUsageLimit } from '../src/types';

const YOUTUBE = 'com.google.android.youtube';
const INSTAGRAM = 'com.instagram.android';

const MIN = 60;

/** 3 January 2024, local time. */
function at(hours: number, minutes = 0, day = 3): number {
  return new Date(2024, 0, day, hours, minutes, 0, 0).getTime();
}

function resumed(pkg: string, ms: number): ForegroundEvent {
  return { packageName: pkg, timestamp: ms, foreground: true };
}
function paused(pkg: string, ms: number): ForegroundEvent {
  return { packageName: pkg, timestamp: ms, foreground: false };
}

function limit(overrides: Partial<DailyUsageLimit> = {}): DailyUsageLimit {
  return {
    id: 'limit_1',
    appPackageName: YOUTUBE,
    dailyLimitSeconds: 15 * MIN,
    enabled: true,
    strictMode: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('usage measured from real foreground intervals', () => {
  const midnight = startOfLocalDay(new Date(at(12)));

  it('counts a single session', () => {
    // 09:00 -> 09:07 is seven minutes.
    const events = [resumed(YOUTUBE, at(9, 0)), paused(YOUTUBE, at(9, 7))];

    expect(usageSecondsFromEvents(events, YOUTUBE, midnight, at(12))).toBe(7 * MIN);
  });

  it('sums several sessions across the day', () => {
    // 09:00-09:05, 10:00-10:04, 11:30-11:36 = 15 minutes.
    const events = [
      resumed(YOUTUBE, at(9, 0)),
      paused(YOUTUBE, at(9, 5)),
      resumed(YOUTUBE, at(10, 0)),
      paused(YOUTUBE, at(10, 4)),
      resumed(YOUTUBE, at(11, 30)),
      paused(YOUTUBE, at(11, 36)),
    ];

    expect(usageSecondsFromEvents(events, YOUTUBE, midnight, at(12))).toBe(15 * MIN);
  });

  it('counts an app that is still open, up to now', () => {
    // Without this, sitting in an app forever would spend no allowance at all.
    const events = [resumed(YOUTUBE, at(9, 0))];

    expect(usageSecondsFromEvents(events, YOUTUBE, midnight, at(9, 10))).toBe(10 * MIN);
  });

  it('never counts background time', () => {
    const events = [
      resumed(YOUTUBE, at(9, 0)),
      paused(YOUTUBE, at(9, 5)),
      // Three hours in the background contribute nothing.
    ];

    expect(usageSecondsFromEvents(events, YOUTUBE, midnight, at(12))).toBe(5 * MIN);
  });

  it('keeps each app independent', () => {
    const events = [
      resumed(YOUTUBE, at(9, 0)),
      paused(YOUTUBE, at(9, 10)),
      resumed(INSTAGRAM, at(10, 0)),
      paused(INSTAGRAM, at(10, 30)),
    ];

    // Using YouTube must not spend Instagram's budget.
    expect(usageSecondsFromEvents(events, YOUTUBE, midnight, at(12))).toBe(10 * MIN);
    expect(usageSecondsFromEvents(events, INSTAGRAM, midnight, at(12))).toBe(30 * MIN);
  });

  it('clips a session that began before the window', () => {
    // Opened 23:00 yesterday, closed 00:20 today: only 20 minutes are today's.
    const events = [resumed(YOUTUBE, at(23, 0, 2)), paused(YOUTUBE, at(0, 20))];

    expect(usageSecondsFromEvents(events, YOUTUBE, midnight, at(12))).toBe(20 * MIN);
  });

  it('tolerates events arriving out of order', () => {
    const events = [
      paused(YOUTUBE, at(9, 5)),
      resumed(YOUTUBE, at(9, 0)),
      paused(YOUTUBE, at(10, 4)),
      resumed(YOUTUBE, at(10, 0)),
    ];

    expect(usageSecondsFromEvents(events, YOUTUBE, midnight, at(12))).toBe(9 * MIN);
  });

  it('tolerates a repeated RESUMED without a PAUSE between', () => {
    // Real devices emit these. Keeping the earliest avoids truncating.
    const events = [
      resumed(YOUTUBE, at(9, 0)),
      resumed(YOUTUBE, at(9, 2)),
      paused(YOUTUBE, at(9, 10)),
    ];

    expect(usageSecondsFromEvents(events, YOUTUBE, midnight, at(12))).toBe(10 * MIN);
  });

  it('ignores a PAUSE with no matching RESUME', () => {
    expect(usageSecondsFromEvents([paused(YOUTUBE, at(9, 5))], YOUTUBE, midnight, at(12))).toBe(0);
  });

  it('reports zero when the app was never opened', () => {
    const events = [resumed(INSTAGRAM, at(9, 0)), paused(INSTAGRAM, at(9, 30))];
    expect(usageSecondsFromEvents(events, YOUTUBE, midnight, at(12))).toBe(0);
  });
});

describe('remaining allowance', () => {
  const now = new Date(at(12));

  it('reports the full allowance at zero usage', () => {
    const status = statusFor(limit(), 0, now);
    expect(status.remainingSeconds).toBe(15 * MIN);
    expect(status.exhausted).toBe(false);
  });

  it('subtracts partial usage', () => {
    const status = statusFor(limit(), 4 * MIN, now);
    expect(status.remainingSeconds).toBe(11 * MIN);
    expect(status.exhausted).toBe(false);
  });

  it('treats exactly the limit as exhausted', () => {
    // A 15-minute budget means 15 minutes, not 15 minutes and one more second.
    const status = statusFor(limit(), 15 * MIN, now);
    expect(status.remainingSeconds).toBe(0);
    expect(status.exhausted).toBe(true);
  });

  it('clamps to zero rather than going negative', () => {
    const status = statusFor(limit(), 40 * MIN, now);
    expect(status.remainingSeconds).toBe(0);
    expect(status.exhausted).toBe(true);
  });

  it('is never exhausted while disabled', () => {
    const status = statusFor(limit({ enabled: false }), 40 * MIN, now);
    expect(status.exhausted).toBe(false);
  });

  it('never locks when usage could not be read', () => {
    // Enforcing on a failed query would punish the user for a platform problem.
    const status = statusFor(limit(), null, now);
    expect(status.usageSeconds).toBeNull();
    expect(status.exhausted).toBe(false);
  });

  it('distinguishes unknown usage from zero usage in the UI', () => {
    expect(formatUsageSummary(statusFor(limit(), null, now))).toBe('Usage unavailable');
    expect(formatUsageSummary(statusFor(limit(), 0, now))).toBe('0m / 15m used');
  });

  it('computes a progress fraction for the bar', () => {
    expect(usageFraction(statusFor(limit(), 0, now))).toBe(0);
    expect(usageFraction(statusFor(limit(), 5 * MIN, now))).toBeCloseTo(1 / 3);
    // Over the limit still reads as full, never more.
    expect(usageFraction(statusFor(limit(), 60 * MIN, now))).toBe(1);
    expect(usageFraction(statusFor(limit(), null, now))).toBe(0);
  });

  it('lists only the exhausted packages', () => {
    const statuses = [
      statusFor(limit({ appPackageName: YOUTUBE }), 20 * MIN, now),
      statusFor(limit({ appPackageName: INSTAGRAM, dailyLimitSeconds: 30 * MIN }), 5 * MIN, now),
    ];

    // One app being spent must not lock a different app.
    expect(exhaustedPackages(statuses)).toEqual([YOUTUBE]);
  });
});

describe('changing a limit recalculates immediately', () => {
  const now = new Date(at(12));

  it('raising the limit gives time back', () => {
    expect(statusFor(limit({ dailyLimitSeconds: 15 * MIN }), 12 * MIN, now).remainingSeconds).toBe(
      3 * MIN
    );
    expect(statusFor(limit({ dailyLimitSeconds: 30 * MIN }), 12 * MIN, now).remainingSeconds).toBe(
      18 * MIN
    );
  });

  it('lowering the limit below current usage exhausts it at once', () => {
    // 20 minutes already used, limit reduced to 15: locked immediately, not on
    // the next app launch.
    const status = statusFor(limit({ dailyLimitSeconds: 15 * MIN }), 20 * MIN, now);
    expect(status.exhausted).toBe(true);
    expect(status.remainingSeconds).toBe(0);
  });
});

describe('local midnight reset', () => {
  it('resets at the next local midnight, not 24 hours after first use', () => {
    const evening = new Date(at(22, 30));
    expect(nextLocalMidnight(evening)).toBe(new Date(2024, 0, 4, 0, 0, 0, 0).getTime());
  });

  it('gives the start of the current local day', () => {
    expect(startOfLocalDay(new Date(at(13, 45)))).toBe(
      new Date(2024, 0, 3, 0, 0, 0, 0).getTime()
    );
  });

  it('does not count yesterday against today', () => {
    const todayMidnight = startOfLocalDay(new Date(at(9)));
    const events = [
      // Yesterday, entirely before the window.
      resumed(YOUTUBE, at(14, 0, 2)),
      paused(YOUTUBE, at(15, 0, 2)),
      // Today.
      resumed(YOUTUBE, at(8, 0)),
      paused(YOUTUBE, at(8, 6)),
    ];

    expect(usageSecondsFromEvents(events, YOUTUBE, todayMidnight, at(9))).toBe(6 * MIN);
  });

  it('reports the same reset time all day', () => {
    const morning = nextLocalMidnight(new Date(at(1)));
    const evening = nextLocalMidnight(new Date(at(23)));
    expect(morning).toBe(evening);
  });

  it('rolls to the following day just after midnight', () => {
    const justAfter = new Date(2024, 0, 4, 0, 1, 0, 0);
    expect(nextLocalMidnight(justAfter)).toBe(new Date(2024, 0, 5, 0, 0, 0, 0).getTime());
  });
});

describe('validation', () => {
  const existing = [limit({ id: 'a', appPackageName: YOUTUBE })];

  it('accepts a new app with a sensible limit', () => {
    expect(
      validateLimit({ appPackageName: INSTAGRAM, dailyLimitSeconds: 30 * MIN }, existing).valid
    ).toBe(true);
  });

  it('refuses a second limit for the same app', () => {
    const result = validateLimit(
      { appPackageName: YOUTUBE, dailyLimitSeconds: 30 * MIN },
      existing
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/already has a daily limit/);
  });

  it('allows editing the app that already has the limit', () => {
    expect(
      validateLimit({ appPackageName: YOUTUBE, dailyLimitSeconds: 30 * MIN }, existing, 'a').valid
    ).toBe(true);
  });

  it('rejects limits outside a sensible range', () => {
    expect(validateLimit({ appPackageName: INSTAGRAM, dailyLimitSeconds: 30 }, existing).valid).toBe(
      false
    );
    expect(
      validateLimit({ appPackageName: INSTAGRAM, dailyLimitSeconds: 20 * 60 * 60 }, existing).valid
    ).toBe(false);
  });

  it('requires an app', () => {
    expect(validateLimit({ appPackageName: '', dailyLimitSeconds: 15 * MIN }, existing).valid).toBe(
      false
    );
  });
});

describe('formatting', () => {
  it('formats limits the way people say them', () => {
    expect(formatLimit(15 * MIN)).toBe('15 min');
    expect(formatLimit(60 * MIN)).toBe('1 hour');
    expect(formatLimit(120 * MIN)).toBe('2 hours');
    expect(formatLimit(90 * MIN)).toBe('1h 30m');
  });

  it('formats remaining time, including the awkward ends', () => {
    expect(formatRemaining(0)).toBe('none left');
    expect(formatRemaining(30)).toBe('under a minute');
    expect(formatRemaining(11 * MIN)).toBe('11m remaining');
    expect(formatRemaining(90 * MIN)).toBe('1h 30m remaining');
  });
});
