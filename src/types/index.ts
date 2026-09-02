/**
 * Shared domain types for Unbreakable Lock.
 *
 * These types are platform-neutral. Platform-specific quirks (e.g. iOS never
 * exposing a package name for an app) are modelled explicitly rather than
 * hidden, so the UI can adapt instead of pretending.
 */

/** Which OS-level enforcement strategy a session asked for. */
export type EnforcementLevel = 'STANDARD' | 'STRICT';

/** Lifecycle of a lock session. */
export type LockStatus =
  | 'idle'
  | 'preparing'
  | 'active'
  | 'completed'
  | 'failed';

export type SubscriptionTier = 'FREE' | 'PRO';

/**
 * A blockable target.
 *
 * On Android a target is a concrete installed package.
 * On iOS a target is an opaque FamilyControls token chosen by the user in
 * Apple's own picker; we never learn the bundle id, so `id` is a local handle
 * and `name` may be a generic placeholder such as "3 apps, 1 category".
 */
export interface TargetApp {
  /** Android: package name. iOS: synthetic id for the FamilyControls selection. */
  id: string;
  /** Human readable label. May be a placeholder on iOS. */
  name: string;
  /** Base64 PNG of the launcher icon, when the platform can provide one. */
  iconBase64?: string;
  /** True when the platform cannot tell us which concrete app this is. */
  opaque?: boolean;
}

export interface LockSession {
  id: string;
  selectedApps: TargetApp[];
  /** Epoch ms. */
  startTimestamp: number;
  /** Epoch ms. Sole source of truth for remaining time. */
  endTimestamp: number;
  strictMode: boolean;
  status: LockStatus;
  /** Set when status === 'failed'. */
  failureReason?: string;
  /**
   * Set while the session is active but enforcement has stopped working, e.g.
   * a permission was revoked. The lock is still counting down; it just is not
   * blocking anything, and the UI says so.
   */
  degradedReason?: string;
  /** What started this lock. A scheduled lock is labelled differently. */
  source?: LockSource;
  /** The schedule's name, when source is 'schedule'. */
  scheduleName?: string;
  /** Epoch ms of the next local midnight, when source is 'daily_usage'. */
  resetsAt?: number;
}

export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

/**
 * A recurring lock.
 *
 * Times are local wall-clock "HH:mm", deliberately NOT Date objects or UTC
 * timestamps. "Every weekday at 10pm" means 10pm wherever the user happens to
 * be; storing an instant would silently shift the schedule when they change
 * timezone, which is the opposite of what anyone means by a daily routine.
 */
export interface LockSchedule {
  id: string;
  name: string;
  enabled: boolean;
  /** Android package names. */
  appPackageNames: string[];
  daysOfWeek: Weekday[];
  /** Local wall clock, "HH:mm", 24-hour. */
  startTime: string;
  /** Local wall clock. When <= startTime the schedule runs overnight. */
  endTime: string;
  strictMode: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * What caused a lock to be running.
 *
 * Both sources can be active at once, and neither may cancel the other: a
 * schedule ending must not lift a manual lock the user started by hand, and
 * vice versa. Effective enforcement is the union of every active source.
 */
export type LockSource = 'manual' | 'schedule' | 'daily_usage';

/**
 * A daily foreground-time budget for one app.
 *
 * "15 minutes of YouTube per day" — measured against real usage reported by
 * Android, not a countdown started when the rule was created.
 */
export interface DailyUsageLimit {
  id: string;
  appPackageName: string;
  /** Seconds of foreground use allowed per local calendar day. */
  dailyLimitSeconds: number;
  enabled: boolean;
  strictMode: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Today's position against one limit.
 *
 * `usageSeconds` is null when Android could not be asked — usually because
 * Usage Access is missing. That is deliberately distinct from zero: showing
 * "0 minutes used" when the query failed would be a lie the user acts on.
 */
export interface DailyUsageStatus {
  packageName: string;
  limitSeconds: number;
  usageSeconds: number | null;
  remainingSeconds: number;
  /**
   * True when the allowance is spent according to the latest SUCCESSFUL
   * measurement — which is not the same as the latest attempt. A limit reached
   * earlier today stays exhausted even if usage cannot be re-measured now.
   */
  exhausted: boolean;
  /** Epoch ms of the next local midnight, when the allowance resets. */
  resetsAt: number;
}

/** The merged result of every active source. */
export interface EffectiveLockState {
  active: boolean;
  /** Union of every active source's apps. */
  packages: string[];
  /** True when ANY active source demands it. */
  strictMode: boolean;
  /** The LATEST end across active sources — never the earliest. */
  endTimestamp: number;
  sources: LockSource[];
}

/**
 * What the current platform + OS version can actually do.
 *
 * The UI reads this instead of hardcoding promises. Anything we cannot do
 * through public, policy-compliant APIs reports `false` — we never claim it.
 */
export interface EnforcementCapabilities {
  /** Can we interrupt / shield a blocked app when the user opens it? */
  canShieldApps: boolean;
  /** Can we observe which app is in the foreground? */
  canMonitorUsage: boolean;
  /** Can we stop the user uninstalling this app? (Always false — see README.) */
  canPreventUninstall: boolean;
  /** Can we stop the user opening system Settings? (Always false — see README.) */
  canRestrictSettings: boolean;
  /** Can native refuse an early stopLock() during a strict session? */
  canBlockEarlyExit: boolean;
  /** Does enforcement survive the JS runtime being killed? */
  canSurviveJsDeath: boolean;
  /** Does enforcement survive a device reboot? */
  canSurviveReboot: boolean;
}

export type PermissionId =
  | 'usageAccess'
  | 'overlay'
  | 'notifications'
  | 'batteryOptimization'
  | 'accessibility'
  | 'familyControls';

export type PermissionStatus = 'granted' | 'denied' | 'unavailable' | 'unknown';

export interface PermissionState {
  id: PermissionId;
  /** Display name, e.g. "Usage access". */
  title: string;
  /** One-line reason, shown on the permission card. */
  rationale: string;
  /** Fuller explanation for the "Why we need this" sheet. */
  explanation: string;
  /** What this permission is NOT used for. Shown alongside the explanation. */
  privacyNote: string;
  /** Emoji used as the card icon. */
  icon: string;
  status: PermissionStatus;
  /** False when the lock cannot run at all without it. */
  optional: boolean;
}

/** Native lock state, read back from the platform's own persistence. */
export interface NativeLockStatus {
  active: boolean;
  sessionId: string;
  startTimestamp: number;
  endTimestamp: number;
  strictMode: boolean;
  blockedIds: string[];
  /** True when the enforcement service is actually alive right now. */
  serviceRunning: boolean;
  /**
   * Non-null when a lock is running but cannot enforce, e.g. the user revoked
   * usage access mid-session. Surfaced to the user rather than swallowed.
   */
  degradedReason: string | null;
  /** Which sources are contributing: "manual", "schedule", or both. */
  sources: string[];
  /** Names of the schedules currently running. */
  scheduleNames: string[];
  /** Packages locked because their daily allowance is spent. */
  dailyLimitPackages: string[];
  /** Epoch ms of the next local midnight, when allowances reset. */
  resetsAt: number;
}

/** Structured error shape every native call rejects with. */
export interface LockErrorShape {
  code: LockErrorCode;
  message: string;
}

export type LockErrorCode =
  | 'PERMISSION_REQUIRED'
  | 'UNSUPPORTED_PLATFORM'
  | 'UNSUPPORTED_OS_VERSION'
  | 'AUTHORIZATION_DENIED'
  | 'ENTITLEMENT_UNAVAILABLE'
  | 'EXTENSION_UNAVAILABLE'
  | 'NO_SELECTION'
  | 'INVALID_CONFIGURATION'
  | 'STRICT_MODE_ACTIVE'
  | 'ALREADY_ACTIVE'
  | 'NOT_ACTIVE'
  | 'PURCHASE_CANCELLED'
  | 'PURCHASE_FAILED'
  | 'BILLING_UNAVAILABLE'
  | 'AUTH_UNAVAILABLE'
  | 'AUTH_CANCELLED'
  | 'AUTH_FAILED'
  | 'AUTH_INVALID_EMAIL'
  | 'AUTH_EXPIRED_LINK'
  | 'AUTH_TOO_MANY_ATTEMPTS'
  | 'AUTH_NETWORK'
  | 'AUTH_REAUTH_REQUIRED'
  | 'UNKNOWN';

/** Result of validating a lock configuration against tier limits. */
export interface ValidationResult {
  valid: boolean;
  /** Present when invalid. */
  reason?: string;
  /** True when the block is a paywall, not a hard error. */
  requiresPro?: boolean;
}

/**
 * Why a user does or does not currently have Pro.
 *
 * `cancelled` and `billingIssue` still mean the user HAS Pro — they have paid
 * for a period that has not ended yet. Only `expired` and `free` remove access.
 * Collapsing these into a boolean would mean revoking a paid entitlement the
 * moment someone turns off auto-renew, which would be theft of what they paid
 * for.
 */
export type SubscriptionStatus =
  | 'unknown'
  | 'free'
  | 'active'
  | 'cancelled'
  | 'billingIssue'
  | 'expired';

/** Where the current entitlement answer came from. */
export type EntitlementSource = 'revenuecat' | 'cache' | 'simulated';

export interface SubscriptionState {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  /** ISO date the current period ends, when known. */
  expirationDate: string | null;
  /** False once auto-renew is turned off; access continues until expiry. */
  willRenew: boolean;
  /** Play/App Store subscription management deep link, when RevenueCat has one. */
  managementUrl: string | null;
  /** True for sandbox/test purchases, so the UI can label them. */
  isSandbox: boolean;
  source: EntitlementSource;
}

/** Who the signed-in user is. Firebase owns this; RevenueCat owns entitlement. */
export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
  photoUrl: string | null;
  provider: 'google' | 'email' | 'anonymous';
}

/** Persisted first-run progress. Permission state is never stored here. */
export interface OnboardingState {
  completed: boolean;
  /** True once the user has been through the permission step, granted or not. */
  permissionsSetupCompleted: boolean;
}
