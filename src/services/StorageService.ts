import AsyncStorage from '@react-native-async-storage/async-storage';

import { log } from '../utils/logger';

/**
 * Thin JSON wrapper over AsyncStorage.
 *
 * Reads never throw: a corrupt or missing value returns the fallback. Losing a
 * preference is annoying; crashing on launch because one key went bad is worse.
 */
const KEYS = {
  session: 'ul.session',
  selectedApps: 'ul.selectedApps',
  subscription: 'ul.subscription',
  schedules: 'ul.schedules',
  dailyLimits: 'ul.dailyLimits',
  onboarded: 'ul.onboarded',
  permissionsSetupCompleted: 'ul.permissionsSetup',
  guestMode: 'ul.guestMode',
  simulatedLock: 'ul.simulated.lock',
  /** When the user agreed to the data notice, before creating an account. */
  accountConsentAt: 'ul.accountConsentAt',
} as const;

export type StorageKey = keyof typeof KEYS;

export const StorageService = {
  async get<T>(key: StorageKey, fallback: T): Promise<T> {
    try {
      const raw = await AsyncStorage.getItem(KEYS[key]);
      if (raw == null) return fallback;
      return JSON.parse(raw) as T;
    } catch (err) {
      log.warn('Storage', `Could not read "${key}", using fallback`, err);
      return fallback;
    }
  },

  async set<T>(key: StorageKey, value: T): Promise<void> {
    try {
      await AsyncStorage.setItem(KEYS[key], JSON.stringify(value));
    } catch (err) {
      log.warn('Storage', `Could not write "${key}"`, err);
    }
  },

  async remove(key: StorageKey): Promise<void> {
    try {
      await AsyncStorage.removeItem(KEYS[key]);
    } catch (err) {
      log.warn('Storage', `Could not remove "${key}"`, err);
    }
  },
};
