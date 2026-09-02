import { useCallback } from 'react';

import { TIER_LIMITS, type TierLimits } from '../constants/limits';
import { useUserStore } from '../store/useUserStore';
import type { SubscriptionState, SubscriptionStatus, SubscriptionTier } from '../types';

export interface UseSubscription {
  isPro: boolean;
  isLoading: boolean;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  /** The full entitlement detail, for the subscription screen. */
  subscription: SubscriptionState;
  /** What this tier is allowed to do. Never re-derive these in a screen. */
  limits: TierLimits;
  /** True when ads should be served to this user. */
  showAds: boolean;
  /** True when no real billing is configured (development builds). */
  isSimulated: boolean;
  /**
   * The store's localized price for THIS customer, e.g. "$2.99", "€2,79".
   * Null when unknown — render `priceState`, never a fallback figure.
   */
  priceString: string | null;
  priceState: 'loading' | 'ready' | 'unavailable';

  purchasePro: () => Promise<SubscriptionState>;
  restorePurchases: () => Promise<SubscriptionState>;
  refresh: () => Promise<SubscriptionState>;
}

/**
 * The one way the app asks about entitlements.
 *
 * Screens use this rather than touching RevenueCat, `PurchaseService`, or the
 * store directly. That keeps the "is this user Pro?" question answerable in
 * exactly one place, which is what makes it safe to change the billing provider
 * or add user accounts later without auditing every screen.
 *
 * `isLoading` is true only until the first entitlement check settles. It never
 * blocks the UI: the cached tier is served immediately, so a paying user does
 * not see a paywall flash while the network round-trip completes.
 */
export function useSubscription(): UseSubscription {
  const subscription = useUserStore((s) => s.subscription);
  const hydrating = useUserStore((s) => s.hydrating);
  const simulatedBilling = useUserStore((s) => s.simulatedBilling);
  const priceString = useUserStore((s) => s.priceString);
  const priceState = useUserStore((s) => s.priceState);

  const purchase = useUserStore((s) => s.purchasePro);
  const restore = useUserStore((s) => s.restorePurchases);
  const refreshEntitlement = useUserStore((s) => s.refreshEntitlement);

  const purchasePro = useCallback(() => purchase(), [purchase]);
  const restorePurchases = useCallback(() => restore(), [restore]);
  const refresh = useCallback(() => refreshEntitlement(), [refreshEntitlement]);

  const isPro = subscription.tier === 'PRO';
  const limits = TIER_LIMITS[subscription.tier];

  return {
    isPro,
    isLoading: hydrating,
    tier: subscription.tier,
    status: subscription.status,
    subscription,
    limits,
    // Ads are a tier limit like any other, so there is a single rule rather
    // than an `isPro` check scattered through the ad code.
    showAds: limits.ads,
    isSimulated: simulatedBilling,
    priceString,
    priceState,
    purchasePro,
    restorePurchases,
    refresh,
  };
}
