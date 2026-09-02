import { create } from 'zustand';

import { AuthService } from '../services/AuthService';
import { PurchaseService } from '../services/PurchaseService';
import { StorageService } from '../services/StorageService';
import { useUserStore } from './useUserStore';
import type { AuthUser } from '../types';
import { toLockError } from '../utils/errors';
import { log } from '../utils/logger';

/**
 * Who is signed in.
 *
 * Strictly separate from entitlement: this store answers "who is this?", and
 * `useUserStore` / RevenueCat answers "what have they paid for?". Nothing here
 * ever sets a Pro flag.
 *
 * The one place the two meet is identity linking — after sign-in we tell
 * RevenueCat the Firebase UID so purchases follow the account.
 */
interface AuthState {
  user: AuthUser | null;
  /** True until the first auth-state callback arrives. */
  loading: boolean;
  /** True when the user explicitly chose to continue without an account. */
  guest: boolean;
  /** False when this build has no Firebase configuration at all. */
  available: boolean;

  initialize: () => () => void;
  signInWithGoogle: () => Promise<AuthUser>;
  sendEmailLink: (email: string) => Promise<void>;
  completeEmailSignIn: (link: string, email?: string) => Promise<AuthUser>;
  continueAsGuest: () => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

/**
 * Links the signed-in user to RevenueCat, then refreshes entitlement.
 *
 * Order matters: identify first so the refresh reads the right customer.
 */
async function linkIdentity(user: AuthUser): Promise<void> {
  try {
    await PurchaseService.identify(user.id);
  } catch (err) {
    // Never block sign-in on a billing round trip.
    log.warn('Auth', 'RevenueCat identity link failed; entitlement unchanged', err);
  }
  await useUserStore.getState().refreshEntitlement();
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  guest: false,
  available: AuthService.isConfigured(),

  /**
   * Starts listening for sign-in changes.
   *
   * @returns the unsubscribe function, for the caller's effect cleanup.
   */
  initialize() {
    void StorageService.get<boolean>('guestMode', false).then((guest) =>
      set({ guest })
    );

    return AuthService.onAuthStateChanged((user) => {
      set({ user, loading: false });

      // A restored session on cold start also needs its RevenueCat link, since
      // the SDK may have been configured anonymously before Firebase resolved.
      if (user) void linkIdentity(user);
    });
  },

  async signInWithGoogle() {
    try {
      const user = await AuthService.signInWithGoogle();
      set({ user, guest: false });
      await StorageService.set('guestMode', false);
      await linkIdentity(user);
      return user;
    } catch (err) {
      throw toLockError(err);
    }
  },

  async sendEmailLink(email) {
    try {
      await AuthService.sendEmailLink(email);
    } catch (err) {
      throw toLockError(err);
    }
  },

  async completeEmailSignIn(link, email) {
    try {
      const user = await AuthService.completeEmailSignIn(link, email);
      set({ user, guest: false });
      await StorageService.set('guestMode', false);
      await linkIdentity(user);
      return user;
    } catch (err) {
      throw toLockError(err);
    }
  },

  async continueAsGuest() {
    set({ guest: true });
    await StorageService.set('guestMode', true);
  },

  /**
   * Deletes the account and the personal data held on the device with it.
   *
   * Play's deletion policy is about the *data*, not just the login, so this
   * clears what the account touched — the app choices, schedules and daily
   * limits — rather than only removing the Firebase user and leaving the
   * device looking exactly as it did.
   *
   * Deliberately left alone: any lock currently running. Deleting an account
   * is not a supported way to escape a Strict Mode session, and a native lock
   * is enforced by the service, not by the account.
   */
  async deleteAccount() {
    // If this throws, nothing has been deleted yet and the error reaches the
    // UI. Clearing local data first would leave someone with a wiped device
    // and an account that still exists.
    await AuthService.deleteAccount();

    await PurchaseService.forgetIdentity();
    await useUserStore.getState().refreshEntitlement();

    for (const key of ['selectedApps', 'schedules', 'dailyLimits'] as const) {
      await StorageService.remove(key);
    }

    set({ user: null, guest: true });
    await StorageService.set('guestMode', true);
  },

  async signOut() {
    try {
      await AuthService.signOut();
    } catch (err) {
      log.warn('Auth', 'Sign-out reported an error; clearing local state anyway', err);
    }

    // Back to an anonymous RevenueCat customer. Purchases stay attached to the
    // account that made them and return when the user signs back in.
    await PurchaseService.forgetIdentity();
    await useUserStore.getState().refreshEntitlement();

    set({ user: null, guest: true });
    await StorageService.set('guestMode', true);
  },
}));

/** True when the user has either signed in or explicitly chosen guest mode. */
export function hasChosenAccountState(): boolean {
  const { user, guest } = useAuthStore.getState();
  return user != null || guest;
}
