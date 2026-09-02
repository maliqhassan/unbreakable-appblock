import { LockService } from '../src/services/LockService';
import type { TargetApp } from '../src/types';

const app = (id: string): TargetApp => ({ id, name: id });

const ONE_APP = [app('com.google.android.youtube')];
const TWO_APPS = [app('com.google.android.youtube'), app('com.instagram.android')];

describe('lock configuration validation', () => {
  it('accepts one app and a short duration on the free tier', () => {
    const result = LockService.validateConfiguration(ONE_APP, 30, false, 'FREE');
    expect(result.valid).toBe(true);
  });

  it('stops a free user selecting two apps, and points at the paywall', () => {
    const result = LockService.validateConfiguration(TWO_APPS, 30, false, 'FREE');

    expect(result.valid).toBe(false);
    // requiresPro is what makes the UI show a paywall instead of an error.
    expect(result.requiresPro).toBe(true);
  });

  it('lets a free user pick any duration for their one app', () => {
    // The 60-minute Free cap was removed as a product decision: the plan limits
    // app count, not session length.
    expect(LockService.validateConfiguration(ONE_APP, 60, false, 'FREE').valid).toBe(true);
    expect(LockService.validateConfiguration(ONE_APP, 61, false, 'FREE').valid).toBe(true);
    expect(LockService.validateConfiguration(ONE_APP, 12 * 60, false, 'FREE').valid).toBe(
      true
    );
  });

  it('stops a free user turning on Strict Mode', () => {
    const result = LockService.validateConfiguration(ONE_APP, 30, true, 'FREE');
    expect(result.valid).toBe(false);
    expect(result.requiresPro).toBe(true);
  });

  it('lets a Pro user select multiple apps, lock for longer, and use Strict Mode', () => {
    expect(LockService.validateConfiguration(TWO_APPS, 30, false, 'PRO').valid).toBe(true);
    expect(LockService.validateConfiguration(TWO_APPS, 8 * 60, true, 'PRO').valid).toBe(true);
  });

  it('rejects an empty selection for either tier', () => {
    for (const tier of ['FREE', 'PRO'] as const) {
      const result = LockService.validateConfiguration([], 30, false, tier);
      expect(result.valid).toBe(false);
      // Not a paywall — there is nothing Pro would fix here.
      expect(result.requiresPro).toBeUndefined();
    }
  });

  it('rejects durations outside the absolute bounds even for Pro', () => {
    expect(LockService.validateConfiguration(ONE_APP, 1, false, 'PRO').valid).toBe(false);
    expect(LockService.validateConfiguration(ONE_APP, 25 * 60, false, 'PRO').valid).toBe(false);
  });
});
