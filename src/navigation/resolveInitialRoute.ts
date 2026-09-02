import type { LockSession } from '../types';
import type { RootStackParamList } from './types';

export interface RoutingInput {
  /** The restored session, if any. Native is the authority for this. */
  session: LockSession | null;
  /** Whether the user has finished (or explicitly skipped) onboarding. */
  onboarded: boolean;
}

/**
 * Decides where the app opens.
 *
 * Extracted from the navigator and kept pure so the priority order is
 * testable — routing bugs here are the kind that only show up on a real
 * device, at launch, in front of a user.
 *
 * Priority, highest first:
 *
 *  1. **An active lock.** Always. Someone who set a strict two-hour session and
 *     reopened the app must land on the countdown, not on a setup flow. Showing
 *     onboarding over a running lock would look exactly like the lock had been
 *     lost, which is the single worst thing this app can do.
 *  2. **Onboarding**, if it has never been completed.
 *  3. **Home.**
 *
 * Note what is deliberately *not* here: permission state. A user with missing
 * permissions still lands on Home — with a warning — rather than being trapped
 * in a setup flow they already chose to skip. The requirements gate stops the
 * lock later, at the point where it actually matters.
 */
export function resolveInitialRoute({
  session,
  onboarded,
}: RoutingInput): keyof RootStackParamList {
  const lockIsRunning = session?.status === 'active' || session?.status === 'preparing';
  if (lockIsRunning) return 'ActiveLock';

  if (!onboarded) return 'OnboardingWelcome';

  return 'Home';
}
