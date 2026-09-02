import { create } from 'zustand';

import { AdService } from '../services/AdService';
import { FREE_STATE, PurchaseService } from '../services/PurchaseService';
import { StorageService } from '../services/StorageService';
import type { SubscriptionState, SubscriptionTier } from '../types';
import { toLockError } from '../utils/errors';
import { log } from '../utils/logger';

/**
 * User + entitlement state.
 *
 * Screens do not read this directly for subscription questions — they use the
 * `useSubscription()` hook, which is the documented entry point. The store is
 * the shared cache behind that hook.
 *
 * RevenueCat remains authoritative throughout: the persisted copy exists only
 * so the first frame after launch has something to show, and is overwritten by
 * the first successful network read.
 */
interface UserState {
  subscription: SubscriptionState;
  /**
   * False until the user has been through the first-run permission flow, by
   * granting everything or explicitly skipping. Persisted, so it happens once.
   */
  onboarded: boolean;
  /** True until the first entitlement check settles. */
  hydrating: boolean;
  /** True when no real billing is configured — surfaced in the UI. */
  simulatedBilling: boolean;
  /**
   * The store's own localized price, e.g. "$2.99", "€2,79", "Rs 850".
   * Null until known — never a placeholder.
   */
  priceString: string | null;
  /** Whether the price is still loading, ready, or genuinely unavailable. */
  priceState: 'loading' | 'ready' | 'unavailable';

  hydrate: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  refreshEntitlement: () => Promise<SubscriptionState>;
  purchasePro: () => Promise<SubscriptionState>;
  restorePurchases: () => Promise<SubscriptionState>;
}

/** Applies one entitlement answer everywhere it matters. */
function applyState(
  set: (partial: Partial<UserState>) => void,
  state: SubscriptionState
): SubscriptionState {
  set({ subscription: state });

  // Ads follow the entitlement immediately, so a successful purchase clears
  // them without waiting for a screen to re-mount.
  if (state.tier === 'PRO') AdService.hideBanner();
  else AdService.showBanner();

  // Cache for the next cold start only. Never read as an authority.
  void StorageService.set('subscription', state);
  return state;
}

export const useUserStore = create<UserState>((set, get) => ({
  subscription: FREE_STATE,
  onboarded: true, // Assume seen until storage says otherwise, to avoid a flash.
  hydrating: true,
  simulatedBilling: true,
  priceString: null,
  priceState: 'loading',

  async hydrate() {
    // Show the last known entitlement immediately so a paywall never flashes at
    // a paying user while the network round-trip is in flight.
    const [cached, onboarded] = await Promise.all([
      StorageService.get<SubscriptionState | null>('subscription', null),
      StorageService.get<boolean>('onboarded', false),
    ]);

    if (cached && typeof cached === 'object' && 'tier' in cached) {
      set({ subscription: { ...cached, source: 'cache' } });
      // Seed the offline fallback so a launch with no connectivity keeps Pro.
      PurchaseService.primeCache(cached);
    }
    set({ onboarded });

    await PurchaseService.configure();
    set({ simulatedBilling: PurchaseService.isSimulated() });

    await get().refreshEntitlement();

    const priceString = await PurchaseService.getMonthlyPrice();
    set({
      priceString,
      // No offering, no price. Saying "unavailable" is the honest answer; a
      // hardcoded figure could differ from the Play checkout sheet.
      priceState: priceString ? 'ready' : 'unavailable',
      hydrating: false,
    });
  },

  async completeOnboarding() {
    set({ onboarded: true });
    await StorageService.set('onboarded', true);
  },

  async refreshEntitlement() {
    try {
      return applyState(set, await PurchaseService.getCustomerInfo());
    } catch (err) {
      // getCustomerInfo already falls back to the cache; this is belt and
      // braces so a store action never rejects into a render.
      log.warn('User', 'Entitlement refresh failed; keeping the cached tier', err);
      return get().subscription;
    }
  },

  async purchasePro() {
    try {
      return applyState(set, await PurchaseService.purchasePro());
    } catch (err) {
      throw toLockError(err);
    }
  },

  async restorePurchases() {
    try {
      return applyState(set, await PurchaseService.restorePurchases());
    } catch (err) {
      throw toLockError(err);
    }
  },
}));

/** Convenience for non-React callers (services, tests). */
export function currentTier(): SubscriptionTier {
  return useUserStore.getState().subscription.tier;
}
