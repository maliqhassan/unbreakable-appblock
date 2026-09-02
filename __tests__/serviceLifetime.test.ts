/**
 * When the enforcement service may stop.
 *
 * A JS model of the three places `LockForegroundService.kt` decides to shut
 * down — `onStartCommand`, `pollOnce` and `expiryRunnable`. Native cannot be
 * exercised from Jest, so these tests pin the *contract* the Kotlin implements.
 *
 * This exists because of a real bug. Daily limits were added, two of the three
 * shutdown paths learned about them, and the third did not: `expiryRunnable`
 * asked only "is a lock active?". While watching a daily limit that has not
 * been reached, nothing is locked — so the service killed itself 250ms after
 * starting and daily limits were never enforced at all, unless a manual lock
 * happened to be running at the same time.
 *
 * The rule the three must share is below.
 */

interface Runtime {
  /** Something is locked right now (manual, schedule, or a spent allowance). */
  lockActive: boolean;
  /** At least one enabled daily limit exists, reached or not. */
  hasEnabledLimits: boolean;
  /** ms until the last active source ends; 0 when nothing is locked. */
  remainingMs: number;
}

/**
 * The single predicate. The service exists to do two jobs — block what is
 * locked, and measure usage towards limits that are not locked yet — so it
 * must keep running while *either* is outstanding.
 */
function serviceShouldRun(r: Runtime): boolean {
  return r.lockActive || r.hasEnabledLimits;
}

/** `onStartCommand`: refuse to start when there is nothing to do. */
function startsUp(r: Runtime): boolean {
  return serviceShouldRun(r);
}

/** `pollOnce`: finish the session when there is nothing left to do. */
function keepsPolling(r: Runtime): boolean {
  return serviceShouldRun(r);
}

/** `expiryRunnable`: fires at the deadline and decides whether to shut down. */
function survivesExpiryCheck(r: Runtime): boolean {
  return serviceShouldRun(r);
}

/** `scheduleExactExpiry`: only a real deadline is worth a timer. */
function schedulesExpiryTimer(r: Runtime): boolean {
  return r.remainingMs > 0;
}

const WATCHING_ONLY: Runtime = {
  lockActive: false,
  hasEnabledLimits: true,
  remainingMs: 0,
};
const LOCKED: Runtime = { lockActive: true, hasEnabledLimits: false, remainingMs: 60_000 };
const LIMIT_REACHED: Runtime = {
  lockActive: true,
  hasEnabledLimits: true,
  remainingMs: 3_600_000,
};
const NOTHING: Runtime = { lockActive: false, hasEnabledLimits: false, remainingMs: 0 };

describe('the service runs while a daily limit is only being watched', () => {
  it('starts up with limits configured and nothing locked yet', () => {
    // Daily limits are unlike the other sources: the service has to be running
    // *before* anything is locked, because it is what notices the threshold
    // being crossed.
    expect(startsUp(WATCHING_ONLY)).toBe(true);
  });

  it('keeps polling while watching', () => {
    expect(keepsPolling(WATCHING_ONLY)).toBe(true);
  });

  it('survives the expiry check while watching', () => {
    // The regression. `lockActive` alone is false here, and a check that asked
    // only that question shut the watcher down a quarter of a second after it
    // started.
    expect(survivesExpiryCheck(WATCHING_ONLY)).toBe(true);
  });

  it('sets no expiry timer when nothing is locked', () => {
    // remainingMs is 0 while watching, and `0 + 250ms` is not a deadline — it
    // is an instruction to reconsider shutting down almost immediately.
    expect(schedulesExpiryTimer(WATCHING_ONLY)).toBe(false);
  });
});

describe('all three shutdown paths agree', () => {
  const CASES: [string, Runtime][] = [
    ['watching only', WATCHING_ONLY],
    ['locked, no limits', LOCKED],
    ['limit reached', LIMIT_REACHED],
    ['nothing configured', NOTHING],
  ];

  it.each(CASES)('startup, polling and expiry make the same call: %s', (_name, runtime) => {
    // The bug was three checks that disagreed, not a check that was wrong in
    // isolation. Whatever the rule becomes, they have to move together.
    const decisions = [
      startsUp(runtime),
      keepsPolling(runtime),
      survivesExpiryCheck(runtime),
    ];

    expect(new Set(decisions).size).toBe(1);
  });
});

describe('the service still stops when it genuinely has nothing to do', () => {
  it('does not start with no lock and no limits', () => {
    // The fix must not turn into "always run": that would be a permanent
    // foreground service and a battery complaint.
    expect(startsUp(NOTHING)).toBe(false);
    expect(keepsPolling(NOTHING)).toBe(false);
    expect(survivesExpiryCheck(NOTHING)).toBe(false);
  });

  it('stops once the last limit is deleted', () => {
    expect(serviceShouldRun({ ...WATCHING_ONLY, hasEnabledLimits: false })).toBe(false);
  });

  it('keeps running for a spent allowance even after a manual lock ends', () => {
    // The allowance lasts until midnight; a manual lock ending must not release
    // an app the daily limit still covers.
    expect(serviceShouldRun(LIMIT_REACHED)).toBe(true);
  });

  it('keeps a real deadline scheduled', () => {
    expect(schedulesExpiryTimer(LOCKED)).toBe(true);
    expect(schedulesExpiryTimer(LIMIT_REACHED)).toBe(true);
  });
});
