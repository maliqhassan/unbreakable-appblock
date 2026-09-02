/**
 * Short lines shown during an active lock, in the app and on the block screen.
 *
 * Deliberately about the user's own intent rather than about the lock: someone
 * who just hit a wall does not need to be told what the app is doing, they need
 * a reason to walk away from it.
 */
export const FOCUS_QUOTES = [
  'Be productive. Focus on your goal.',
  'The work you do now is the life you get later.',
  'Deep work beats busy work.',
  'You chose this. Stay with it.',
  'Small sessions, compounded, become everything.',
  'Attention is the rarest thing you own.',
  'One thing at a time, done properly.',
  'Discipline is choosing what you want most over what you want now.',
  'Nothing out there is more interesting than what you set out to do.',
  'Finish what you started.',
  'Your future self is watching.',
  'Progress is quiet. Keep going.',
] as const;

/**
 * A stable quote for a given session.
 *
 * Seeded by the session id so it does not shuffle on every re-render — a line
 * that changes each second would be noise, not encouragement.
 */
export function quoteForSession(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return FOCUS_QUOTES[Math.abs(hash) % FOCUS_QUOTES.length];
}
