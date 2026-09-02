import { Platform } from 'react-native';

import { ENTITLEMENT_PRO, PACKAGE_MONTHLY } from '../constants/limits';
import type { SubscriptionState } from '../types';
import { LockError } from '../utils/errors';
import { log } from '../utils/logger';

/**
 * Entitlements, behind one interface.
 *
 * **RevenueCat is the source of truth.** Nothing else in the app decides
 * whether a user is Pro. Local storage caches the last known answer purely so
 * the UI has something to render before the network settles — it never
 * *grants* anything on its own, and a cached "PRO" is only trusted while
 * RevenueCat is unreachable, never in preference to a fresh answer.
 *
 * When RevenueCat keys are missing — a fresh clone, CI, Expo Go — the service
 * degrades to a local development mode rather than bricking the app.
 * `isSimulated()` is true in that case and the UI says so, so a dev build can
 * never be mistaken for a real purchase flow.
 *
 * Set EXPO_PUBLIC_DEV_PRO_MODE=true to develop Pro features without paying.
 * Turn it off before shipping — see the README release checklist.
 */

type PurchasesModule = typeof import('react-native-purchases');
type PurchasesPackage = import('react-native-purchases').PurchasesPackage;
type CustomerInfo = import('react-native-purchases').CustomerInfo;

const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '';
const DEV_PRO_MODE = process.env.EXPO_PUBLIC_DEV_PRO_MODE === 'true';

function apiKey(): string {
  return Platform.OS === 'ios' ? IOS_KEY : ANDROID_KEY;
}

let purchases: PurchasesModule | null = null;
let configured = false;
/** Local Pro flag used only when RevenueCat is unavailable. */
let simulatedPro = DEV_PRO_MODE;

/**
 * The last entitlement we successfully read.
 *
 * Used only when RevenueCat cannot be reached: a flaky train tunnel must not
 * downgrade a paying customer mid-session.
 */
let lastKnown: SubscriptionState | null = null;

export const FREE_STATE: SubscriptionState = {
  tier: 'FREE',
  status: 'free',
  expirationDate: null,
  willRenew: false,
  managementUrl: null,
  isSandbox: false,
  source: 'revenuecat',
};

function loadPurchases(): PurchasesModule | null {
  if (purchases) return purchases;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    purchases = require('react-native-purchases') as PurchasesModule;
    return purchases;
  } catch (err) {
    log.warn('Purchases', 'react-native-purchases is not available in this build', err);
    return null;
  }
}

function simulatedState(): SubscriptionState {
  return {
    ...FREE_STATE,
    tier: simulatedPro ? 'PRO' : 'FREE',
    status: simulatedPro ? 'active' : 'free',
    source: 'simulated',
  };
}

/**
 * Turns RevenueCat's CustomerInfo into our domain state.
 *
 * The subtle part is that `entitlements.active` already accounts for grace
 * periods and cancellations: an entitlement stays in `active` until the paid
 * period genuinely ends. So Pro is simply "is it in active", and the extra
 * fields only refine *why*, for display.
 */
export function stateFromCustomerInfo(info: CustomerInfo): SubscriptionState {
  const entitlement = info.entitlements.active[ENTITLEMENT_PRO];

  if (!entitlement) {
    // Distinguish "never subscribed" from "had it, it lapsed" so the screen can
    // offer Restore more prominently to a returning customer.
    const everHad = info.entitlements.all[ENTITLEMENT_PRO] != null;
    return {
      ...FREE_STATE,
      status: everHad ? 'expired' : 'free',
      managementUrl: info.managementURL ?? null,
    };
  }

  const billingIssue = entitlement.billingIssueDetectedAt != null;

  return {
    tier: 'PRO',
    status: billingIssue ? 'billingIssue' : entitlement.willRenew ? 'active' : 'cancelled',
    expirationDate: entitlement.expirationDate ?? null,
    willRenew: entitlement.willRenew,
    managementUrl: info.managementURL ?? null,
    isSandbox: entitlement.isSandbox,
    source: 'revenuecat',
  };
}

export const PurchaseService = {
  /** True when entitlements are local-only and no real billing is wired up. */
  isSimulated(): boolean {
    return !configured;
  },

  isDevProMode(): boolean {
    return DEV_PRO_MODE;
  },

  /** Safe to call more than once; only the first call configures the SDK. */
  async configure(): Promise<void> {
    if (configured) return;

    const key = apiKey();
    if (!key) {
      log.warn(
        'Purchases',
        `No RevenueCat key for ${Platform.OS}. Running in local entitlement mode.`
      );
      return;
    }

    const sdk = loadPurchases();
    if (!sdk) return;

    try {
      if (__DEV__) sdk.default.setLogLevel(sdk.LOG_LEVEL.WARN);
      // No appUserID: RevenueCat generates an anonymous id and persists it.
      // When accounts are added later, this becomes logIn(userId) and every
      // caller of this service stays unchanged.
      await sdk.default.configure({ apiKey: key });
      configured = true;
      log.debug('Purchases', 'RevenueCat configured (anonymous identity)');
    } catch (err) {
      // A bad key or a missing native module must not stop the app booting.
      log.error('Purchases', 'RevenueCat configuration failed; falling back to local mode', err);
    }
  },

  /**
   * The current entitlement, straight from RevenueCat.
   *
   * On network failure this returns the last known state rather than FREE —
   * downgrading someone because a request timed out would be a bug that costs
   * a paying customer their features.
   */
  async getCustomerInfo(): Promise<SubscriptionState> {
    if (!configured) return simulatedState();

    const sdk = loadPurchases();
    if (!sdk) return simulatedState();

    try {
      const info = await sdk.default.getCustomerInfo();
      const state = stateFromCustomerInfo(info);
      lastKnown = state;
      return state;
    } catch (err) {
      log.warn('Purchases', 'Could not reach RevenueCat; using last known entitlement', err);
      if (lastKnown) return { ...lastKnown, source: 'cache' };
      // Never seen a successful read. We cannot invent a subscription, so the
      // honest answer is "unknown", and the UI treats that as not-Pro without
      // claiming the user was downgraded.
      return { ...FREE_STATE, status: 'unknown', source: 'cache' };
    }
  },

  /** Convenience wrapper. Prefer `getCustomerInfo()` when you need the detail. */
  async isPro(): Promise<boolean> {
    return (await PurchaseService.getCustomerInfo()).tier === 'PRO';
  },

  /** Seeds the offline fallback from persisted state on a cold start. */
  primeCache(state: SubscriptionState | null): void {
    if (state && state.source !== 'simulated') lastKnown = state;
  },

  /**
   * The monthly price, exactly as the store will charge this customer.
   *
   * `priceString` is Google Play's own localized, currency-formatted string for
   * the product available in the user's region. The app performs **no currency
   * conversion** and applies no exchange rate: doing so would show a number
   * that differs from the Play checkout sheet, which is both confusing and,
   * arguably, misleading about the price.
   *
   * @returns null when the price is genuinely unknown. The UI must then say so
   *   rather than displaying a guess.
   */
  async getMonthlyPrice(): Promise<string | null> {
    if (!configured) return null;

    const sdk = loadPurchases();
    if (!sdk) return null;

    try {
      const offerings = await sdk.default.getOfferings();
      const pkg = offerings.current?.monthly ?? offerings.current?.availablePackages[0];
      return pkg?.product.priceString ?? null;
    } catch (err) {
      log.warn('Purchases', 'Could not read offerings', err);
      return null;
    }
  },

  /**
   * The platform's own subscription management screen.
   *
   * We never build a custom cancellation flow: Google requires cancellation to
   * go through Play, and a homegrown one would be both non-compliant and a
   * worse experience.
   */
  async getManagementUrl(): Promise<string | null> {
    if (!configured) return null;
    try {
      return (await PurchaseService.getCustomerInfo()).managementUrl;
    } catch (err) {
      log.warn('Purchases', 'Could not read the management URL', err);
      return null;
    }
  },

  async purchasePro(): Promise<SubscriptionState> {
    if (!configured) {
      // Local mode: grant Pro so the gated flows are testable, and say so.
      log.warn('Purchases', 'Simulated purchase — no payment was taken.');
      simulatedPro = true;
      return simulatedState();
    }

    const sdk = loadPurchases();
    if (!sdk) throw new LockError('BILLING_UNAVAILABLE', 'In-app purchases are unavailable.');

    let pkg: PurchasesPackage | undefined;
    try {
      const offerings = await sdk.default.getOfferings();
      pkg =
        offerings.current?.monthly ??
        offerings.current?.availablePackages.find((p) => p.identifier === PACKAGE_MONTHLY) ??
        offerings.current?.availablePackages[0];
    } catch (err) {
      log.error('Purchases', 'Could not load offerings', err);
      throw new LockError('BILLING_UNAVAILABLE', 'The store could not be reached.');
    }

    if (!pkg) {
      throw new LockError(
        'BILLING_UNAVAILABLE',
        'No subscription is configured for this app yet.'
      );
    }

    try {
      const { customerInfo } = await sdk.default.purchasePackage(pkg);
      const state = stateFromCustomerInfo(customerInfo);
      lastKnown = state;
      return state;
    } catch (err) {
      const raw = err as { userCancelled?: boolean; message?: string };
      // Backing out of the Play sheet is a normal action, not a failure. It
      // gets its own code so the UI can stay silent instead of scolding.
      if (raw?.userCancelled) {
        throw new LockError('PURCHASE_CANCELLED', 'The purchase was cancelled.');
      }
      throw new LockError('PURCHASE_FAILED', raw?.message ?? 'The purchase failed.');
    }
  },

  async restorePurchases(): Promise<SubscriptionState> {
    if (!configured) return simulatedState();

    const sdk = loadPurchases();
    if (!sdk) throw new LockError('BILLING_UNAVAILABLE', 'In-app purchases are unavailable.');

    try {
      const info = await sdk.default.restorePurchases();
      const state = stateFromCustomerInfo(info);
      lastKnown = state;
      return state;
    } catch (err) {
      const raw = err as { message?: string };
      throw new LockError('PURCHASE_FAILED', raw?.message ?? 'Nothing could be restored.');
    }
  },

  /**
   * Links purchases to a signed-in user.
   *
   * Called after Firebase authentication with the Firebase UID. RevenueCat
   * merges the anonymous customer's purchases into the identified one, so a
   * guest who bought Pro and then signed in keeps what they paid for — that
   * merge is exactly why we call logIn rather than re-configuring the SDK with
   * a different app user id.
   *
   * @returns the entitlement after the transition, or null when billing is not
   *   configured (development builds).
   */
  async identify(appUserId: string): Promise<SubscriptionState | null> {
    if (!configured) return null;

    const sdk = loadPurchases();
    if (!sdk) return null;

    try {
      const current = await sdk.default.getAppUserID();
      // Already this user: logging in again is a wasted round trip.
      if (current === appUserId) return await PurchaseService.getCustomerInfo();

      const { customerInfo } = await sdk.default.logIn(appUserId);
      const state = stateFromCustomerInfo(customerInfo);
      lastKnown = state;
      return state;
    } catch (err) {
      // A failed identity transition must not cost the user their entitlement,
      // so we keep whatever we last knew rather than downgrading.
      log.warn('Purchases', 'Could not link the account to RevenueCat', err);
      return null;
    }
  },

  /**
   * Returns to an anonymous customer on sign-out.
   *
   * RevenueCat generates a fresh anonymous id. Purchases stay attached to the
   * account that made them, so signing back in restores them.
   */
  async forgetIdentity(): Promise<SubscriptionState | null> {
    if (!configured) return null;

    const sdk = loadPurchases();
    if (!sdk) return null;

    try {
      const customerInfo = await sdk.default.logOut();
      const state = stateFromCustomerInfo(customerInfo);
      lastKnown = state;
      return state;
    } catch (err) {
      log.warn('Purchases', 'Could not reset the RevenueCat identity', err);
      return null;
    }
  },

  /** Test/dev seam for toggling the local Pro flag. */
  __setSimulatedPro(value: boolean): void {
    simulatedPro = value;
  },

  /** Test seam: clears the offline fallback between cases. */
  __resetCache(): void {
    lastKnown = null;
  },
};
