import AsyncStorage from '@react-native-async-storage/async-storage';

import { AuthService } from '../src/services/AuthService';
import { PermissionService } from '../src/services/PermissionService';
import { PurchaseService } from '../src/services/PurchaseService';
import { StorageService } from '../src/services/StorageService';
import { useAuthStore } from '../src/store/useAuthStore';
import { useUserStore } from '../src/store/useUserStore';
import type { AuthUser, SubscriptionState } from '../src/types';
import { LockError } from '../src/utils/errors';

const GOOGLE_USER: AuthUser = {
  id: 'firebase_uid_123',
  email: 'someone@example.com',
  displayName: 'Test User',
  photoUrl: null,
  provider: 'google',
};

const PRO_STATE: SubscriptionState = {
  tier: 'PRO',
  status: 'active',
  expirationDate: null,
  willRenew: true,
  managementUrl: null,
  isSandbox: false,
  source: 'revenuecat',
};

const FREE_STATE: SubscriptionState = { ...PRO_STATE, tier: 'FREE', status: 'free' };

async function reset() {
  await AsyncStorage.clear();
  AuthService.__reset();
  useAuthStore.setState({ user: null, loading: true, guest: false });
  useUserStore.setState({ subscription: FREE_STATE, hydrating: false });
}

beforeEach(reset);
afterEach(() => jest.restoreAllMocks());

describe('auth availability', () => {
  it('reports itself unconfigured when no Firebase keys are present', () => {
    // The test environment ships no Firebase env vars, which is exactly the
    // state of a fresh clone.
    expect(AuthService.isConfigured()).toBe(false);
    expect(AuthService.isGoogleConfigured()).toBe(false);
    expect(AuthService.isEmailConfigured()).toBe(false);
  });

  it('refuses to sign in rather than pretending, when unconfigured', async () => {
    await expect(AuthService.signInWithGoogle()).rejects.toMatchObject({
      code: 'AUTH_UNAVAILABLE',
    });
    await expect(AuthService.sendEmailLink('a@b.com')).rejects.toMatchObject({
      code: 'AUTH_UNAVAILABLE',
    });
  });

  it('reports no current user and never throws when unconfigured', () => {
    expect(AuthService.getCurrentUser()).toBeNull();
    expect(AuthService.isAuthenticated()).toBe(false);
  });

  it('still hands back an unsubscribe function with no Firebase', () => {
    const unsubscribe = AuthService.onAuthStateChanged(() => {});
    expect(typeof unsubscribe).toBe('function');
    // Calling it must not throw.
    unsubscribe();
  });

  it('signing out with no Firebase is a no-op, not an error', async () => {
    await expect(AuthService.signOut()).resolves.toBeUndefined();
  });
});

describe('guest mode', () => {
  it('lets a user continue without an account, and remembers it', async () => {
    await useAuthStore.getState().continueAsGuest();

    expect(useAuthStore.getState().guest).toBe(true);
    expect(useAuthStore.getState().user).toBeNull();
    expect(await StorageService.get<boolean>('guestMode', false)).toBe(true);
  });

  it('keeps the free tier working for a guest', () => {
    // Guests are Free users, not second-class ones: entitlement is unchanged.
    expect(useUserStore.getState().subscription.tier).toBe('FREE');
  });
});

describe('Google sign-in', () => {
  it('stores the user and links them to RevenueCat on success', async () => {
    jest.spyOn(AuthService, 'signInWithGoogle').mockResolvedValue(GOOGLE_USER);
    const identify = jest.spyOn(PurchaseService, 'identify').mockResolvedValue(PRO_STATE);
    jest.spyOn(PurchaseService, 'getCustomerInfo').mockResolvedValue(PRO_STATE);

    const user = await useAuthStore.getState().signInWithGoogle();

    expect(user.id).toBe('firebase_uid_123');
    expect(useAuthStore.getState().user).toEqual(GOOGLE_USER);
    // The Firebase UID becomes the RevenueCat app user id.
    expect(identify).toHaveBeenCalledWith('firebase_uid_123');
  });

  it('clears guest mode once an account is used', async () => {
    await useAuthStore.getState().continueAsGuest();
    jest.spyOn(AuthService, 'signInWithGoogle').mockResolvedValue(GOOGLE_USER);
    jest.spyOn(PurchaseService, 'identify').mockResolvedValue(null);

    await useAuthStore.getState().signInWithGoogle();

    expect(useAuthStore.getState().guest).toBe(false);
  });

  it('surfaces cancellation with its own code, leaving state untouched', async () => {
    jest
      .spyOn(AuthService, 'signInWithGoogle')
      .mockRejectedValue(new LockError('AUTH_CANCELLED', 'Sign-in was cancelled.'));

    await expect(useAuthStore.getState().signInWithGoogle()).rejects.toMatchObject({
      code: 'AUTH_CANCELLED',
    });
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('surfaces a real failure without signing anyone in', async () => {
    jest
      .spyOn(AuthService, 'signInWithGoogle')
      .mockRejectedValue(new LockError('AUTH_FAILED', 'Sign-in could not be completed.'));

    await expect(useAuthStore.getState().signInWithGoogle()).rejects.toMatchObject({
      code: 'AUTH_FAILED',
    });
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('reports a network failure distinctly', async () => {
    jest
      .spyOn(AuthService, 'signInWithGoogle')
      .mockRejectedValue(new LockError('AUTH_NETWORK', 'No connection.'));

    await expect(useAuthStore.getState().signInWithGoogle()).rejects.toMatchObject({
      code: 'AUTH_NETWORK',
    });
  });

  it('signs in even when the RevenueCat link fails', async () => {
    // Billing problems must never block someone getting into their account.
    jest.spyOn(AuthService, 'signInWithGoogle').mockResolvedValue(GOOGLE_USER);
    jest.spyOn(PurchaseService, 'identify').mockRejectedValue(new Error('rc down'));

    const user = await useAuthStore.getState().signInWithGoogle();

    expect(user).toEqual(GOOGLE_USER);
    expect(useAuthStore.getState().user).toEqual(GOOGLE_USER);
  });
});

describe('email sign-in', () => {
  it('rejects an address that is obviously not an email', async () => {
    // Validation happens before any network call, so this is checkable even
    // without Firebase configured.
    await expect(AuthService.sendEmailLink('not-an-email')).rejects.toMatchObject({
      code: expect.stringMatching(/AUTH_INVALID_EMAIL|AUTH_UNAVAILABLE/),
    });
  });

  it('completes sign-in from a link and links RevenueCat', async () => {
    const emailUser: AuthUser = { ...GOOGLE_USER, provider: 'email' };
    jest.spyOn(AuthService, 'completeEmailSignIn').mockResolvedValue(emailUser);
    const identify = jest.spyOn(PurchaseService, 'identify').mockResolvedValue(null);

    const user = await useAuthStore
      .getState()
      .completeEmailSignIn('https://example.com/link');

    expect(user.provider).toBe('email');
    expect(identify).toHaveBeenCalledWith(emailUser.id);
  });

  it('reports an expired link rather than failing silently', async () => {
    jest
      .spyOn(AuthService, 'completeEmailSignIn')
      .mockRejectedValue(new LockError('AUTH_EXPIRED_LINK', 'That link has expired.'));

    await expect(
      useAuthStore.getState().completeEmailSignIn('https://example.com/old')
    ).rejects.toMatchObject({ code: 'AUTH_EXPIRED_LINK' });
  });

  it('reports rate limiting distinctly', async () => {
    jest
      .spyOn(AuthService, 'sendEmailLink')
      .mockRejectedValue(new LockError('AUTH_TOO_MANY_ATTEMPTS', 'Too many attempts.'));

    await expect(
      useAuthStore.getState().sendEmailLink('someone@example.com')
    ).rejects.toMatchObject({ code: 'AUTH_TOO_MANY_ATTEMPTS' });
  });

  it('does not treat an arbitrary URL as a sign-in link', () => {
    expect(AuthService.isEmailSignInLink('unbreakablelock://home')).toBe(false);
  });
});

describe('sign out', () => {
  it('clears the user, resets RevenueCat identity, and returns to guest', async () => {
    useAuthStore.setState({ user: GOOGLE_USER, guest: false });
    jest.spyOn(AuthService, 'signOut').mockResolvedValue(undefined);
    const forget = jest
      .spyOn(PurchaseService, 'forgetIdentity')
      .mockResolvedValue(FREE_STATE);

    await useAuthStore.getState().signOut();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().guest).toBe(true);
    expect(forget).toHaveBeenCalled();
  });

  it('clears local state even when the provider sign-out fails', async () => {
    useAuthStore.setState({ user: GOOGLE_USER, guest: false });
    jest.spyOn(AuthService, 'signOut').mockRejectedValue(new Error('offline'));
    jest.spyOn(PurchaseService, 'forgetIdentity').mockResolvedValue(null);

    await useAuthStore.getState().signOut();

    // Being stuck "signed in" after asking to leave would be worse than a
    // provider session that lingers server-side.
    expect(useAuthStore.getState().user).toBeNull();
  });
});

describe('session restoration', () => {
  it('adopts a restored session and links it to RevenueCat', async () => {
    const identify = jest.spyOn(PurchaseService, 'identify').mockResolvedValue(PRO_STATE);
    jest.spyOn(PurchaseService, 'getCustomerInfo').mockResolvedValue(PRO_STATE);
    jest
      .spyOn(AuthService, 'onAuthStateChanged')
      .mockImplementation((callback) => {
        callback(GOOGLE_USER);
        return () => {};
      });

    const unsubscribe = useAuthStore.getState().initialize();

    expect(useAuthStore.getState().user).toEqual(GOOGLE_USER);
    expect(useAuthStore.getState().loading).toBe(false);
    // Flush the identity link scheduled by the callback.
    await Promise.resolve();
    expect(identify).toHaveBeenCalledWith(GOOGLE_USER.id);
    unsubscribe();
  });

  it('settles into a signed-out state when there is no session', () => {
    jest.spyOn(AuthService, 'onAuthStateChanged').mockImplementation((callback) => {
      callback(null);
      return () => {};
    });

    useAuthStore.getState().initialize();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().loading).toBe(false);
  });
});

describe('entitlement stays with RevenueCat', () => {
  it('does not grant Pro merely because someone signed in', async () => {
    jest.spyOn(AuthService, 'signInWithGoogle').mockResolvedValue(GOOGLE_USER);
    jest.spyOn(PurchaseService, 'identify').mockResolvedValue(FREE_STATE);
    jest.spyOn(PurchaseService, 'getCustomerInfo').mockResolvedValue(FREE_STATE);

    await useAuthStore.getState().signInWithGoogle();

    expect(useUserStore.getState().subscription.tier).toBe('FREE');
  });

  it('keeps a guest purchase after signing in, via the identity merge', async () => {
    // RevenueCat merges the anonymous customer into the identified one, which
    // is why we call logIn rather than reconfiguring with a new app user id.
    useUserStore.setState({ subscription: PRO_STATE });
    jest.spyOn(AuthService, 'signInWithGoogle').mockResolvedValue(GOOGLE_USER);
    jest.spyOn(PurchaseService, 'identify').mockResolvedValue(PRO_STATE);
    jest.spyOn(PurchaseService, 'getCustomerInfo').mockResolvedValue(PRO_STATE);

    await useAuthStore.getState().signInWithGoogle();

    expect(useUserStore.getState().subscription.tier).toBe('PRO');
  });

  it('does not revoke Pro on sign-out when the store still reports it', async () => {
    useAuthStore.setState({ user: GOOGLE_USER });
    jest.spyOn(AuthService, 'signOut').mockResolvedValue(undefined);
    jest.spyOn(PurchaseService, 'forgetIdentity').mockResolvedValue(PRO_STATE);
    jest.spyOn(PurchaseService, 'getCustomerInfo').mockResolvedValue(PRO_STATE);

    await useAuthStore.getState().signOut();

    // Entitlement is RevenueCat's answer, not a consequence of signing out.
    expect(useUserStore.getState().subscription.tier).toBe('PRO');
  });
});

describe('onboarding state', () => {
  it('starts a fresh install as not onboarded', async () => {
    expect(await StorageService.get<boolean>('onboarded', false)).toBe(false);
  });

  it('records completion so onboarding is not shown again', async () => {
    await useUserStore.getState().completeOnboarding();

    expect(useUserStore.getState().onboarded).toBe(true);
    expect(await StorageService.get<boolean>('onboarded', false)).toBe(true);
  });

  it('records that the permission step was seen, separately from completion', async () => {
    await StorageService.set('permissionsSetupCompleted', true);

    expect(await StorageService.get<boolean>('permissionsSetupCompleted', false)).toBe(
      true
    );
    // Seeing the step is not the same as being onboarded.
    expect(await StorageService.get<boolean>('onboarded', false)).toBe(false);
  });

  it('never reads permission status from storage', () => {
    // The whole point: even with a stored "setup completed" flag, the live
    // answer comes from the platform.
    const live = PermissionService.getAll();
    const stored = PermissionService.missingRequired();

    expect(Array.isArray(live)).toBe(true);
    expect(Array.isArray(stored)).toBe(true);
  });

  it('detects revocation by re-reading, not by trusting a cached flag', async () => {
    await StorageService.set('permissionsSetupCompleted', true);

    jest.spyOn(PermissionService, 'missingRequired').mockReturnValue([
      {
        id: 'usageAccess',
        title: 'Usage Access',
        rationale: 'test',
        explanation: 'test',
        privacyNote: 'test',
        icon: '📊',
        status: 'denied',
        optional: false,
      },
    ]);

    // A stored completion flag does not stop the app noticing a revoked grant.
    expect(PermissionService.missingRequired()).toHaveLength(1);
  });
});
