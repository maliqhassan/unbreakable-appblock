import { Platform } from 'react-native';

import { log } from '../utils/logger';
import { ConsentService } from './ConsentService';

/**
 * AdMob, behind one interface.
 *
 * Two rules this service exists to enforce:
 *
 *   1. **Ads are never shown to a Pro user.** The entitlement check lives in
 *      `useSubscription`, and `AdBanner` refuses to render without it, so there
 *      is no path where a paying customer sees an ad because one screen forgot
 *      to check.
 *
 *   2. **Ads never sit near enforcement UI.** Not on the active lock screen,
 *      not over the native block screen, not in permission flows. An
 *      accidental tap that dismisses a block screen would break the product's
 *      one job.
 *
 * A missing native module (Expo Go, Jest, web) degrades to "no ads" rather than
 * throwing — an ad failing to load must never take a screen down.
 */

type AdsModule = typeof import('react-native-google-mobile-ads');

/**
 * Google's published test unit id, used whenever a real one is not configured.
 *
 * Documented at https://developers.google.com/admob/android/test-ads. Falling
 * back to this rather than to a production id means a misconfigured build shows
 * test ads instead of risking a policy strike for self-serving live ads.
 */
const TEST_BANNER_UNIT_ID = 'ca-app-pub-3940256099942544/6300978111';

const CONFIGURED_BANNER_ID = process.env.EXPO_PUBLIC_ADMOB_ANDROID_BANNER_ID ?? '';

let ads: AdsModule | null = null;
let initialized = false;
let initializing: Promise<void> | null = null;
/** Screens can suppress the banner without knowing anything about AdMob. */
let bannerVisible = true;

function loadAds(): AdsModule | null {
  if (ads) return ads;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ads = require('react-native-google-mobile-ads') as AdsModule;
    return ads;
  } catch (err) {
    log.warn('Ads', 'react-native-google-mobile-ads is unavailable in this build', err);
    return null;
  }
}

export const AdService = {
  /** True when a real ad unit is configured rather than Google's test id. */
  isUsingTestUnit(): boolean {
    return CONFIGURED_BANNER_ID.length === 0;
  },

  /** True when the SDK is present and ready to serve. */
  isReady(): boolean {
    return initialized;
  },

  bannerUnitId(): string {
    return CONFIGURED_BANNER_ID || TEST_BANNER_UNIT_ID;
  },

  /**
   * Starts the AdMob SDK. Safe to call repeatedly and from several screens —
   * concurrent callers await the same in-flight initialisation.
   */
  async initialize(): Promise<void> {
    if (initialized) return;
    if (initializing) return initializing;

    // This sprint is Android-only; there is no iOS ad configuration to honour.
    if (Platform.OS !== 'android') return;

    const sdk = loadAds();
    if (!sdk) return;

    initializing = (async () => {
      try {
        // Consent first, always. Google's EU User Consent Policy requires a
        // certified CMP to have asked before a personalised ad is requested, so
        // starting the SDK ahead of this would be the violation itself.
        const consent = await ConsentService.gather();
        if (!consent.canRequestAds) {
          log.debug('Ads', `Not starting AdMob: consent ${consent.status}`);
          return;
        }

        await sdk.default().initialize();
        initialized = true;
        log.debug(
          'Ads',
          `AdMob initialised (${AdService.isUsingTestUnit() ? 'test' : 'production'} unit)`
        );
      } catch (err) {
        // No ads is a perfectly survivable state. Never surface this.
        log.warn('Ads', 'AdMob initialisation failed; running without ads', err);
      } finally {
        initializing = null;
      }
    })();

    return initializing;
  },

  /** Allows the banner to render, subject to the caller's entitlement check. */
  showBanner(): void {
    bannerVisible = true;
  },

  /** Hides the banner app-wide, e.g. the moment a purchase succeeds. */
  hideBanner(): void {
    bannerVisible = false;
  },

  isBannerVisible(): boolean {
    return bannerVisible;
  },

  /** Test seam. */
  __reset(): void {
    initialized = false;
    initializing = null;
    bannerVisible = true;
  },
};
