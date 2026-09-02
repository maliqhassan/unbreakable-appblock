import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DURATION_PRESETS,
  FREE_LIMITS,
  MAX_DURATION_MINUTES,
  PRO_LIMITS,
  TIER_LIMITS,
} from '../src/constants/limits';
import { LockService } from '../src/services/LockService';
import { PurchaseService } from '../src/services/PurchaseService';
import { useUserStore } from '../src/store/useUserStore';
import type { SubscriptionState, TargetApp } from '../src/types';
import { LockError } from '../src/utils/errors';

const YOUTUBE: TargetApp = { id: 'com.google.android.youtube', name: 'YouTube' };
const INSTAGRAM: TargetApp = { id: 'com.instagram.android', name: 'Instagram' };

const PRO_STATE: SubscriptionState = {
  tier: 'PRO',
  status: 'active',
  expirationDate: null,
  willRenew: true,
  managementUrl: null,
  isSandbox: false,
  source: 'revenuecat',
};
const FREE_STATE: SubscriptionState = { ...PRO_STATE, tier: 'FREE', status: 'free' };

beforeEach(async () => {
  await AsyncStorage.clear();
  PurchaseService.__resetCache();
  PurchaseService.__setSimulatedPro(false);
  useUserStore.setState({
    subscription: FREE_STATE,
    hydrating: false,
    priceString: null,
    priceState: 'loading',
  });
});

afterEach(() => jest.restoreAllMocks());

describe('the Free plan is limited by apps, not by time', () => {
  it('allows exactly one protected app', () => {
    expect(FREE_LIMITS.maxApps).toBe(1);
  });

  it('imposes no commercial ceiling on duration', () => {
    // The old plan capped Free at 60 minutes. Someone who wants an eight-hour
    // lock on one app is using the product as intended.
    expect(FREE_LIMITS.maxDurationMinutes).toBe(PRO_LIMITS.maxDurationMinutes);
    expect(FREE_LIMITS.maxDurationMinutes).toBe(MAX_DURATION_MINUTES);
  });

  it('lets a Free user pick any preset, including the long ones', () => {
    for (const preset of DURATION_PRESETS) {
      const result = LockService.validateConfiguration(
        [YOUTUBE],
        preset.minutes,
        false,
        'FREE'
      );
      expect(result.valid).toBe(true);
    }
  });

  it('lets a Free user set an eight-hour lock', () => {
    expect(LockService.validateConfiguration([YOUTUBE], 8 * 60, false, 'FREE').valid).toBe(
      true
    );
  });

  it('lets a Free user set a custom duration', () => {
    expect(LockService.validateConfiguration([YOUTUBE], 97, false, 'FREE').valid).toBe(true);
  });

  it('still refuses a second app, and points at the paywall', () => {
    const result = LockService.validateConfiguration([YOUTUBE, INSTAGRAM], 30, false, 'FREE');
    expect(result.valid).toBe(false);
    expect(result.requiresPro).toBe(true);
  });

  it('still refuses Strict Mode', () => {
    const result = LockService.validateConfiguration([YOUTUBE], 30, true, 'FREE');
    expect(result.valid).toBe(false);
    expect(result.requiresPro).toBe(true);
    expect(FREE_LIMITS.strictMode).toBe(false);
  });

  it('still shows ads', () => {
    expect(FREE_LIMITS.ads).toBe(true);
  });

  it('keeps the engine safety ceiling, which is not a plan rule', () => {
    // Beyond a day a "lock" is really a schedule. This bound applies to Pro too.
    expect(LockService.validateConfiguration([YOUTUBE], 25 * 60, false, 'PRO').valid).toBe(
      false
    );
    expect(LockService.validateConfiguration([YOUTUBE], 25 * 60, false, 'FREE').valid).toBe(
      false
    );
  });
});

describe('the Pro plan', () => {
  it('allows several apps, Strict Mode and schedules', () => {
    expect(LockService.validateConfiguration([YOUTUBE, INSTAGRAM], 8 * 60, true, 'PRO').valid).toBe(
      true
    );
    expect(PRO_LIMITS.strictMode).toBe(true);
    expect(PRO_LIMITS.schedules).toBe(true);
  });

  it('shows no ads', () => {
    expect(PRO_LIMITS.ads).toBe(false);
  });

  it('keeps one authoritative limits table', () => {
    expect(TIER_LIMITS.FREE).toBe(FREE_LIMITS);
    expect(TIER_LIMITS.PRO).toBe(PRO_LIMITS);
  });
});

describe('ads follow the tier, from one rule', () => {
  it('serves ads to Free and never to Pro', () => {
    // `showAds` in useSubscription is just `limits.ads`, so no screen decides
    // this for itself.
    expect(TIER_LIMITS.FREE.ads).toBe(true);
    expect(TIER_LIMITS.PRO.ads).toBe(false);
  });
});

describe('pricing comes from the store, never from the app', () => {
  it('reports no price when billing is not configured', async () => {
    // Null, not a placeholder. A hardcoded figure could differ from the Play
    // checkout sheet, which is worse than showing nothing.
    expect(await PurchaseService.getMonthlyPrice()).toBeNull();
  });

  it('starts in a loading state rather than showing a guess', () => {
    expect(useUserStore.getState().priceString).toBeNull();
    expect(useUserStore.getState().priceState).toBe('loading');
  });

  it('settles to unavailable when the store returns no product', async () => {
    jest.spyOn(PurchaseService, 'getMonthlyPrice').mockResolvedValue(null);
    jest.spyOn(PurchaseService, 'getCustomerInfo').mockResolvedValue(FREE_STATE);

    await useUserStore.getState().hydrate();

    expect(useUserStore.getState().priceState).toBe('unavailable');
    expect(useUserStore.getState().priceString).toBeNull();
  });

  it('uses the store string verbatim, in whatever currency it arrives', async () => {
    // The app applies no conversion and no formatting of its own: whatever
    // Google Play says for this customer's region is what is shown.
    for (const storePrice of ['$2.99', '€2,79', '£2.49', 'Rs 850.00', '¥400']) {
      jest.spyOn(PurchaseService, 'getMonthlyPrice').mockResolvedValue(storePrice);
      jest.spyOn(PurchaseService, 'getCustomerInfo').mockResolvedValue(FREE_STATE);

      await useUserStore.getState().hydrate();

      expect(useUserStore.getState().priceString).toBe(storePrice);
      expect(useUserStore.getState().priceState).toBe('ready');
    }
  });
});

describe('purchase outcomes', () => {
  it('unlocks Pro on success and updates without a restart', async () => {
    jest.spyOn(PurchaseService, 'purchasePro').mockResolvedValue(PRO_STATE);

    const state = await useUserStore.getState().purchasePro();

    expect(state.tier).toBe('PRO');
    expect(useUserStore.getState().subscription.tier).toBe('PRO');
  });

  it('reports cancellation with its own code, not as a failure', async () => {
    jest
      .spyOn(PurchaseService, 'purchasePro')
      .mockRejectedValue(new LockError('PURCHASE_CANCELLED', 'The purchase was cancelled.'));

    await expect(useUserStore.getState().purchasePro()).rejects.toMatchObject({
      code: 'PURCHASE_CANCELLED',
    });
    expect(useUserStore.getState().subscription.tier).toBe('FREE');
  });

  it('reports a real failure distinctly from a cancellation', async () => {
    jest
      .spyOn(PurchaseService, 'purchasePro')
      .mockRejectedValue(new LockError('PURCHASE_FAILED', 'Card declined.'));

    await expect(useUserStore.getState().purchasePro()).rejects.toMatchObject({
      code: 'PURCHASE_FAILED',
    });
  });

  it('reports the store being unavailable', async () => {
    jest
      .spyOn(PurchaseService, 'purchasePro')
      .mockRejectedValue(new LockError('BILLING_UNAVAILABLE', 'Play is unavailable.'));

    await expect(useUserStore.getState().purchasePro()).rejects.toMatchObject({
      code: 'BILLING_UNAVAILABLE',
    });
  });

  it('restores an existing subscription', async () => {
    jest.spyOn(PurchaseService, 'restorePurchases').mockResolvedValue(PRO_STATE);

    expect((await useUserStore.getState().restorePurchases()).tier).toBe('PRO');
  });

  it('stays Free when there is nothing to restore', async () => {
    jest.spyOn(PurchaseService, 'restorePurchases').mockResolvedValue(FREE_STATE);

    expect((await useUserStore.getState().restorePurchases()).tier).toBe('FREE');
  });
});

describe('entitlement authority', () => {
  it('keeps Pro when the entitlement cannot be refreshed', async () => {
    useUserStore.setState({ subscription: PRO_STATE });
    jest
      .spyOn(PurchaseService, 'getCustomerInfo')
      .mockRejectedValue(new Error('offline'));

    await useUserStore.getState().refreshEntitlement();

    // A dropped request is not evidence of a cancelled subscription.
    expect(useUserStore.getState().subscription.tier).toBe('PRO');
  });

  it('never manufactures Pro from an unknown state', async () => {
    jest
      .spyOn(PurchaseService, 'getCustomerInfo')
      .mockResolvedValue({ ...FREE_STATE, status: 'unknown', source: 'cache' });

    await useUserStore.getState().refreshEntitlement();

    expect(useUserStore.getState().subscription.tier).toBe('FREE');
  });
});
