/**
 * Links Google Play requires a published app to expose.
 *
 * Both are read from the environment rather than hardcoded, because the policy
 * has to be hosted somewhere the developer controls and reachable from the Play
 * listing as well as from inside the app. `PRIVACY_POLICY.md` in this repository
 * is the text to publish; the URL it ends up at goes here.
 *
 * Play requires a privacy policy URL for any app that handles personal or
 * sensitive data, which this one does the moment it reads usage statistics —
 * so shipping without it is a listing rejection, not a warning.
 */
export const PRIVACY_POLICY_URL = process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL ?? '';

/**
 * Where someone can request account deletion from outside the app.
 *
 * Play's account-deletion policy asks for *two* routes: one in the app (the
 * Account screen has it) and one on the web, reachable without installing
 * anything, for people who have already uninstalled.
 */
export const ACCOUNT_DELETION_URL = process.env.EXPO_PUBLIC_ACCOUNT_DELETION_URL ?? '';

/** True when a legal link is configured and therefore safe to show. */
export function hasLink(url: string): boolean {
  return url.trim().length > 0;
}
