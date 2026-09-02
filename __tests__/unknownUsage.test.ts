import { startOfLocalDay, statusFor, usageSecondsFromEvents, type ForegroundEvent } from '../src/utils/dailyUsage';
import type { DailyUsageLimit } from '../src/types';

const YOUTUBE = 'com.google.android.youtube';
const MIN = 60;

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

/**
 * The measurement-failure policy, modelled.
 *
 * `DailyLimitEngine.kt` implements this; the model here pins the contract,
 * because the two opposite failure modes are both silent on a device and only
 * a deliberate test catches them:
 *
 *   - failure -> UNLOCK would let a revoked permission free an exhausted app;
 *   - failure -> LOCK would manufacture a lock out of a platform error.
 */
interface StoredLock {
  packages: string[];
  strictMode: boolean;
  /** Local day start the packages were established for. 0 means never. */
  measuredDayStart: number;
}

function evaluate(
  previous: StoredLock,
  measurement: Map<string, number> | null,
  limits: DailyUsageLimit[],
  now: Date
): { packages: string[]; strictMode: boolean; degraded: boolean; measuredDayStart: number } {
  const today = startOfLocalDay(now);

  if (measurement == null) {
    // Only a set established TODAY may be preserved. Yesterday's is stale by
    // definition, because the allowance has since reset.
    const establishedToday =
      previous.packages.length > 0 && previous.measuredDayStart === today;

    return {
      packages: establishedToday ? previous.packages : [],
      strictMode: establishedToday ? previous.strictMode : false,
      degraded: true,
      // Provenance is carried forward: this attempt measured nothing, so it
      // must not look like a fresh measurement.
      measuredDayStart: previous.measuredDayStart,
    };
  }

  const exhausted: string[] = [];
  let strictMode = false;
  for (const l of limits) {
    if (!l.enabled) continue;
    const used = measurement.get(l.appPackageName) ?? 0;
    if (used >= l.dailyLimitSeconds) {
      exhausted.push(l.appPackageName);
      if (l.strictMode) strictMode = true;
    }
  }

  return { packages: exhausted, strictMode, degraded: false, measuredDayStart: today };
}

const NEVER_MEASURED: StoredLock = { packages: [], strictMode: false, measuredDayStart: 0 };

describe('the four usage states stay distinct', () => {
  const now = new Date(2024, 0, 3, 12, 0, 0, 0);

  it('KNOWN_ZERO: measured, nothing used', () => {
    const status = statusFor(limit(), 0, now);
    expect(status.usageSeconds).toBe(0);
    expect(status.exhausted).toBe(false);
    expect(status.remainingSeconds).toBe(15 * MIN);
  });

  it('KNOWN_PARTIAL: measured, some used', () => {
    const status = statusFor(limit(), 6 * MIN, now);
    expect(status.usageSeconds).toBe(6 * MIN);
    expect(status.exhausted).toBe(false);
  });

  it('KNOWN_EXHAUSTED: measured, allowance spent', () => {
    const status = statusFor(limit(), 15 * MIN, now);
    expect(status.exhausted).toBe(true);
    expect(status.remainingSeconds).toBe(0);
  });

  it('UNKNOWN: never becomes zero', () => {
    const status = statusFor(limit(), null, now);
    // The distinction the whole feature rests on.
    expect(status.usageSeconds).toBeNull();
    expect(status.usageSeconds).not.toBe(0);
  });
});

describe('a failed measurement never unlocks an established lock', () => {
  const now = new Date(2024, 0, 3, 12, 0, 0, 0);
  const today = startOfLocalDay(now);

  it('preserves a lock established earlier today', () => {
    // The bug this covers: revoking Usage Access used to clear the exhausted
    // set, silently freeing an app the user had already spent their day on.
    const established: StoredLock = {
      packages: [YOUTUBE],
      strictMode: false,
      measuredDayStart: today,
    };

    const result = evaluate(established, null, [limit()], now);

    expect(result.packages).toEqual([YOUTUBE]);
    expect(result.degraded).toBe(true);
  });

  it('preserves Strict Mode along with the lock', () => {
    const established: StoredLock = {
      packages: [YOUTUBE],
      strictMode: true,
      measuredDayStart: today,
    };

    expect(evaluate(established, null, [limit({ strictMode: true })], now).strictMode).toBe(
      true
    );
  });

  it('does not treat the failed attempt as a fresh measurement', () => {
    const established: StoredLock = {
      packages: [YOUTUBE],
      strictMode: false,
      measuredDayStart: today,
    };

    // Provenance must stay put, or a stale set could survive into tomorrow.
    expect(evaluate(established, null, [limit()], now).measuredDayStart).toBe(today);
  });
});

describe('a failed measurement never manufactures a lock', () => {
  const now = new Date(2024, 0, 3, 12, 0, 0, 0);

  it('locks nothing when usage has never been measured', () => {
    // The opposite failure: assuming exhaustion out of a platform error.
    const result = evaluate(NEVER_MEASURED, null, [limit()], now);

    expect(result.packages).toEqual([]);
    expect(result.degraded).toBe(true);
  });

  it('does not resurrect yesterday’s exhausted set', () => {
    const yesterday = startOfLocalDay(new Date(2024, 0, 2, 12, 0, 0, 0));
    const stale: StoredLock = {
      packages: [YOUTUBE],
      strictMode: false,
      measuredDayStart: yesterday,
    };

    // Today's allowance is fresh, so yesterday's lock must not carry over just
    // because today cannot be measured.
    expect(evaluate(stale, null, [limit()], now).packages).toEqual([]);
  });

  it('clears the lock once a successful measurement says the allowance is free', () => {
    const established: StoredLock = {
      packages: [YOUTUBE],
      strictMode: false,
      measuredDayStart: startOfLocalDay(now),
    };

    // A real measurement always wins over a preserved state.
    const measured = new Map([[YOUTUBE, 2 * MIN]]);
    const result = evaluate(established, measured, [limit()], now);

    expect(result.packages).toEqual([]);
    expect(result.degraded).toBe(false);
  });
});

describe('a session spanning midnight is split between the days', () => {
  it('gives Monday only the minutes before midnight', () => {
    // Opened 23:55 Monday, still open at 23:59.
    const mondayMidnight = startOfLocalDay(new Date(2024, 0, 1, 12));
    const events: ForegroundEvent[] = [
      { packageName: YOUTUBE, timestamp: new Date(2024, 0, 1, 23, 55).getTime(), foreground: true },
    ];

    const monday = usageSecondsFromEvents(
      events,
      YOUTUBE,
      mondayMidnight,
      new Date(2024, 0, 1, 23, 59).getTime()
    );

    expect(monday).toBe(4 * MIN);
  });

  it('gives Tuesday only the minutes after midnight', () => {
    // Same session, closed 00:05 Tuesday. Tuesday's window starts at midnight,
    // so the opening event is clipped rather than counted in full.
    const tuesdayMidnight = startOfLocalDay(new Date(2024, 0, 2, 12));
    const events: ForegroundEvent[] = [
      { packageName: YOUTUBE, timestamp: new Date(2024, 0, 1, 23, 55).getTime(), foreground: true },
      { packageName: YOUTUBE, timestamp: new Date(2024, 0, 2, 0, 5).getTime(), foreground: false },
    ];

    const tuesday = usageSecondsFromEvents(
      events,
      YOUTUBE,
      tuesdayMidnight,
      new Date(2024, 0, 2, 1, 0).getTime()
    );

    // Five minutes, not the whole ten.
    expect(tuesday).toBe(5 * MIN);
  });
});

describe('background time is never counted', () => {
  it('sums only the foreground intervals', () => {
    // 10:00-10:05 and 10:30-10:35 is ten minutes, not thirty-five.
    const midnight = startOfLocalDay(new Date(2024, 0, 3, 12));
    const events: ForegroundEvent[] = [
      { packageName: YOUTUBE, timestamp: new Date(2024, 0, 3, 10, 0).getTime(), foreground: true },
      { packageName: YOUTUBE, timestamp: new Date(2024, 0, 3, 10, 5).getTime(), foreground: false },
      { packageName: YOUTUBE, timestamp: new Date(2024, 0, 3, 10, 30).getTime(), foreground: true },
      { packageName: YOUTUBE, timestamp: new Date(2024, 0, 3, 10, 35).getTime(), foreground: false },
    ];

    expect(
      usageSecondsFromEvents(events, YOUTUBE, midnight, new Date(2024, 0, 3, 12).getTime())
    ).toBe(10 * MIN);
  });
});
