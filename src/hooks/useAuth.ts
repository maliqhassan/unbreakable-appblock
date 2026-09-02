import { useCallback } from 'react';

import { AuthService } from '../services/AuthService';
import { useAuthStore } from '../store/useAuthStore';
import type { AuthUser } from '../types';

export interface UseAuth {
  user: AuthUser | null;
  isAuthenticated: boolean;
  /** True while the first auth-state callback is still pending. */
  isLoading: boolean;
  /** True when the user explicitly chose to continue without an account. */
  isGuest: boolean;
  /** False when this build ships no Firebase configuration. */
  isAvailable: boolean;
  isGoogleAvailable: boolean;
  isEmailAvailable: boolean;

  signInWithGoogle: () => Promise<AuthUser>;
  sendEmailLink: (email: string) => Promise<void>;
  completeEmailSignIn: (link: string, email?: string) => Promise<AuthUser>;
  continueAsGuest: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Play requires an in-app path to delete the account. */
  deleteAccount: () => Promise<void>;
}

/**
 * The one way the app asks who is signed in.
 *
 * Screens never import Firebase or `AuthService` directly, for the same reason
 * they never import RevenueCat: one place to change when the provider changes.
 *
 * Note what this hook does NOT expose — anything about Pro. Entitlement comes
 * from `useSubscription()`, and the two are deliberately not merged.
 */
export function useAuth(): UseAuth {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const guest = useAuthStore((s) => s.guest);
  const available = useAuthStore((s) => s.available);

  const google = useAuthStore((s) => s.signInWithGoogle);
  const email = useAuthStore((s) => s.sendEmailLink);
  const complete = useAuthStore((s) => s.completeEmailSignIn);
  const guestMode = useAuthStore((s) => s.continueAsGuest);
  const out = useAuthStore((s) => s.signOut);
  const remove = useAuthStore((s) => s.deleteAccount);

  return {
    user,
    isAuthenticated: user != null,
    isLoading: loading,
    isGuest: user == null && guest,
    isAvailable: available,
    isGoogleAvailable: AuthService.isGoogleConfigured(),
    isEmailAvailable: AuthService.isEmailConfigured(),
    signInWithGoogle: useCallback(() => google(), [google]),
    sendEmailLink: useCallback((address: string) => email(address), [email]),
    completeEmailSignIn: useCallback(
      (link: string, address?: string) => complete(link, address),
      [complete]
    ),
    continueAsGuest: useCallback(() => guestMode(), [guestMode]),
    signOut: useCallback(() => out(), [out]),
    deleteAccount: useCallback(() => remove(), [remove]),
  };
}
