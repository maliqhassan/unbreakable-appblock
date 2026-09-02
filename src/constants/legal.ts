/**
 * Links Google Play requires a published app to expose.
 *
 * These default to the project's own GitHub Pages site, whose source lives in
 * `docs/` in this repository, and can be pointed elsewhere with the matching
 * `EXPO_PUBLIC_*` variables if the policy ever moves to another domain.
 *
 * They are defaulted rather than left empty on purpose. An unset variable used
 * to hide the link entirely, which left the Account screen showing a Privacy
 * card with nothing in it — and shipped a build with no reachable policy, which
 * is a listing rejection rather than a warning. Play requires a privacy policy
 * URL for any app handling personal or sensitive data, and this app does the
 * moment it reads usage statistics.
 */
const PAGES = 'https://maliqhassan.github.io/unbreakable-appblock';

export const PRIVACY_POLICY_URL =
  process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL || `${PAGES}/`;

/**
 * Where someone can request account deletion from outside the app.
 *
 * Play's account-deletion policy asks for *two* routes: one in the app (the
 * Account screen has it) and one on the web, reachable without installing
 * anything, for people who have already uninstalled.
 */
export const ACCOUNT_DELETION_URL =
  process.env.EXPO_PUBLIC_ACCOUNT_DELETION_URL || `${PAGES}/delete-account.html`;

/** True when a legal link is configured and therefore safe to show. */
export function hasLink(url: string): boolean {
  return url.trim().length > 0;
}
