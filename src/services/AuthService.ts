import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AuthUser } from '../types';
import { LockError } from '../utils/errors';
import { log } from '../utils/logger';

/**
 * Authentication, behind one interface.
 *
 * Firebase is imported **only** here. Screens and stores talk to this service,
 * so swapping providers or adding a backend later touches one file.
 *
 * Two deliberate constraints:
 *
 *  1. **No passwords, ever.** Google's own account picker, or Firebase's
 *     passwordless email link. This app never sees, stores, or transmits a
 *     credential, and there is no custom auth cryptography anywhere.
 *
 *  2. **Auth answers "who is this?", never "what did they pay for?"** Pro
 *     entitlement stays entirely with RevenueCat. Nothing here writes an
 *     `isPro` flag.
 *
 * ---
 *
 * ### Email: link, not a numeric code
 *
 * Firebase Authentication has **no email OTP mechanism**. Its supported
 * passwordless email method is `sendSignInLinkToEmail` — a one-time sign-in
 * link. There is no officially supported 6-digit email code, and building one
 * would mean running our own mail service and code store, i.e. exactly the
 * custom auth backend this sprint rules out. So the UI asks the user to open a
 * link from their inbox rather than pretending a code exists.
 *
 * ### Degrading without configuration
 *
 * With no Firebase env vars set, `isConfigured()` is false and every sign-in
 * method rejects with AUTH_UNAVAILABLE. Guest mode keeps working, so a fresh
 * clone still runs the whole app.
 */

type FirebaseApp = import('firebase/app').FirebaseApp;
type Auth = import('firebase/auth').Auth;
type FirebaseUser = import('firebase/auth').User;

const CONFIG = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
};

/** OAuth web client id from the Firebase console, needed by Google Sign-In. */
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';

/**
 * Where the email link sends the user back to.
 *
 * Firebase Dynamic Links reached end-of-life in August 2025, so email-link
 * sign-in now relies on an ordinary continue URL that deep-links into the app.
 * See AUTH.md for the console configuration this requires.
 */
const EMAIL_LINK_CONTINUE_URL =
  process.env.EXPO_PUBLIC_FIREBASE_EMAIL_CONTINUE_URL ?? '';

/** Key for the pending email; the link alone is not enough to complete sign-in. */
const PENDING_EMAIL_KEY = 'ul.auth.pendingEmail';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let initialised = false;

function isConfigured(): boolean {
  return CONFIG.apiKey !== '' && CONFIG.projectId !== '' && CONFIG.appId !== '';
}

/**
 * Creates the Firebase app and auth instance once.
 *
 * Persistence uses AsyncStorage so a session survives a restart. The RN build
 * of firebase/auth exports `getReactNativePersistence`; the Node build (Jest)
 * does not, so its absence falls back rather than throwing.
 */
function ensureAuth(): Auth | null {
  if (initialised) return auth;
  initialised = true;

  if (!isConfigured()) {
    log.warn('Auth', 'Firebase is not configured; sign-in is disabled.');
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { initializeApp, getApps, getApp } = require('firebase/app');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const firebaseAuth = require('firebase/auth');

    app = getApps().length > 0 ? getApp() : initializeApp(CONFIG);

    const getReactNativePersistence = firebaseAuth.getReactNativePersistence as
      | ((storage: unknown) => unknown)
      | undefined;

    if (getReactNativePersistence) {
      auth = firebaseAuth.initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage),
      });
    } else {
      auth = firebaseAuth.getAuth(app);
    }

    return auth;
  } catch (err) {
    log.error('Auth', 'Firebase initialisation failed; sign-in is disabled', err);
    auth = null;
    return null;
  }
}

function requireAuth(): Auth {
  const instance = ensureAuth();
  if (!instance) {
    throw new LockError(
      'AUTH_UNAVAILABLE',
      'Sign-in is not configured in this build. You can keep using the app as a guest.'
    );
  }
  return instance;
}

/** Maps a Firebase user onto our own shape, so screens never see a Firebase type. */
function toAuthUser(user: FirebaseUser | null): AuthUser | null {
  if (!user) return null;

  const providerId = user.providerData[0]?.providerId ?? '';
  const provider: AuthUser['provider'] = providerId.includes('google')
    ? 'google'
    : providerId.includes('password') || providerId.includes('email')
      ? 'email'
      : 'anonymous';

  return {
    id: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoUrl: user.photoURL,
    provider,
  };
}

/**
 * Normalises a Firebase error into our own codes.
 *
 * Never includes the raw Firebase message for credential problems: those can
 * echo back input we would rather not surface or log.
 */
function toAuthError(err: unknown): LockError {
  if (err instanceof LockError) return err;

  const code = (err as { code?: string })?.code ?? '';

  if (code.includes('cancel')) return new LockError('AUTH_CANCELLED', 'Sign-in was cancelled.');
  if (code.includes('network-request-failed')) {
    return new LockError('AUTH_NETWORK', 'No connection. Check your network and try again.');
  }
  if (code.includes('invalid-email')) {
    return new LockError('AUTH_INVALID_EMAIL', 'That email address does not look valid.');
  }
  if (code.includes('expired-action-code') || code.includes('invalid-action-code')) {
    return new LockError(
      'AUTH_EXPIRED_LINK',
      'That sign-in link has expired or has already been used. Request a new one.'
    );
  }
  if (code.includes('too-many-requests')) {
    return new LockError(
      'AUTH_TOO_MANY_ATTEMPTS',
      'Too many attempts. Wait a few minutes and try again.'
    );
  }

  log.warn('Auth', `Unmapped auth failure (${code || 'no code'})`);
  return new LockError('AUTH_FAILED', 'Sign-in could not be completed. Please try again.');
}

export const AuthService = {
  isConfigured,

  /** True when Google Sign-In has the client id it needs. */
  isGoogleConfigured(): boolean {
    return isConfigured() && GOOGLE_WEB_CLIENT_ID !== '';
  },

  /** True when the email-link flow has a continue URL configured. */
  isEmailConfigured(): boolean {
    return isConfigured() && EMAIL_LINK_CONTINUE_URL !== '';
  },

  getCurrentUser(): AuthUser | null {
    const instance = ensureAuth();
    return instance ? toAuthUser(instance.currentUser) : null;
  },

  isAuthenticated(): boolean {
    return AuthService.getCurrentUser() != null;
  },

  /**
   * Subscribes to sign-in state.
   *
   * @returns an unsubscribe function. Always returns one, even when Firebase is
   *   absent, so callers never have to null-check a cleanup.
   */
  onAuthStateChanged(callback: (user: AuthUser | null) => void): () => void {
    const instance = ensureAuth();
    if (!instance) {
      callback(null);
      return () => {};
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { onAuthStateChanged } = require('firebase/auth');
      return onAuthStateChanged(instance, (user: FirebaseUser | null) =>
        callback(toAuthUser(user))
      );
    } catch (err) {
      log.warn('Auth', 'Could not subscribe to auth state', err);
      callback(null);
      return () => {};
    }
  },

  /**
   * Google sign-in through Google's own native account picker.
   *
   * The app never renders a Google login form and never touches a password:
   * the native SDK returns an ID token, which Firebase exchanges for a session.
   */
  async signInWithGoogle(): Promise<AuthUser> {
    const instance = requireAuth();

    if (!GOOGLE_WEB_CLIENT_ID) {
      throw new LockError(
        'AUTH_UNAVAILABLE',
        'Google Sign-In is not configured in this build.'
      );
    }

    let googleSignIn: typeof import('@react-native-google-signin/google-signin');
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      googleSignIn = require('@react-native-google-signin/google-signin');
    } catch (err) {
      log.warn('Auth', 'Google Sign-In native module is unavailable', err);
      throw new LockError(
        'AUTH_UNAVAILABLE',
        'Google Sign-In is unavailable in this build.'
      );
    }

    const { GoogleSignin, statusCodes } = googleSignIn;

    try {
      GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

      const result = await GoogleSignin.signIn();

      // The SDK's shape has changed across majors; read defensively rather than
      // assuming one, because a wrong guess here fails only at runtime.
      const idToken =
        (result as { data?: { idToken?: string | null } }).data?.idToken ??
        (result as { idToken?: string | null }).idToken ??
        null;

      if (!idToken) {
        throw new LockError('AUTH_FAILED', 'Google did not return a sign-in token.');
      }

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { GoogleAuthProvider, signInWithCredential } = require('firebase/auth');
      const credential = GoogleAuthProvider.credential(idToken);
      const { user } = await signInWithCredential(instance, credential);

      const authUser = toAuthUser(user);
      if (!authUser) throw new LockError('AUTH_FAILED', 'Sign-in did not return a user.');
      return authUser;
    } catch (err) {
      const statusCode = (err as { code?: string | number })?.code;
      if (
        statusCode === statusCodes.SIGN_IN_CANCELLED ||
        statusCode === statusCodes.IN_PROGRESS
      ) {
        throw new LockError('AUTH_CANCELLED', 'Sign-in was cancelled.');
      }
      if (statusCode === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new LockError(
          'AUTH_UNAVAILABLE',
          'Google Play Services is not available on this device.'
        );
      }
      throw toAuthError(err);
    }
  },

  /**
   * Starts passwordless email sign-in.
   *
   * Firebase emails a one-time link; there is no code to type. The address is
   * stored locally because completing the link requires knowing which email it
   * was sent to — that is Firebase's documented protection against someone
   * completing a link intercepted from another inbox.
   */
  async sendEmailLink(email: string): Promise<void> {
    const instance = requireAuth();

    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      throw new LockError('AUTH_INVALID_EMAIL', 'That email address does not look valid.');
    }
    if (!EMAIL_LINK_CONTINUE_URL) {
      throw new LockError(
        'AUTH_UNAVAILABLE',
        'Email sign-in is not configured in this build.'
      );
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { sendSignInLinkToEmail } = require('firebase/auth');
      await sendSignInLinkToEmail(instance, trimmed, {
        url: EMAIL_LINK_CONTINUE_URL,
        handleCodeInApp: true,
        android: { packageName: 'com.unbreakablelock.app', installApp: false },
      });
      // The address, never the link or any token.
      await AsyncStorage.setItem(PENDING_EMAIL_KEY, trimmed);
    } catch (err) {
      throw toAuthError(err);
    }
  },

  /** The address a link was last sent to, for the "check your email" screen. */
  async getPendingEmail(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(PENDING_EMAIL_KEY);
    } catch {
      return null;
    }
  },

  async clearPendingEmail(): Promise<void> {
    try {
      await AsyncStorage.removeItem(PENDING_EMAIL_KEY);
    } catch {
      // Nothing to do; a stale address is harmless.
    }
  },

  /** True when an incoming deep link is a Firebase sign-in link. */
  isEmailSignInLink(link: string): boolean {
    const instance = ensureAuth();
    if (!instance) return false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { isSignInWithEmailLink } = require('firebase/auth');
      return Boolean(isSignInWithEmailLink(instance, link));
    } catch {
      return false;
    }
  },

  /**
   * Completes email sign-in from the link the user opened.
   *
   * @param link the full deep link. Never logged — it carries a one-time
   *   credential.
   */
  async completeEmailSignIn(link: string, email?: string): Promise<AuthUser> {
    const instance = requireAuth();

    const address = email ?? (await AuthService.getPendingEmail());
    if (!address) {
      throw new LockError(
        'AUTH_FAILED',
        'Enter the email address this link was sent to, then open the link again.'
      );
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { signInWithEmailLink } = require('firebase/auth');
      const { user } = await signInWithEmailLink(instance, address, link);
      await AuthService.clearPendingEmail();

      const authUser = toAuthUser(user);
      if (!authUser) throw new LockError('AUTH_FAILED', 'Sign-in did not return a user.');
      return authUser;
    } catch (err) {
      throw toAuthError(err);
    }
  },

  /**
   * Permanently deletes the signed-in user's account.
   *
   * Google Play's User Data policy requires any app that lets people create an
   * account to also let them delete it *from inside the app*, not only through
   * support. This is that path.
   *
   * Deleting the Firebase user is the whole job: the account holds nothing but
   * an id, and every lock, schedule and daily limit lives in on-device storage,
   * which the caller clears alongside this. There is no server-side profile to
   * clean up because there is no server.
   *
   * Firebase refuses to delete a user whose sign-in is stale, which surfaces as
   * `requires-recent-login`. That is reported as its own error so the UI can
   * ask the person to sign in again rather than showing a generic failure.
   */
  async deleteAccount(): Promise<void> {
    const instance = ensureAuth();
    const current = instance?.currentUser;
    if (!instance || !current) {
      throw new LockError('AUTH_FAILED', 'There is no signed-in account to delete.');
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { deleteUser } = require('firebase/auth');
      await deleteUser(current);
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      if (code.includes('requires-recent-login')) {
        throw new LockError(
          'AUTH_REAUTH_REQUIRED',
          'For your security, please sign in again before deleting your account.'
        );
      }
      throw toAuthError(err);
    }

    // Clear the Google session too, so a later sign-in shows the picker rather
    // than silently recreating an account the user just deleted.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { GoogleSignin } = require('@react-native-google-signin/google-signin');
      await GoogleSignin.signOut();
    } catch {
      // Not signed in with Google, or the module is absent. Not a failure.
    }

    await AuthService.clearPendingEmail();
  },

  async signOut(): Promise<void> {
    const instance = ensureAuth();
    if (!instance) return;

    // Sign out of Google too, so the next sign-in shows the account picker
    // rather than silently reusing the last account.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { GoogleSignin } = require('@react-native-google-signin/google-signin');
      await GoogleSignin.signOut();
    } catch {
      // Not signed in with Google, or the module is absent. Not a failure.
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { signOut } = require('firebase/auth');
      await signOut(instance);
      await AuthService.clearPendingEmail();
    } catch (err) {
      throw toAuthError(err);
    }
  },

  /** Test seam: forces re-initialisation between cases. */
  __reset(): void {
    app = null;
    auth = null;
    initialised = false;
  },
};
