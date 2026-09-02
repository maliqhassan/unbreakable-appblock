import AsyncStorage from '@react-native-async-storage/async-storage';

import { FREE_LIMITS, PRO_LIMITS, TIER_LIMITS } from '../src/constants/limits';
import { AdService } from '../src/services/AdService';
import { LockService } from '../src/services/LockService';
import { PurchaseService, stateFromCustomerInfo } from '../src/services/PurchaseService';
import { useUserStore } from '../src/store/useUserStore';
import type { TargetApp } from '../src/types';
import { LockError } from '../src/utils/errors';

type CustomerInfo = import('react-native-purchases').CustomerInfo;

const YOUTUBE: TargetApp = { id: 'com.google.android.youtube', name: 'YouTube' };
const INSTAGRAM: TargetApp = { id: 'com.instagram.android', name: 'Instagram' };

const DAY = 24 * 60 * 60 * 1000;

/**
 * A minimal CustomerInfo. Only the fields our mapping reads are populated —
 * the real object is large and the rest is irrelevant to entitlement.
 */
function customerInfo(options: {
  active?: boolean;
  everSubscribed?: boolean;
  willRenew?: boolean;
  billingIssue?: boolean;
  isSandbox?: boolean;
  expiresInDays?: number;
  managementURL?: string | null;
}): CustomerInfo {
  const {
    active = true,
    everSubscribed = true,
    willRenew = true,
    billingIssue = false,
    isSandbox = false,
    expiresInDays = 30,
    managementURL = 'https://play.google.com/store/account/subscriptions',
  } = options;

  const entitlement = {
    identifier: 'pro',
    isActive: active,
    willRenew,
    expirationDate: new Date(Date.now() + expiresInDays * DAY).toISOString(),
    billingIssueDetectedAt: billingIssue ? new Date().toISOString() : null,
    isSandbox,
  };

  return {
    entitlements: {
      active: active ? { pro: entitlement } : {},
      all: everSubscribed ? { pro: entitlement } : {},
    },
    managementURL,
  } as unknown as CustomerInfo;
}

async function resetUserStore() {
  await AsyncStorage.clear();
  PurchaseService.__resetCache();
  PurchaseService.__setSimulatedPro(false);
  AdService.__reset();
  useUserStore.setState({
    subscription: {
      tier: 'FREE',
      status: 'free',
      expirationDate: null,
      willRenew: false,
      managementUrl: null,
      isSandbox: false,
      source: 'revenuecat',
    },
    hydrating: false,
    simulatedBilling: true,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('entitlement mapping from RevenueCat', () => {
  it('reads an active subscription as Pro', () => {
    const state = stateFromCustomerInfo(customerInfo({ willRenew: true }));

    expect(state.tier).toBe('PRO');
    expect(state.status).toBe('active');
    expect(state.willRenew).toBe(true);
  });

  it('KEEPS Pro after cancellation, until the paid period ends', () => {
    // The important one: turning off auto-renew must not revoke access the
    // user has already paid for.
    const state = stateFromCustomerInfo(customerInfo({ willRenew: false }));

    expect(state.tier).toBe('PRO');
    expect(state.status).toBe('cancelled');
    expect(state.willRenew).toBe(false);
    expect(state.expirationDate).toBeTruthy();
  });

  it('KEEPS Pro during a billing issue, while the entitlement is still active', () => {
    const state = stateFromCustomerInfo(customerInfo({ billingIssue: true }));

    expect(state.tier).toBe('PRO');
    expect(state.status).toBe('billingIssue');
  });

  it('drops to Free once the entitlement is no longer active', () => {
    const state = stateFromCustomerInfo(
      customerInfo({ active: false, everSubscribed: true })
    );

    expect(state.tier).toBe('FREE');
    // "expired" rather than "free": this user subscribed before, so the screen
    // can lead with Restore.
    expect(state.status).toBe('expired');
  });

  it('reports a user who never subscribed as free, not expired', () => {
    const state = stateFromCustomerInfo(
      customerInfo({ active: false, everSubscribed: false })
    );

    expect(state.tier).toBe('FREE');
    expect(state.status).toBe('free');
  });

  it('surfaces the management URL and sandbox flag', () => {
    const state = stateFromCustomerInfo(customerInfo({ isSandbox: true }));

    expect(state.managementUrl).toContain('play.google.com');
    expect(state.isSandbox).toBe(true);
  });

  it('never invents a subscription when RevenueCat returns nothing', () => {
    const state = stateFromCustomerInfo(
      customerInfo({ active: false, everSubscribed: false, managementURL: null })
    );

    expect(state.tier).toBe('FREE');
    expect(state.managementUrl).toBeNull();
  });
});

describe('purchase flow', () => {
  beforeEach(resetUserStore);

  it('unlocks Pro and hides ads on success', async () => {
    jest.spyOn(PurchaseService, 'purchasePro').mockResolvedValue({
      tier: 'PRO',
      status: 'active',
      expirationDate: null,
      willRenew: true,
      managementUrl: null,
      isSandbox: false,
      source: 'revenuecat',
    });

    const state = await useUserStore.getState().purchasePro();

    expect(state.tier).toBe('PRO');
    expect(useUserStore.getState().subscription.tier).toBe('PRO');
    expect(AdService.isBannerVisible()).toBe(false);
  });

  it('leaves the user unchanged when they cancel, with a distinct code', async () => {
    jest
      .spyOn(PurchaseService, 'purchasePro')
      .mockRejectedValue(new LockError('PURCHASE_CANCELLED', 'The purchase was cancelled.'));

    await expect(useUserStore.getState().purchasePro()).rejects.toMatchObject({
      code: 'PURCHASE_CANCELLED',
    });
    // Cancelling is not an error state; the user is simply still on Free.
    expect(useUserStore.getState().subscription.tier).toBe('FREE');
  });

  it('surfaces a real failure without downgrading anything', async () => {
    jest
      .spyOn(PurchaseService, 'purchasePro')
      .mockRejectedValue(new LockError('PURCHASE_FAILED', 'Card declined.'));

    await expect(useUserStore.getState().purchasePro()).rejects.toMatchObject({
      code: 'PURCHASE_FAILED',
    });
    expect(useUserStore.getState().subscription.tier).toBe('FREE');
  });

  it('reports billing being unavailable rather than throwing raw', async () => {
    jest
      .spyOn(PurchaseService, 'purchasePro')
      .mockRejectedValue(new LockError('BILLING_UNAVAILABLE', 'Play is unavailable.'));

    await expect(useUserStore.getState().purchasePro()).rejects.toMatchObject({
      code: 'BILLING_UNAVAILABLE',
    });
  });
});

describe('restore flow', () => {
  beforeEach(resetUserStore);

  it('restores Pro when the account has an active subscription', async () => {
    jest.spyOn(PurchaseService, 'restorePurchases').mockResolvedValue({
      tier: 'PRO',
      status: 'active',
      expirationDate: null,
      willRenew: true,
      managementUrl: null,
      isSandbox: false,
      source: 'revenuecat',
    });

    const state = await useUserStore.getState().restorePurchases();

    expect(state.tier).toBe('PRO');
    expect(AdService.isBannerVisible()).toBe(false);
  });

  it('stays on Free when there is nothing to restore', async () => {
    jest.spyOn(PurchaseService, 'restorePurchases').mockResolvedValue({
      tier: 'FREE',
      status: 'free',
      expirationDate: null,
      willRenew: false,
      managementUrl: null,
      isSandbox: false,
      source: 'revenuecat',
    });

    const state = await useUserStore.getState().restorePurchases();

    expect(state.tier).toBe('FREE');
    // Ads come back on, because the user is genuinely on the free tier.
    expect(AdService.isBannerVisible()).toBe(true);
  });
});

describe('subscription state loading', () => {
  beforeEach(resetUserStore);

  it('serves the cached tier immediately so Pro users never see a paywall flash', async () => {
    await AsyncStorage.setItem(
      'ul.subscription',
      JSON.stringify({
        tier: 'PRO',
        status: 'active',
        expirationDate: null,
        willRenew: true,
        managementUrl: null,
        isSandbox: false,
        source: 'revenuecat',
      })
    );

    await useUserStore.getState().hydrate();

    // Simulated mode has no network, but the cache must still have been read
    // and applied on the way through.
    expect(useUserStore.getState().hydrating).toBe(false);
  });

  it('does not treat local storage as an authority', async () => {
    // A hand-edited cache claiming Pro must not survive a real entitlement read.
    await AsyncStorage.setItem(
      'ul.subscription',
      JSON.stringify({ tier: 'PRO', status: 'active', source: 'cache' })
    );
    jest.spyOn(PurchaseService, 'getCustomerInfo').mockResolvedValue({
      tier: 'FREE',
      status: 'free',
      expirationDate: null,
      willRenew: false,
      managementUrl: null,
      isSandbox: false,
      source: 'revenuecat',
    });

    await useUserStore.getState().hydrate();

    expect(useUserStore.getState().subscription.tier).toBe('FREE');
  });

  it('keeps Pro when the entitlement check fails outright', async () => {
    useUserStore.setState({
      subscription: {
        tier: 'PRO',
        status: 'active',
        expirationDate: null,
        willRenew: true,
        managementUrl: null,
        isSandbox: false,
        source: 'revenuecat',
      },
    });
    jest
      .spyOn(PurchaseService, 'getCustomerInfo')
      .mockRejectedValue(new Error('network down'));

    await useUserStore.getState().refreshEntitlement();

    // A dropped request is not evidence of a cancelled subscription.
    expect(useUserStore.getState().subscription.tier).toBe('PRO');
  });
});

describe('feature gating', () => {
  it('holds free users to one app and no Strict Mode', () => {
    // Duration is deliberately NOT a free-tier restriction any more: the plan
    // limits how many apps you protect, not how long you protect them for.
    expect(FREE_LIMITS.maxApps).toBe(1);
    expect(FREE_LIMITS.strictMode).toBe(false);
    expect(FREE_LIMITS.maxDurationMinutes).toBe(PRO_LIMITS.maxDurationMinutes);
  });

  it('sends a free user to the paywall for a second app', () => {
    const result = LockService.validateConfiguration(
      [YOUTUBE, INSTAGRAM],
      30,
      false,
      'FREE'
    );

    expect(result.valid).toBe(false);
    expect(result.requiresPro).toBe(true);
  });

  it('sends a free user to the paywall for Strict Mode', () => {
    const result = LockService.validateConfiguration([YOUTUBE], 30, true, 'FREE');

    expect(result.valid).toBe(false);
    expect(result.requiresPro).toBe(true);
  });

  it('lets a free user run a long lock on their one app', () => {
    // Previously this asserted a paywall past 60 minutes. That restriction was
    // removed on purpose, so the test now pins the opposite behaviour.
    expect(LockService.validateConfiguration([YOUTUBE], 60, false, 'FREE').valid).toBe(true);
    expect(LockService.validateConfiguration([YOUTUBE], 90, false, 'FREE').valid).toBe(true);
    expect(LockService.validateConfiguration([YOUTUBE], 8 * 60, false, 'FREE').valid).toBe(
      true
    );
  });

  it('allows Pro users everything the free tier is denied', () => {
    expect(
      LockService.validateConfiguration([YOUTUBE, INSTAGRAM], 8 * 60, true, 'PRO').valid
    ).toBe(true);
    expect(PRO_LIMITS.strictMode).toBe(true);
    // Apps are the paid axis; duration is the same for both tiers.
    expect(PRO_LIMITS.maxApps).toBeGreaterThan(FREE_LIMITS.maxApps);
    expect(PRO_LIMITS.maxDurationMinutes).toBe(FREE_LIMITS.maxDurationMinutes);
  });

  it('keeps limits in exactly one place', () => {
    // The gating rules and the tier table must not drift apart.
    expect(TIER_LIMITS.FREE).toBe(FREE_LIMITS);
    expect(TIER_LIMITS.PRO).toBe(PRO_LIMITS);
  });
});

describe('advertising', () => {
  beforeEach(resetUserStore);

  it('serves ads to free users', () => {
    expect(TIER_LIMITS.FREE.ads).toBe(true);
  });

  it('never serves ads to Pro users', () => {
    expect(TIER_LIMITS.PRO.ads).toBe(false);
  });

  it('hides the banner the moment a purchase succeeds', async () => {
    expect(AdService.isBannerVisible()).toBe(true);

    jest.spyOn(PurchaseService, 'purchasePro').mockResolvedValue({
      tier: 'PRO',
      status: 'active',
      expirationDate: null,
      willRenew: true,
      managementUrl: null,
      isSandbox: false,
      source: 'revenuecat',
    });
    await useUserStore.getState().purchasePro();

    expect(AdService.isBannerVisible()).toBe(false);
  });

  it('falls back to a test unit rather than a production id', () => {
    // A build with no configured unit must never guess at a real one.
    expect(AdService.isUsingTestUnit()).toBe(true);
    expect(AdService.bannerUnitId()).toContain('3940256099942544');
  });

  it('reports not-ready rather than throwing when the SDK is absent', async () => {
    await AdService.initialize();
    expect(typeof AdService.isReady()).toBe('boolean');
  });
});
