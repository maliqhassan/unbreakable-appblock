import { Platform } from 'react-native';

import UnbreakableLock, {
  isNativeLockAvailable,
  type NativeSelectionSummary,
  type UnbreakableLockNativeModule,
} from '../../modules/unbreakable-lock';
import { MAX_DURATION_MINUTES, MIN_DURATION_MINUTES, TIER_LIMITS } from '../constants/limits';
import type {
  EnforcementCapabilities,
  NativeLockStatus,
  SubscriptionTier,
  TargetApp,
  ValidationResult,
} from '../types';
import { LockError, toLockError } from '../utils/errors';
import { log } from '../utils/logger';

/**
 * The single place the app talks to enforcement.
 *
 * Screens never import the native module. They call this, which picks the real
 * engine when it is present and the simulated one otherwise, and normalises
 * every failure into a LockError.
 */

let engineOverride: UnbreakableLockNativeModule | null = null;

/** Test seam. Pass null to go back to the real resolution. */
export function __setEngine(engine: UnbreakableLockNativeModule | null): void {
  engineOverride = engine;
}

function engine(): UnbreakableLockNativeModule {
  if (engineOverride) return engineOverride;
  if (UnbreakableLock) return UnbreakableLock;

  // Required lazily so the simulated engine (and AsyncStorage) is not pulled
  // into the bundle graph before it is needed.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./SimulatedLockEngine').SimulatedLockEngine as UnbreakableLockNativeModule;
}

/** True when real OS enforcement is wired up on this build. */
export function isEnforcementReal(): boolean {
  return engineOverride != null || isNativeLockAvailable;
}

/** The shape returned whenever no lock is running or status could not be read. */
const INACTIVE_STATUS: NativeLockStatus = {
  active: false,
  sessionId: '',
  startTimestamp: 0,
  endTimestamp: 0,
  strictMode: false,
  blockedIds: [],
  serviceRunning: false,
  degradedReason: null,
  sources: [],
  scheduleNames: [],
  dailyLimitPackages: [],
  resetsAt: 0,
};

export const LockService = {
  isEnforcementReal,

  /** All Android permissions in one call. Safe on every platform. */
  getPermissionStatus() {
    return engine().getPermissionStatus();
  },

  /** Android dev builds only; throws elsewhere. */
  getDiagnostics() {
    return engine().getDiagnostics();
  },

  getCapabilities(): EnforcementCapabilities {
    try {
      return engine().getCapabilities();
    } catch (err) {
      log.warn('LockService', 'getCapabilities failed; assuming no enforcement', err);
      return {
        canShieldApps: false,
        canMonitorUsage: false,
        canSurviveJsDeath: false,
        canSurviveReboot: false,
        canPreventUninstall: false,
        canRestrictSettings: false,
        canBlockEarlyExit: false,
      };
    }
  },

  /**
   * Android: real installed apps. iOS: rejects — Apple does not expose them, so
   * callers must use {@link pickAppsWithSystemUI} instead.
   *
   * Never throws for the Android enumeration failing: an OEM that blocks the
   * query yields an empty list, and the picker shows its empty state.
   */
  async getInstalledApps(): Promise<TargetApp[]> {
    try {
      const apps = await engine().getInstalledApps();
      return apps.map((app) => ({
        id: app.packageName,
        name: app.appName,
        iconBase64: app.iconBase64,
      }));
    } catch (err) {
      const error = toLockError(err);
      if (error.code === 'UNSUPPORTED_PLATFORM') throw error;
      log.warn('LockService', 'App enumeration failed; returning empty list', error);
      return [];
    }
  },

  /** iOS only: Apple's FamilyActivityPicker. Returns opaque, count-based targets. */
  async pickAppsWithSystemUI(): Promise<TargetApp[]> {
    const summary = await engine()
      .presentAppPicker()
      .catch((err: unknown) => {
        throw toLockError(err);
      });
    return summaryToTargets(summary);
  },

  /** iOS only: what the user previously chose, without re-opening the picker. */
  async getSystemSelection(): Promise<TargetApp[]> {
    try {
      return summaryToTargets(await engine().getSelectedApplications());
    } catch (err) {
      log.warn('LockService', 'Could not read the saved iOS selection', err);
      return [];
    }
  },

  async getStatus(): Promise<NativeLockStatus> {
    try {
      return await engine().getLockStatus();
    } catch (err) {
      log.warn('LockService', 'getLockStatus failed; reporting inactive', err);
      return INACTIVE_STATUS;
    }
  },

  async startLock(
    apps: TargetApp[],
    endTimestamp: number,
    strictMode: boolean,
    sessionId: string
  ): Promise<NativeLockStatus> {
    try {
      return await engine().startLock(
        apps.map((app) => app.id),
        endTimestamp,
        strictMode,
        sessionId
      );
    } catch (err) {
      throw toLockError(err);
    }
  },

  /**
   * Adds apps to a lock that is already running.
   *
   * Works under Strict Mode: adding targets only makes the session stronger,
   * and Strict Mode exists to prevent weakening a commitment, not strengthening
   * one.
   */
  async addAppsToRunningLock(apps: TargetApp[]): Promise<NativeLockStatus> {
    try {
      return await engine().addAppsToLock(apps.map((app) => app.id));
    } catch (err) {
      throw toLockError(err);
    }
  },

  /**
   * @param force only for internal expiry handling. A user-facing "end lock"
   *   must pass false so Strict Mode is honoured.
   */
  async stopLock(force = false): Promise<NativeLockStatus> {
    try {
      return await engine().stopLock(force);
    } catch (err) {
      const error = toLockError(err);
      // Nothing running is the state the caller wanted anyway.
      if (error.code === 'NOT_ACTIVE') {
        return INACTIVE_STATUS;
      }
      throw error;
    }
  },

  /**
   * Validates a configuration against the user's tier.
   *
   * Returns a result rather than throwing: the caller usually wants to show a
   * paywall, not an error.
   */
  validateConfiguration(
    apps: TargetApp[],
    durationMinutes: number,
    strictMode: boolean,
    tier: SubscriptionTier
  ): ValidationResult {
    const limits = TIER_LIMITS[tier];

    if (apps.length === 0) {
      return { valid: false, reason: 'Choose at least one app to block.' };
    }
    if (durationMinutes < MIN_DURATION_MINUTES) {
      return {
        valid: false,
        reason: `Locks must be at least ${MIN_DURATION_MINUTES} minutes.`,
      };
    }
    if (durationMinutes > MAX_DURATION_MINUTES) {
      return {
        valid: false,
        reason: `Locks cannot be longer than ${MAX_DURATION_MINUTES / 60} hours.`,
      };
    }

    if (apps.length > limits.maxApps) {
      return {
        valid: false,
        requiresPro: true,
        reason: `Your plan can block ${limits.maxApps} app at a time.`,
      };
    }
    if (durationMinutes > limits.maxDurationMinutes) {
      return {
        valid: false,
        requiresPro: true,
        reason: `Your plan allows locks up to ${limits.maxDurationMinutes} minutes.`,
      };
    }
    if (strictMode && !limits.strictMode) {
      return {
        valid: false,
        requiresPro: true,
        reason: 'Strict Mode is a Pro feature.',
      };
    }

    return { valid: true };
  },
};

/**
 * iOS gives us counts, not identities — the FamilyControls tokens are opaque by
 * design. We build placeholder targets so the rest of the app can treat both
 * platforms the same, and flag them `opaque` so the UI shows a count instead of
 * inventing app names.
 */
function summaryToTargets(summary: NativeSelectionSummary): TargetApp[] {
  const targets: TargetApp[] = [];

  for (let i = 0; i < summary.applicationCount; i += 1) {
    targets.push({ id: `ios.app.${i}`, name: 'Selected app', opaque: true });
  }
  for (let i = 0; i < summary.categoryCount; i += 1) {
    targets.push({ id: `ios.category.${i}`, name: 'Selected category', opaque: true });
  }
  for (let i = 0; i < summary.webDomainCount; i += 1) {
    targets.push({ id: `ios.web.${i}`, name: 'Selected website', opaque: true });
  }

  return targets;
}

/** iOS picks apps in a system sheet; Android lists them in-app. */
export const usesSystemAppPicker = Platform.OS === 'ios';

export { LockError };
