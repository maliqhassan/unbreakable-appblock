import type { EffectiveLockState, LockSource } from '../src/types';

/**
 * The union rules that merge every lock source.
 *
 * This is a JS model of `EffectiveLock.kt`, which is where the real merge
 * happens. Native cannot be exercised from Jest, so these tests pin the
 * *contract* the Kotlin implements: which combinations lock, and — the part
 * that actually bites — which removals must NOT unlock.
 */

interface SourceState {
  active: boolean;
  packages: string[];
  strictMode?: boolean;
  /** Epoch ms this source stops covering its apps. */
  endsAt?: number;
}

interface Sources {
  manual?: SourceState;
  schedule?: SourceState;
  daily?: SourceState;
}

/**
 * Mirrors EffectiveLock.read().
 *
 * Union of packages, strictest mode wins, latest end wins — chosen so an
 * overlap can never weaken protection.
 */
function merge(sources: Sources): EffectiveLockState {
  const entries: [LockSource, SourceState | undefined][] = [
    ['manual', sources.manual],
    ['schedule', sources.schedule],
    ['daily_usage', sources.daily],
  ];

  const packages = new Set<string>();
  const active: LockSource[] = [];
  let strictMode = false;
  let endTimestamp = 0;

  for (const [name, state] of entries) {
    if (!state?.active) continue;
    for (const pkg of state.packages) packages.add(pkg);
    if (state.strictMode) strictMode = true;
    if (state.endsAt && state.endsAt > endTimestamp) endTimestamp = state.endsAt;
    active.push(name);
  }

  return {
    active: active.length > 0,
    packages: Array.from(packages).sort(),
    strictMode,
    endTimestamp,
    sources: active,
  };
}

const YOUTUBE = 'com.google.android.youtube';
const INSTAGRAM = 'com.instagram.android';

const on = (packages: string[], extra: Partial<SourceState> = {}): SourceState => ({
  active: true,
  packages,
  ...extra,
});
const off: SourceState = { active: false, packages: [] };

describe('every source combination', () => {
  it('A: nothing active leaves everything unlocked', () => {
    const state = merge({ manual: off, schedule: off, daily: off });
    expect(state.active).toBe(false);
    expect(state.packages).toEqual([]);
  });

  it('B: manual alone locks', () => {
    const state = merge({ manual: on([YOUTUBE]), schedule: off, daily: off });
    expect(state.active).toBe(true);
    expect(state.sources).toEqual(['manual']);
  });

  it('C: schedule alone locks', () => {
    const state = merge({ manual: off, schedule: on([YOUTUBE]), daily: off });
    expect(state.active).toBe(true);
    expect(state.sources).toEqual(['schedule']);
  });

  it('D: an exhausted daily limit alone locks', () => {
    const state = merge({ manual: off, schedule: off, daily: on([YOUTUBE]) });
    expect(state.active).toBe(true);
    expect(state.sources).toEqual(['daily_usage']);
  });

  it('E: all three together lock, and report all three', () => {
    const state = merge({
      manual: on([YOUTUBE]),
      schedule: on([INSTAGRAM]),
      daily: on([YOUTUBE]),
    });

    expect(state.active).toBe(true);
    expect(state.sources).toEqual(['manual', 'schedule', 'daily_usage']);
    expect(state.packages).toEqual([INSTAGRAM, YOUTUBE].sort());
  });
});

describe('removing one source never releases another', () => {
  it('a manual lock ending leaves a daily-exhausted app locked', () => {
    const before = merge({ manual: on([YOUTUBE]), daily: on([YOUTUBE]) });
    expect(before.active).toBe(true);

    // Manual ends. The daily allowance is still spent.
    const after = merge({ manual: off, daily: on([YOUTUBE]) });
    expect(after.active).toBe(true);
    expect(after.packages).toEqual([YOUTUBE]);
    expect(after.sources).toEqual(['daily_usage']);
  });

  it('a daily reset leaves a manual lock running', () => {
    const after = merge({ manual: on([YOUTUBE]), daily: off });
    expect(after.active).toBe(true);
    expect(after.sources).toEqual(['manual']);
  });

  it('a schedule ending leaves a daily-exhausted app locked', () => {
    const after = merge({ schedule: off, daily: on([YOUTUBE]) });
    expect(after.active).toBe(true);
    expect(after.sources).toEqual(['daily_usage']);
  });

  it('a daily reset leaves a running schedule alone', () => {
    const after = merge({ schedule: on([YOUTUBE]), daily: off });
    expect(after.active).toBe(true);
    expect(after.sources).toEqual(['schedule']);
  });

  it('only unlocks once the last source is gone', () => {
    expect(merge({ manual: off, schedule: off, daily: off }).active).toBe(false);
  });

  it('releases only the apps no remaining source covers', () => {
    // Manual covers YouTube, daily covers Instagram. Manual ends.
    const after = merge({ manual: off, daily: on([INSTAGRAM]) });
    expect(after.packages).toEqual([INSTAGRAM]);
  });
});

describe('merge rules cannot weaken protection', () => {
  it('takes the union of apps', () => {
    const state = merge({
      manual: on([YOUTUBE]),
      daily: on([INSTAGRAM]),
    });
    expect(state.packages).toEqual([INSTAGRAM, YOUTUBE].sort());
  });

  it('turns Strict Mode on if any source wants it', () => {
    expect(merge({ manual: on([YOUTUBE]), daily: on([YOUTUBE], { strictMode: true }) }).strictMode).toBe(
      true
    );
    expect(merge({ manual: on([YOUTUBE], { strictMode: true }), daily: off }).strictMode).toBe(
      true
    );
    expect(merge({ manual: on([YOUTUBE]), daily: on([YOUTUBE]) }).strictMode).toBe(false);
  });

  it('takes the latest end, so a short source ending unlocks nothing', () => {
    const soon = 1_000;
    const later = 9_000;

    const state = merge({
      manual: on([YOUTUBE], { endsAt: soon }),
      daily: on([YOUTUBE], { endsAt: later }),
    });

    expect(state.endTimestamp).toBe(later);
  });

  it('disabling a daily limit removes only that source', () => {
    // Disabling must not touch manual or schedule contributions.
    const state = merge({
      manual: on([YOUTUBE]),
      schedule: on([INSTAGRAM]),
      daily: off,
    });

    expect(state.sources).toEqual(['manual', 'schedule']);
    expect(state.packages).toEqual([INSTAGRAM, YOUTUBE].sort());
  });
});

describe('one exhausted app never locks a different one', () => {
  it('keeps unrelated apps free', () => {
    const state = merge({ daily: on([YOUTUBE]) });
    expect(state.packages).toEqual([YOUTUBE]);
    expect(state.packages).not.toContain(INSTAGRAM);
  });
});
