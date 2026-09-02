/**
 * Ignoring a spent daily allowance.
 *
 * A JS model of the rules `DailyLimitEngine` and `LockForegroundService`
 * implement in Kotlin. Native cannot be exercised from Jest, so these pin the
 * *contract*: who may extend a limit, for how long, and what must never open
 * that door.
 *
 * The product reasoning: a daily allowance is a budget, not a promise. With
 * Strict Mode off the user is allowed to overspend it knowingly — an app that
 * refuses gets uninstalled, which protects nobody. Strict Mode is where the
 * promise is absolute, and there the door does not exist.
 */

const MINUTE = 60_000;

interface Limit {
  packageName: string;
  limitSeconds: number;
  strictMode: boolean;
}

interface World {
  now: number;
  /** Seconds used today, per package. */
  usage: Record<string, number>;
  /** package -> epoch ms the override runs until. */
  overrides: Record<string, number>;
  /** Packages a manual lock or schedule is also blocking. */
  nonDaily: string[];
  /** Epoch ms of the next local midnight. */
  resetsAt: number;
}

/** Mirrors the exhausted-set calculation in DailyLimitEngine.evaluate(). */
function blockedPackages(limits: Limit[], w: World): string[] {
  return limits
    .filter((limit) => {
      const used = w.usage[limit.packageName] ?? 0;
      if (used < limit.limitSeconds) return false;

      // Strict Mode is re-checked here rather than trusted from the stored
      // override, so turning it on closes the door immediately.
      if (limit.strictMode) return true;

      const until = w.overrides[limit.packageName] ?? 0;
      return until <= w.now;
    })
    .map((l) => l.packageName);
}

/** Mirrors the `canOverride` decision in LockForegroundService. */
function canOverride(limit: Limit | undefined, packageName: string, w: World): boolean {
  if (!limit) return false;
  if (limit.strictMode) return false;
  // Ignoring the daily limit would change nothing while another source blocks
  // the same app, so the option is not offered.
  return !w.nonDaily.includes(packageName);
}

/** The four choices behind "Ignore limit". */
function grantUntil(
  choice: 'minute' | 'snooze' | 'today' | 'cancel',
  limit: Limit,
  w: World
): number | null {
  switch (choice) {
    case 'minute':
      return w.now + MINUTE;
    case 'snooze':
      return w.now + (limit.limitSeconds / 60) * MINUTE;
    case 'today':
      return w.resetsAt;
    case 'cancel':
      return null;
  }
}

const YT = 'com.google.android.youtube';
const IG = 'com.instagram.android';

function world(over: Partial<World> = {}): World {
  return {
    now: 1_000_000,
    usage: {},
    overrides: {},
    nonDaily: [],
    resetsAt: 1_000_000 + 6 * 60 * MINUTE,
    ...over,
  };
}

const RELAXED: Limit = { packageName: YT, limitSeconds: 15 * 60, strictMode: false };
const STRICT: Limit = { packageName: YT, limitSeconds: 15 * 60, strictMode: true };

describe('who may ignore a limit', () => {
  it('offers the option when the allowance is spent and Strict Mode is off', () => {
    expect(canOverride(RELAXED, YT, world())).toBe(true);
  });

  it('never offers it under Strict Mode', () => {
    // The entire promise of Strict Mode is that this door is not there.
    expect(canOverride(STRICT, YT, world())).toBe(false);
  });

  it('does not offer it while a manual lock covers the same app', () => {
    // The button would appear to work and change nothing.
    expect(canOverride(RELAXED, YT, world({ nonDaily: [YT] }))).toBe(false);
  });

  it('offers it for an app only the daily limit covers', () => {
    expect(canOverride(RELAXED, YT, world({ nonDaily: [IG] }))).toBe(true);
  });
});

describe('an override releases the app, and only for its own window', () => {
  const spent = { [YT]: 20 * 60 };

  it('blocks once the allowance is spent and nothing has been granted', () => {
    expect(blockedPackages([RELAXED], world({ usage: spent }))).toEqual([YT]);
  });

  it('releases the app while the override is live', () => {
    const w = world({ usage: spent, overrides: { [YT]: 1_000_000 + MINUTE } });
    expect(blockedPackages([RELAXED], w)).toEqual([]);
  });

  it('blocks again the moment the override expires', () => {
    // One more minute means one more minute.
    const w = world({ usage: spent, overrides: { [YT]: 1_000_000 } });
    expect(blockedPackages([RELAXED], w)).toEqual([YT]);
  });

  it('ignores an override belonging to a different app', () => {
    const w = world({ usage: spent, overrides: { [IG]: 1_000_000 + MINUTE } });
    expect(blockedPackages([RELAXED], w)).toEqual([YT]);
  });

  it('is overruled by Strict Mode even if an override was stored earlier', () => {
    // Turning Strict Mode on must take effect at once, not at midnight.
    const w = world({ usage: spent, overrides: { [YT]: 1_000_000 + 60 * MINUTE } });
    expect(blockedPackages([STRICT], w)).toEqual([YT]);
  });
});

describe('the four choices', () => {
  const w = world({ usage: { [YT]: 20 * 60 } });

  it('one more minute grants exactly a minute', () => {
    expect(grantUntil('minute', RELAXED, w)).toBe(w.now + MINUTE);
  });

  it('the snooze matches the limit the user configured', () => {
    // A 15-minute limit offers "remind me in 15 minutes"; a 30-minute limit
    // offers 30. The number is theirs, not one we invented.
    expect(grantUntil('snooze', RELAXED, w)).toBe(w.now + 15 * MINUTE);

    const halfHour: Limit = { ...RELAXED, limitSeconds: 30 * 60 };
    expect(grantUntil('snooze', halfHour, w)).toBe(w.now + 30 * MINUTE);
  });

  it('ignoring for today ends at the reset, not for ever', () => {
    // Tomorrow the allowance applies again with nothing to re-enable.
    expect(grantUntil('today', RELAXED, w)).toBe(w.resetsAt);
    expect(grantUntil('today', RELAXED, w)).toBeLessThan(w.now + 24 * 60 * MINUTE);
  });

  it('cancel grants nothing and leaves the app blocked', () => {
    expect(grantUntil('cancel', RELAXED, w)).toBeNull();
    expect(blockedPackages([RELAXED], w)).toEqual([YT]);
  });

  it('every granted window actually releases the app', () => {
    for (const choice of ['minute', 'snooze', 'today'] as const) {
      const until = grantUntil(choice, RELAXED, w);
      expect(until).not.toBeNull();
      const granted = world({ ...w, overrides: { [YT]: until as number } });
      expect(blockedPackages([RELAXED], granted)).toEqual([]);
    }
  });
});

describe('overrides do not leak between days', () => {
  it('an ignore-for-today granted yesterday does not apply now', () => {
    const yesterdayReset = 500_000;
    const w = world({ usage: { [YT]: 20 * 60 }, overrides: { [YT]: yesterdayReset } });

    expect(w.now).toBeGreaterThan(yesterdayReset);
    expect(blockedPackages([RELAXED], w)).toEqual([YT]);
  });
});
