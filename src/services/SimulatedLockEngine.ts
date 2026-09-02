import type {
  NativeCapabilities,
  NativeDiagnostics,
  NativeInstalledApp,
  NativePermissionStatus,
  NativeSelectionSummary,
  NativeStatus,
  UnbreakableLockNativeModule,
} from '../../modules/unbreakable-lock';
import { LockError } from '../utils/errors';
import { log } from '../utils/logger';
import { StorageService } from './StorageService';

/**
 * A stand-in for the native module when it isn't there — Expo Go, web, Jest.
 *
 * It runs the same state machine (start, strict-mode guard, expiry) against
 * AsyncStorage, so every screen and every test exercises the real flow. What it
 * does NOT do is block anything: `canShieldApps` is false, and the UI says so.
 * This is a development aid, never a silent substitute for enforcement.
 */

const SIMULATED_APPS: NativeInstalledApp[] = [
  { packageName: 'com.google.android.youtube', appName: 'YouTube' },
  { packageName: 'com.zhiliaoapp.musically', appName: 'TikTok' },
  { packageName: 'com.instagram.android', appName: 'Instagram' },
  { packageName: 'com.facebook.katana', appName: 'Facebook' },
  { packageName: 'com.reddit.frontpage', appName: 'Reddit' },
  { packageName: 'com.twitter.android', appName: 'X' },
  { packageName: 'com.android.chrome', appName: 'Chrome' },
  { packageName: 'com.snapchat.android', appName: 'Snapchat' },
  { packageName: 'com.whatsapp', appName: 'WhatsApp' },
  { packageName: 'com.netflix.mediaclient', appName: 'Netflix' },
  { packageName: 'com.supercell.clashofclans', appName: 'Clash of Clans' },
  { packageName: 'com.king.candycrushsaga', appName: 'Candy Crush Saga' },
];

interface StoredSimulatedLock {
  active: boolean;
  sessionId: string;
  startTimestamp: number;
  endTimestamp: number;
  strictMode: boolean;
  blockedIds: string[];
}

const EMPTY: StoredSimulatedLock = {
  active: false,
  sessionId: '',
  startTimestamp: 0,
  endTimestamp: 0,
  strictMode: false,
  blockedIds: [],
};

async function read(): Promise<StoredSimulatedLock> {
  return StorageService.get<StoredSimulatedLock>('simulatedLock', EMPTY);
}

async function write(state: StoredSimulatedLock): Promise<void> {
  await StorageService.set('simulatedLock', state);
}

function toStatus(state: StoredSimulatedLock): NativeStatus {
  const active = state.active && state.endTimestamp > Date.now();
  return {
    active,
    sessionId: state.sessionId,
    startTimestamp: state.startTimestamp,
    endTimestamp: state.endTimestamp,
    strictMode: state.strictMode,
    blockedIds: state.blockedIds,
    // There is no service here, so "running" tracks the session exactly.
    serviceRunning: active,
    degradedReason: null,
    // No native engine here, so nothing schedule-driven can be running.
    sources: active ? ['manual'] : [],
    scheduleNames: [],
    dailyLimitPackages: [],
    resetsAt: 0,
  };
}

const CAPABILITIES: NativeCapabilities = {
  // Nothing is actually shielded here, and we say so rather than letting the
  // UI promise a block that will not happen.
  canShieldApps: false,
  canMonitorUsage: false,
  canSurviveJsDeath: false,
  canSurviveReboot: false,
  canPreventUninstall: false,
  canRestrictSettings: false,
  canBlockEarlyExit: true,
};

export const SimulatedLockEngine: UnbreakableLockNativeModule = {
  getCapabilities(): NativeCapabilities {
    return CAPABILITIES;
  },

  getEnforcementCapabilities(): NativeCapabilities {
    return CAPABILITIES;
  },

  async getInstalledApps(): Promise<NativeInstalledApp[]> {
    return SIMULATED_APPS;
  },

  isPermissionGranted(): boolean {
    return true;
  },

  getPermissionStatus(): NativePermissionStatus {
    // Nothing to grant without a native layer, so nothing is outstanding.
    return {
      usageAccess: true,
      overlay: true,
      notifications: true,
      batteryOptimization: true,
      accessibility: false,
    };
  },

  getDiagnostics(): NativeDiagnostics {
    return {
      androidRelease: 'n/a',
      sdkInt: 0,
      manufacturer: 'simulated',
      model: 'simulated',
      serviceRunning: false,
      sessionActive: false,
      sessionId: '',
      startTimestamp: 0,
      endTimestamp: 0,
      remainingMs: 0,
      strictMode: false,
      targets: [],
      degradedReason: 'Running without the native module — nothing is enforced.',
      permissions: SimulatedLockEngine.getPermissionStatus(),
      protectedPackages: [],
      effectiveActive: false,
      effectivePackages: [],
      effectiveSources: [],
      scheduleCount: 0,
      scheduleActive: false,
      canScheduleExactAlarms: false,
      dailyLimitCount: 0,
      dailyLimitActive: false,
      dailyLimitPackages: [],
    };
  },

  async requestPermission(): Promise<boolean> {
    return true;
  },

  async requestAuthorization(): Promise<boolean> {
    return true;
  },

  async presentAppPicker(): Promise<NativeSelectionSummary> {
    return { applicationCount: 1, categoryCount: 0, webDomainCount: 0 };
  },

  async getSelectedApplications(): Promise<NativeSelectionSummary> {
    const state = await read();
    return {
      applicationCount: state.blockedIds.length,
      categoryCount: 0,
      webDomainCount: 0,
    };
  },

  async startLock(
    ids: string[],
    endTimestamp: number,
    strictMode: boolean,
    sessionId: string
  ): Promise<NativeStatus> {
    if (ids.length === 0) {
      throw new LockError('NO_SELECTION', 'Select at least one app to block.');
    }
    if (endTimestamp <= Date.now()) {
      throw new LockError('INVALID_CONFIGURATION', 'The end time is already in the past.');
    }

    const existing = await read();
    if (existing.active && existing.endTimestamp > Date.now()) {
      throw new LockError('ALREADY_ACTIVE', 'A lock is already running.');
    }

    const next: StoredSimulatedLock = {
      active: true,
      sessionId,
      startTimestamp: Date.now(),
      endTimestamp,
      strictMode,
      blockedIds: ids,
    };
    await write(next);
    log.debug('Simulated', `Lock started for ${ids.length} app(s); nothing is really blocked.`);
    return toStatus(next);
  },

  async addAppsToLock(ids: string[]): Promise<NativeStatus> {
    const state = await read();
    if (!state.active || state.endTimestamp <= Date.now()) {
      throw new LockError('NOT_ACTIVE', 'No lock is currently running.');
    }

    const merged = Array.from(new Set([...state.blockedIds, ...ids]));
    const next = { ...state, blockedIds: merged };
    await write(next);
    return toStatus(next);
  },

  async stopLock(force: boolean): Promise<NativeStatus> {
    const state = await read();
    if (!state.active) {
      throw new LockError('NOT_ACTIVE', 'No lock is currently running.');
    }

    const expired = state.endTimestamp <= Date.now();
    if (state.strictMode && !expired && !force) {
      throw new LockError(
        'STRICT_MODE_ACTIVE',
        'Strict Mode is on. This lock cannot be ended before it expires.'
      );
    }

    await write(EMPTY);
    return toStatus(EMPTY);
  },

  async getLockStatus(): Promise<NativeStatus> {
    const state = await read();
    if (state.active && state.endTimestamp <= Date.now()) {
      await write(EMPTY);
      return toStatus(EMPTY);
    }
    return toStatus(state);
  },
};
