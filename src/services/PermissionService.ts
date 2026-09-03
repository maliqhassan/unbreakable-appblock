import { Platform } from 'react-native';

import UnbreakableLock from '../../modules/unbreakable-lock';
import type { PermissionId, PermissionState } from '../types';
import { toLockError } from '../utils/errors';
import { log } from '../utils/logger';

/**
 * The permission state machine.
 *
 * Nothing here can be granted silently. Every one of these is a deliberate user
 * decision made in system Settings, so the service's job is to report status
 * honestly and open the right screen — never to nag around a refusal.
 */

interface PermissionSpec {
  id: PermissionId;
  title: string;
  rationale: string;
  explanation: string;
  privacyNote: string;
  icon: string;
  optional: boolean;
}

/**
 * The permissions this app actually uses. Nothing aspirational, nothing
 * "might need later" — every entry here is load-bearing for enforcement.
 *
 * Note what is absent: there is no Accessibility entry, because this app ships
 * no AccessibilityService. Asking for the ability to read every screen the user
 * sees, for a capability we do not implement, would be indefensible.
 */
const ANDROID_PERMISSIONS: PermissionSpec[] = [
  {
    id: 'usageAccess',
    title: 'Usage Access',
    icon: '📊',
    rationale: 'Lets Unbreakable Lock detect when a selected app is being used.',
    explanation:
      'Unbreakable Lock uses Usage Access to detect when one of your selected apps is opened during an active lock. Without it, Android gives the app no way to know which app you are looking at, and nothing can be blocked.',
    privacyNote:
      'It reads app names only. It cannot read your messages, your screen contents, or anything inside the apps you block.',
    optional: false,
  },
  {
    id: 'overlay',
    title: 'Display over other apps',
    icon: '🪟',
    rationale: 'Lets the lock screen appear over an app you have blocked.',
    explanation:
      'When you open a blocked app, Unbreakable Lock shows a full-screen reminder over it. Android 10 and later refuse to let an app do this from the background without this permission.',
    privacyNote:
      'It only lets this app draw its own lock screen. It gives no access to what other apps display.',
    optional: false,
  },
  {
    id: 'notifications',
    title: 'Notifications',
    icon: '🔔',
    rationale: 'Keeps the lock running in the background.',
    explanation:
      'Android requires a visible notification while a background service is running. That notification is what keeps your lock alive when the app is closed, and it shows the time remaining.',
    privacyNote:
      'Used only for the ongoing lock notification. No marketing, no alerts, nothing else.',
    optional: false,
  },
  {
    id: 'batteryOptimization',
    title: 'Unrestricted battery',
    icon: '🔋',
    rationale: 'Optional. Stops your phone ending a lock early to save power.',
    explanation:
      'Some manufacturers — Samsung, Xiaomi and OnePlus especially — stop background services aggressively to save battery. That can end a lock before its timer runs out. Allowing unrestricted battery use makes that far less likely.',
    privacyNote:
      'This changes how Android schedules the app. It grants no access to any of your data.',
    optional: true,
  },
  {
    id: 'oemAutostart',
    title: 'Autostart',
    icon: '♻️',
    rationale: 'Required on Xiaomi, Oppo, Vivo and Huawei phones.',
    explanation:
      "Some manufacturers run their own power manager on top of Android's. On those phones, Android's own battery setting is not enough — there is a separate Autostart permission inside the manufacturer's security app, and without it your daily limits stop being measured and locks do not survive a restart.",
    privacyNote:
      'This only tells your phone to stop killing the app. It grants no access to any of your data.',
    optional: true,
  },
];

const IOS_PERMISSIONS: PermissionSpec[] = [
  {
    id: 'familyControls',
    title: 'Screen Time access',
    icon: '⏱',
    rationale: 'Apple requires this before an app can shield other apps.',
    explanation:
      'Apple requires Screen Time authorization before an app can restrict other apps. Apple, not this app, enforces the block.',
    privacyNote:
      'Your app choices stay inside iOS. This app never learns which apps you picked, only how many.',
    optional: false,
  },
];

function specs(): PermissionSpec[] {
  if (Platform.OS === 'android') {
    // The autostart row only appears on the vendors that need it. Showing a
    // Xiaomi-specific step to a Pixel owner is noise, and noise in a setup flow
    // is how people stop reading it.
    return ANDROID_PERMISSIONS.filter(
      (spec) => spec.id !== 'oemAutostart' || oemAutostart().needed
    );
  }
  if (Platform.OS === 'ios') return IOS_PERMISSIONS;
  return [];
}

interface OemAutostart {
  needed: boolean;
  label: string;
  manufacturer: string;
}

const NO_AUTOSTART: OemAutostart = { needed: false, label: 'Autostart', manufacturer: '' };

/** Cached: the manufacturer cannot change while the app is running. */
let oemCache: OemAutostart | null = null;

export function oemAutostart(): OemAutostart {
  if (oemCache) return oemCache;
  const native = UnbreakableLock as unknown as { getOemAutostart?: () => OemAutostart };
  if (typeof native?.getOemAutostart !== 'function') return NO_AUTOSTART;
  try {
    oemCache = native.getOemAutostart();
    return oemCache ?? NO_AUTOSTART;
  } catch {
    return NO_AUTOSTART;
  }
}

export const PermissionService = {
  /**
   * The permissions relevant to this platform, with live status.
   *
   * Uses the single batched native call so a four-row list is one bridge
   * crossing rather than four, and so every row reflects the same instant.
   */
  getAll(): PermissionState[] {
    if (!UnbreakableLock) {
      return specs().map((spec) => ({ ...spec, status: 'unavailable' as const }));
    }

    let batch: Record<string, boolean> | null = null;
    try {
      batch = UnbreakableLock.getPermissionStatus() as unknown as Record<string, boolean>;
    } catch (err) {
      log.warn('Permissions', 'Batch status read failed; falling back per-permission', err);
    }

    return specs().map((spec) => {
      // Android exposes no way to read the vendor's autostart setting: no
      // permission check, no AppOps entry, nothing. Reporting it as granted
      // would tell someone they are protected when they may not be, and
      // reporting it as denied would nag people who have already enabled it.
      // Unknown is the only honest answer.
      if (spec.id === 'oemAutostart') return { ...spec, status: 'unknown' as const };

      if (batch && spec.id in batch) {
        return { ...spec, status: batch[spec.id] ? ('granted' as const) : ('denied' as const) };
      }
      return { ...spec, status: PermissionService.check(spec.id) };
    });
  },

  check(id: PermissionId): PermissionState['status'] {
    if (!UnbreakableLock) return 'unavailable';
    try {
      return UnbreakableLock.isPermissionGranted(id) ? 'granted' : 'denied';
    } catch (err) {
      log.warn('Permissions', `Could not read status for "${id}"`, err);
      return 'unknown';
    }
  },

  /** True when every non-optional permission is granted. */
  hasRequired(): boolean {
    return PermissionService.getAll()
      .filter((p) => !p.optional)
      .every((p) => p.status === 'granted' || p.status === 'unavailable');
  },

  /** The required permissions still outstanding. */
  missingRequired(): PermissionState[] {
    return PermissionService.getAll().filter(
      (p) => !p.optional && p.status !== 'granted' && p.status !== 'unavailable'
    );
  },

  /**
   * Opens the system screen for a permission.
   *
   * On Android this returns false immediately — the user has only been shown
   * Settings, and we re-check when the app comes back to the foreground. On iOS
   * the Screen Time prompt is in-app, so the returned value is meaningful.
   */
  async request(id: PermissionId): Promise<boolean> {
    if (!UnbreakableLock) return false;

    // Not an Android permission: it lives in the vendor's own security app, so
    // it needs the vendor's own intent.
    if (id === 'oemAutostart') {
      const native = UnbreakableLock as unknown as {
        openAutostartSettings?: () => Promise<{ opened: boolean }>;
      };
      if (typeof native?.openAutostartSettings !== 'function') return false;
      await native.openAutostartSettings();
      // Nothing can be verified afterwards, so this never claims success.
      return false;
    }

    try {
      return await UnbreakableLock.requestPermission(id);
    } catch (err) {
      throw toLockError(err);
    }
  },
};
