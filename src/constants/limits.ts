import type { SubscriptionTier } from '../types';

/**
 * The single source of truth for what each tier may do.
 *
 * Nothing in the UI is allowed to re-derive these rules. Screens ask
 * `LockService.validateConfiguration()` or read `TIER_LIMITS[tier]`; they never
 * hardcode "1 app" or "60 minutes" inline. That way a pricing change is one
 * edit here rather than a hunt through every screen.
 */

/** RevenueCat entitlement identifier. Must match the RevenueCat dashboard. */
export const ENTITLEMENT_PRO = 'pro';

/** RevenueCat offering / package identifiers used by the subscription screen. */
export const OFFERING_DEFAULT = 'default';
export const PACKAGE_MONTHLY = '$rc_monthly';

/** Google Play product/base-plan ids. Documented in the README setup guide. */
export const PLAY_SUBSCRIPTION_ID = 'unbreakable_lock_pro';
export const PLAY_BASE_PLAN_MONTHLY = 'pro-monthly';

/**
 * There is deliberately no fallback price constant.
 *
 * A hardcoded "$2.99" would be wrong for most of the world and, worse, could
 * differ from what Google Play actually charges at checkout. The price shown
 * always comes from the store product RevenueCat returns for *this* customer,
 * in their currency. When it is not available the UI says so instead of
 * guessing — see SubscriptionScreen.
 */

export interface TierLimits {
  maxApps: number;
  maxDurationMinutes: number;
  strictMode: boolean;
  schedules: boolean;
  /** Free users fund the app with ads; Pro users have paid to remove them. */
  ads: boolean;
}

/**
 * Free is limited by **how many apps**, not by how long.
 *
 * Someone who wants an eight-hour lock on one app is using the product exactly
 * as intended; capping them at an hour taught them the app was not up to the
 * job. The single meaningful restriction is one protected app.
 */
export const FREE_LIMITS: TierLimits = {
  maxApps: 1,
  // Same ceiling as Pro: this is the engine's technical maximum, not a
  // commercial one. See MAX_DURATION_MINUTES.
  maxDurationMinutes: 24 * 60,
  strictMode: false,
  schedules: false,
  ads: true,
};

export const PRO_LIMITS: TierLimits = {
  // Deliberately finite rather than Infinity: these values are compared,
  // formatted into copy, and serialised. A real ceiling that no one will hit
  // behaves better everywhere than a float that renders as "Infinity".
  maxApps: 50,
  maxDurationMinutes: 24 * 60,
  strictMode: true,
  schedules: true,
  ads: false,
};

export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  FREE: FREE_LIMITS,
  PRO: PRO_LIMITS,
};

/**
 * Duration presets, in minutes.
 *
 * None are gated: every tier can pick any of these, plus a custom value. The
 * `pro` flag is gone because duration is no longer a paid axis.
 */
export const DURATION_PRESETS = [
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 45, label: '45 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 240, label: '4 hours' },
  { minutes: 480, label: '8 hours' },
] as const;

export const MIN_DURATION_MINUTES = 5;

/**
 * The engine's technical ceiling, not a plan restriction.
 *
 * Android's monotonic deadline and the notification chronometer both stay
 * well-behaved inside a day; beyond that a "lock" is really a schedule, which
 * the app has a proper feature for.
 */
export const MAX_DURATION_MINUTES = 24 * 60;

export const PRO_BENEFITS = [
  'Unlimited apps',
  'Daily usage limits',
  'Recurring schedules',
  'Strict Mode — no early exit',
  'No advertisements',
] as const;

/** What Free actually includes, for the plan card. Honest, not apologetic. */
export const FREE_FEATURES = [
  '1 protected app',
  'Any timer duration',
  'Daily usage limits',
  'Ads',
] as const;
