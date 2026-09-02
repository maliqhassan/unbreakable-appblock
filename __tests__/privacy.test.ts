import AsyncStorage from '@react-native-async-storage/async-storage';

import { ACCOUNT_DELETION_URL, hasLink, PRIVACY_POLICY_URL } from '../src/constants/legal';
import { AuthService } from '../src/services/AuthService';
import { ConsentService, stateFromInfo } from '../src/services/ConsentService';
import { PurchaseService } from '../src/services/PurchaseService';
import { StorageService } from '../src/services/StorageService';
import { useAuthStore } from '../src/store/useAuthStore';
import { LockError } from '../src/utils/errors';

beforeEach(async () => {
  await AsyncStorage.clear();
  ConsentService.__reset();
  useAuthStore.setState({
    user: { id: 'u1', email: 'a@b.com', displayName: 'A', photoUrl: null, provider: 'google' },
    guest: false,
    loading: false,
  });
});

afterEach(() => jest.restoreAllMocks());

describe('ad consent (Google UMP)', () => {
  it('refuses to request ads until consent has actually been gathered', () => {
    // The default must be "no ads", not "ads until told otherwise" — an
    // unconsented personalised ad is the violation this exists to prevent.
    expect(ConsentService.current().canRequestAds).toBe(false);
    expect(ConsentService.current().status).toBe('UNKNOWN');
  });

  it('allows ads once UMP reports consent obtained', () => {
    const state = stateFromInfo({
      canRequestAds: true,
      status: 'OBTAINED',
      privacyOptionsRequirementStatus: 'REQUIRED',
    });

    expect(state.canRequestAds).toBe(true);
    expect(state.privacyOptionsRequired).toBe(true);
  });

  it('allows ads outside the EEA, where no form is required', () => {
    // UMP decides this from the device's own geography. The app never infers a
    // region itself.
    const state = stateFromInfo({
      canRequestAds: true,
      status: 'NOT_REQUIRED',
      privacyOptionsRequirementStatus: 'NOT_REQUIRED',
    });

    expect(state.canRequestAds).toBe(true);
    // No ongoing "privacy choices" entry point is required for these users.
    expect(state.privacyOptionsRequired).toBe(false);
  });

  it('blocks ads when consent is required but not yet given', () => {
    const state = stateFromInfo({
      canRequestAds: false,
      status: 'REQUIRED',
      privacyOptionsRequirementStatus: 'REQUIRED',
    });

    expect(state.canRequestAds).toBe(false);
  });

  it('treats a malformed or empty UMP response as no consent', () => {
    expect(stateFromInfo({}).canRequestAds).toBe(false);
    expect(stateFromInfo({}).status).toBe('UNKNOWN');
  });
});

describe('legal links', () => {
  it('treats an unconfigured URL as absent, so no dead link is shown', () => {
    expect(hasLink('')).toBe(false);
    expect(hasLink('   ')).toBe(false);
    expect(hasLink('https://example.com/privacy')).toBe(true);
  });
});

describe('account deletion (Play User Data policy)', () => {
  it('deletes the account and clears the data it created on the device', async () => {
    jest.spyOn(AuthService, 'deleteAccount').mockResolvedValue(undefined);
    jest.spyOn(PurchaseService, 'forgetIdentity').mockResolvedValue(null);
    await StorageService.set('selectedApps', [{ id: 'com.x', name: 'X' }]);
    await StorageService.set('schedules', [{ id: 's1' }]);
    await StorageService.set('dailyLimits', [{ id: 'd1' }]);

    await useAuthStore.getState().deleteAccount();

    expect(await StorageService.get('selectedApps', null)).toBeNull();
    expect(await StorageService.get('schedules', null)).toBeNull();
    expect(await StorageService.get('dailyLimits', null)).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('detaches the RevenueCat identity so the next user is not linked to it', async () => {
    jest.spyOn(AuthService, 'deleteAccount').mockResolvedValue(undefined);
    const forget = jest.spyOn(PurchaseService, 'forgetIdentity').mockResolvedValue(null);

    await useAuthStore.getState().deleteAccount();

    expect(forget).toHaveBeenCalled();
  });

  it('keeps the local data when the deletion itself fails', async () => {
    // Wiping the device while the account still exists would be the worst of
    // both outcomes.
    jest
      .spyOn(AuthService, 'deleteAccount')
      .mockRejectedValue(new LockError('AUTH_REAUTH_REQUIRED', 'Sign in again.'));
    await StorageService.set('selectedApps', [{ id: 'com.x', name: 'X' }]);

    await expect(useAuthStore.getState().deleteAccount()).rejects.toMatchObject({
      code: 'AUTH_REAUTH_REQUIRED',
    });

    expect(await StorageService.get('selectedApps', null)).not.toBeNull();
    expect(useAuthStore.getState().user).not.toBeNull();
  });

  it('reports a stale sign-in as its own code, so the UI can ask for a re-login', async () => {
    jest
      .spyOn(AuthService, 'deleteAccount')
      .mockRejectedValue(new LockError('AUTH_REAUTH_REQUIRED', 'Sign in again.'));

    await expect(useAuthStore.getState().deleteAccount()).rejects.toMatchObject({
      code: 'AUTH_REAUTH_REQUIRED',
    });
  });
});

describe('the privacy links are always reachable', () => {
  it('always resolves a privacy policy URL', () => {
    // The Account screen used to render a Privacy card with nothing in it,
    // because the link was hidden whenever the env var was unset — and a build
    // with no reachable policy is a Play listing rejection, not a warning.
    expect(hasLink(PRIVACY_POLICY_URL)).toBe(true);
    expect(PRIVACY_POLICY_URL).toMatch(/^https:\/\//);
  });

  it('always resolves an account deletion URL', () => {
    expect(hasLink(ACCOUNT_DELETION_URL)).toBe(true);
    expect(ACCOUNT_DELETION_URL).toMatch(/^https:\/\//);
  });

  it('points the two links at different pages', () => {
    expect(PRIVACY_POLICY_URL).not.toBe(ACCOUNT_DELETION_URL);
  });
});

describe('agreeing before an account is created', () => {
  /** Mirrors the gate in AuthScreen: consent is asked once, and only for accounts. */
  function needsConsent(method: 'google' | 'email' | 'guest', consentedAt: number) {
    if (method === 'guest') return false;
    return consentedAt === 0;
  }

  it('asks before a first sign-in', () => {
    expect(needsConsent('google', 0)).toBe(true);
    expect(needsConsent('email', 0)).toBe(true);
  });

  it('does not ask a guest', () => {
    // A guest creates no account and hands over nothing, so there is nothing to
    // agree to. A gate there would be consent theatre.
    expect(needsConsent('guest', 0)).toBe(false);
  });

  it('asks once, not at every sign-in', () => {
    expect(needsConsent('google', 1_700_000_000_000)).toBe(false);
  });

  it('records when the agreement was given', async () => {
    await StorageService.set('accountConsentAt', 1_700_000_000_000);
    expect(await StorageService.get<number>('accountConsentAt', 0)).toBe(1_700_000_000_000);
  });

  it('starts with no agreement recorded', async () => {
    expect(await StorageService.get<number>('accountConsentAt', 0)).toBe(0);
  });
});
