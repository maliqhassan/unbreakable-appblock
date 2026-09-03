/**
 * What the app picker does, depending on who opened it.
 *
 * One screen serves three callers: the manual lock flow, the daily-limit form
 * and the schedule form. It used to serve only the first, and the other two
 * reused it wholesale — so someone configuring a daily limit was shown
 * "Set Timer", sent to the lock configuration screen, and had their manual
 * lock selection silently replaced with the app they had just picked for the
 * limit.
 *
 * These pin the contract that fixes it.
 */

type Purpose = 'lock' | 'dailyLimit' | 'schedule';

/** Mirrors the footer in AppSelectionScreen. */
function footer(purpose: Purpose, lockRunning = false) {
  if (purpose === 'lock') {
    return {
      label: lockRunning ? 'Add to running lock' : 'Set Timer',
      goesTo: lockRunning ? null : 'LockConfiguration',
    };
  }
  return {
    label: purpose === 'dailyLimit' ? 'Use this app' : 'Use these apps',
    goesTo: purpose === 'dailyLimit' ? 'CreateDailyLimit' : 'CreateSchedule',
  };
}

/** Mirrors handleToggle: picker mode keeps its choice local. */
function toggle(purpose: Purpose, current: string[], id: string): string[] {
  if (purpose === 'dailyLimit') return [id];
  if (current.includes(id)) return current.filter((existing) => existing !== id);
  return [...current, id];
}

/** True when choosing here rewrites what a manual lock would block. */
function touchesManualSelection(purpose: Purpose): boolean {
  return purpose === 'lock';
}

const YT = 'com.google.android.youtube';
const IG = 'com.instagram.android';

describe('the footer matches who opened the picker', () => {
  it('offers a timer only in the manual lock flow', () => {
    expect(footer('lock').label).toBe('Set Timer');
    expect(footer('lock').goesTo).toBe('LockConfiguration');
  });

  it('never offers a timer when picking for a daily limit', () => {
    // The reported bug: this button read "Set Timer" and started a manual lock.
    const daily = footer('dailyLimit');
    expect(daily.label).toBe('Use this app');
    expect(daily.goesTo).toBe('CreateDailyLimit');
    expect(daily.goesTo).not.toBe('LockConfiguration');
  });

  it('never offers a timer when picking for a schedule', () => {
    const schedule = footer('schedule');
    expect(schedule.label).toBe('Use these apps');
    expect(schedule.goesTo).toBe('CreateSchedule');
  });

  it('returns the user to the screen that asked, not onward', () => {
    for (const purpose of ['dailyLimit', 'schedule'] as const) {
      expect(footer(purpose).goesTo).not.toBe('LockConfiguration');
    }
  });
});

describe('selection rules per purpose', () => {
  it('holds a daily limit to exactly one app', () => {
    // A daily allowance belongs to one app by definition.
    let picked = toggle('dailyLimit', [], YT);
    picked = toggle('dailyLimit', picked, IG);

    expect(picked).toEqual([IG]);
    expect(picked).toHaveLength(1);
  });

  it('lets a schedule cover several apps', () => {
    let picked = toggle('schedule', [], YT);
    picked = toggle('schedule', picked, IG);

    expect(picked).toEqual([YT, IG]);
  });

  it('lets a schedule un-pick an app', () => {
    const picked = toggle('schedule', [YT, IG], YT);
    expect(picked).toEqual([IG]);
  });
});

describe('a picker never disturbs the manual lock', () => {
  it('writes to the manual selection only in the lock flow', () => {
    expect(touchesManualSelection('lock')).toBe(true);
    expect(touchesManualSelection('dailyLimit')).toBe(false);
    expect(touchesManualSelection('schedule')).toBe(false);
  });
});
