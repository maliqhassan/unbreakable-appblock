import { Platform } from 'react-native';

import { log } from '../utils/logger';

/**
 * Ad consent, via Google's User Messaging Platform (UMP).
 *
 * **Why this exists.** Google's EU User Consent Policy requires that users in
 * the EEA, the UK and Switzerland are asked for consent before a personalised
 * ad is served, through a Google-certified Consent Management Platform. UMP is
 * Google's own CMP and ships inside `react-native-google-mobile-ads`. Serving
 * ads to those users without it breaks the AdMob policy and puts the ad account
 * at risk, independently of anything Play review does.
 *
 * **The order matters.** Consent must be gathered *before* the AdMob SDK is
 * initialised, so the SDK knows what it may request. `AdService.initialize()`
 * awaits this first and does not start if `canRequestAds` is false.
 *
 * **Outside the EEA** UMP reports `NOT_REQUIRED`, no form is shown, and
 * `canRequestAds` is true. Nobody is asked a question their region does not
 * require — the geography decision belongs to UMP, which reads it from the
 * device, not from us. This app never infers a user's region itself.
 */

type AdsModule = typeof import('react-native-google-mobile-ads');

/** What the rest of the app needs to know, without importing the ad SDK. */
export interface ConsentState {
  /** True when the ad SDK may be started and ads requested. */
  canRequestAds: boolean;
  /**
   * True when the user must be offered a way to change their choice later.
   * UMP requires a persistent entry point for these users, which is the
   * "Privacy choices" row on the Account screen.
   */
  privacyOptionsRequired: boolean;
  /** UMP's own status string, surfaced for diagnostics only. */
  status: string;
}

const UNKNOWN: ConsentState = {
  // Refusing to request ads is the safe default: no ad revenue is a survivable
  // state, serving an unconsented ad is not.
  canRequestAds: false,
  privacyOptionsRequired: false,
  status: 'UNKNOWN',
};

let cached: ConsentState = UNKNOWN;
let gathering: Promise<ConsentState> | null = null;

function loadAds(): AdsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-google-mobile-ads') as AdsModule;
  } catch (err) {
    log.warn('Consent', 'The ads module is unavailable in this build', err);
    return null;
  }
}

export function stateFromInfo(info: {
  canRequestAds?: boolean;
  privacyOptionsRequirementStatus?: string;
  status?: string;
}): ConsentState {
  return {
    canRequestAds: info.canRequestAds === true,
    privacyOptionsRequired: info.privacyOptionsRequirementStatus === 'REQUIRED',
    status: info.status ?? 'UNKNOWN',
  };
}

export const ConsentService = {
  /**
   * Asks UMP for the user's consent status, showing its form when the user's
   * region requires one. Safe to call repeatedly; concurrent callers await the
   * same request.
   */
  async gather(): Promise<ConsentState> {
    if (Platform.OS !== 'android') return UNKNOWN;
    if (gathering) return gathering;

    gathering = (async () => {
      const sdk = loadAds();
      if (!sdk) return UNKNOWN;

      try {
        // gatherConsent() requests the latest info and presents the form if,
        // and only if, the user's region requires one.
        const info = await sdk.AdsConsent.gatherConsent();
        cached = stateFromInfo(info);
        log.debug('Consent', `UMP status ${cached.status}, ads ${cached.canRequestAds}`);
        return cached;
      } catch (err) {
        // A consent failure must never block the app. It blocks *ads*, which
        // is the conservative side of the error.
        log.warn('Consent', 'Could not gather consent; ads stay off', err);
        cached = UNKNOWN;
        return cached;
      } finally {
        gathering = null;
      }
    })();

    return gathering;
  },

  /** The last known state, without touching the SDK. */
  current(): ConsentState {
    return cached;
  },

  /**
   * Re-opens UMP's privacy form so the user can change or withdraw consent.
   * Required by UMP for any user whose `privacyOptionsRequired` is true.
   */
  async showPrivacyOptions(): Promise<ConsentState> {
    const sdk = loadAds();
    if (!sdk) return cached;

    try {
      const info = await sdk.AdsConsent.showPrivacyOptionsForm();
      cached = stateFromInfo(info);
      return cached;
    } catch (err) {
      log.warn('Consent', 'The privacy options form could not be shown', err);
      return cached;
    }
  },

  /** Test seam. */
  __reset(): void {
    cached = UNKNOWN;
    gathering = null;
  },

  /** Test seam: lets the ad tests drive a consent outcome. */
  __setState(state: ConsentState): void {
    cached = state;
  },
};
