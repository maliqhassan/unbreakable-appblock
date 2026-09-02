/**
 * The contract between JS and both native platforms.
 *
 * Android and iOS implement the SAME method names. Methods that one platform
 * genuinely cannot provide reject with `UNSUPPORTED_PLATFORM` rather than
 * silently returning empty data, so callers must handle the difference.
 */

export interface NativeInstalledApp {
  packageName: string;
  appName: string;
  /** Base64-encoded PNG, no data: prefix. Omitted when icon extraction fails. */
  iconBase64?: string;
}

export interface NativeCapabilities {
  canShieldApps: boolean;
  canMonitorUsage: boolean;
  /** Does enforcement keep running with no JS process at all? */
  canSurviveJsDeath: boolean;
  canSurviveReboot: boolean;
  canPreventUninstall: boolean;
  canRestrictSettings: boolean;
  canBlockEarlyExit: boolean;
}

/** Every permission's state in one call, for diagnostics and the gate screen. */
export interface NativePermissionStatus {
  usageAccess: boolean;
  overlay: boolean;
  notifications: boolean;
  batteryOptimization: boolean;
  /** Always false: this app deliberately ships no AccessibilityService. */
  accessibility: boolean;
}

/** Dev-only diagnostics. Never shown in production builds. */
export interface NativeDiagnostics {
  androidRelease: string;
  sdkInt: number;
  manufacturer: string;
  model: string;
  serviceRunning: boolean;
  sessionActive: boolean;
  sessionId: string;
  startTimestamp: number;
  endTimestamp: number;
  remainingMs: number;
  strictMode: boolean;
  targets: string[];
  degradedReason: string | null;
  permissions: NativePermissionStatus;
  protectedPackages: string[];
  /** The merged manual+schedule view — what is really being enforced. */
  effectiveActive: boolean;
  effectivePackages: string[];
  effectiveSources: string[];
  scheduleCount: number;
  scheduleActive: boolean;
  canScheduleExactAlarms: boolean;
  dailyLimitCount: number;
  dailyLimitActive: boolean;
  dailyLimitPackages: string[];
}

export interface NativeStatus {
  active: boolean;
  sessionId: string;
  startTimestamp: number;
  endTimestamp: number;
  strictMode: boolean;
  blockedIds: string[];
  /** True when the enforcement service is actually alive right now. */
  serviceRunning: boolean;
  /**
   * Non-null when a lock is running but cannot enforce — e.g. the user revoked
   * usage access mid-session. The UI must stop claiming protection.
   */
  degradedReason: string | null;
  /** Which sources are contributing: "manual", "schedule", or both. */
  sources: string[];
  /** Names of the schedules currently running, for the active-lock screen. */
  scheduleNames: string[];
  /** Packages locked because their daily allowance is spent. */
  dailyLimitPackages: string[];
  /** Epoch ms of the next local midnight, when allowances reset. */
  resetsAt: number;
}

/** iOS FamilyControls picker result. Tokens stay inside the native side. */
export interface NativeSelectionSummary {
  /** Number of individual applications chosen. */
  applicationCount: number;
  /** Number of whole categories chosen. */
  categoryCount: number;
  /** Number of web domains chosen. */
  webDomainCount: number;
}

export interface UnbreakableLockNativeModule {
  getCapabilities(): NativeCapabilities;
  /** Alias of getCapabilities, named for the Android enforcement audit. */
  getEnforcementCapabilities(): NativeCapabilities;

  /** Android only. Rejects with UNSUPPORTED_PLATFORM on iOS. */
  getInstalledApps(): Promise<NativeInstalledApp[]>;

  isPermissionGranted(permission: string): boolean;
  /** All permissions at once. Never throws for one unavailable on this OS. */
  getPermissionStatus(): NativePermissionStatus;
  /** Android only, dev builds only. */
  getDiagnostics(): NativeDiagnostics;
  /** Opens the relevant system settings screen. Cannot be granted silently. */
  requestPermission(permission: string): Promise<boolean>;

  /** iOS only: Screen Time / FamilyControls authorization. */
  requestAuthorization(): Promise<boolean>;
  /** iOS only: presents Apple's FamilyActivityPicker. */
  presentAppPicker(): Promise<NativeSelectionSummary>;
  /** iOS only: what the user last chose in the picker. */
  getSelectedApplications(): Promise<NativeSelectionSummary>;

  /**
   * @param ids Android package names. Ignored on iOS (the FamilyControls
   *            selection stored by presentAppPicker is used instead).
   * @param endTimestamp absolute epoch ms — never a duration.
   */
  startLock(
    ids: string[],
    endTimestamp: number,
    strictMode: boolean,
    sessionId: string
  ): Promise<NativeStatus>;

  /**
   * Adds apps to the running lock without changing its deadline.
   * Allowed during Strict Mode — it only tightens the session.
   */
  addAppsToLock(ids: string[]): Promise<NativeStatus>;

  /** @param force bypasses the strict-mode guard. Only for internal expiry. */
  stopLock(force: boolean): Promise<NativeStatus>;

  getLockStatus(): Promise<NativeStatus>;
}
