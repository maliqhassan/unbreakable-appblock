# Onboarding & Authentication — Android

---

## ⚠️ Read this first: Firebase has no email OTP

The sprint brief asked for a 6-digit email code. **Firebase Authentication does
not provide one**, and never has. Its supported passwordless email method is
`sendSignInLinkToEmail` — a one-time sign-in *link*.

Building a numeric code would mean running our own mail service, code store,
rate limiter and expiry logic. That is a custom authentication backend, which
this project explicitly does not have and should not have.

So the implementation uses **email link sign-in**, and the UI says so: "we sent a
link to your inbox", not "enter the code". No screen shows a code input that
could never be filled.

### Dynamic Links are gone

Firebase Dynamic Links shut down in **August 2025**. Email-link sign-in used to
depend on them. It now works through an ordinary continue URL that deep-links
back into the app, which is what `EXPO_PUBLIC_FIREBASE_EMAIL_CONTINUE_URL`
configures. See [Email setup](#email-setup) — this needs console work that a
pre-2025 tutorial will not mention.

---

## Onboarding flow

```
First launch
   ↓
1. Welcome            "Take back your time."
   ↓
2. How it works       Choose apps → Set a timer → Stay focused
   ↓
3. Permissions        ← the important one
   ↓
4. All set / not set  Honest about what is missing
   ↓
   Create account? ──── or ──── Continue without one
   ↓
Home
```

Nothing is asked for before step 3. Someone who has just installed the app has
not yet decided they want it, and a wall of permission requests at the door is
how you lose them.

Onboarding is skipped on later launches (`onboarded` flag), and **an active lock
outranks it** — a running session never gets buried behind a setup flow.

---

## Permission flow

```
Tap a permission row
   ↓
In-app explanation sheet     ← our words, before Android's screen
   ↓
[Continue]
   ↓
Android Settings             ← the only place these can be granted
   ↓
User grants
   ↓
Return to the app
   ↓
Status re-read from Android automatically → ✓ Enabled
```

**There is no manual "mark as done" control anywhere.** Status is always read
live from Android via `PermissionService`, which calls the native module. The
`permissionsSetupCompleted` flag records only that the *step was seen* — never
that anything was granted.

That is what makes revocation work: revoke Usage Access in Settings, reopen the
app, and Home immediately reads "Setup required".

### Which permissions — and one the brief listed that we do not use

| Permission | Required | Why |
| --- | --- | --- |
| **Usage access** | Yes | Read which app is in the foreground |
| **Display over other apps** | Yes | Android 10+ blocks background activity starts without it |
| **Notifications** | Yes | A foreground service must show one |
| **Unrestricted battery** | Optional | Some OEMs kill background services |

**Accessibility is deliberately absent.** The brief's example list included it,
but this app ships no `AccessibilityService` and never has — the enforcement
engine uses `UsageStatsManager`. Listing it would be asking for permission to
read the contents of every screen the user sees, for a capability we do not use.
The brief's own instruction settles it: *"Use the minimum permissions actually
required by the current Android implementation."*

It is still reported in the dev diagnostics screen as permanently `false`, so
the absence is visible rather than merely unmentioned.

---

## Authentication architecture

```
Firebase Auth  ──►  "Who is this user?"      (AuthService  → useAuth)
RevenueCat     ──►  "What have they paid?"   (PurchaseService → useSubscription)
```

The two are deliberately **not merged**. `useAuth` exposes nothing about Pro;
`useSubscription` exposes nothing about identity. No `isPro` flag is ever
written to Firebase.

```
src/services/AuthService.ts     the only file that imports firebase
src/store/useAuthStore.ts       shared state + RevenueCat identity linking
src/hooks/useAuth.ts            the only API screens use
```

### Why the Firebase JS SDK, not @react-native-firebase

`@react-native-firebase` requires a `google-services.json` at build time, and
the Gradle plugin **fails the build without one**. That would mean either
committing a real config file or shipping a fake one.

The JS SDK takes its configuration from environment variables at runtime, so:

- the repo contains no Firebase config file at all,
- the APK builds with no Firebase setup whatsoever,
- an unconfigured build degrades to guest-only instead of crashing.

Google's *native* account picker still comes from
`@react-native-google-signin/google-signin`, which needs only the OAuth web
client id — no `google-services.json`.

### What is never done

- No passwords are created, stored, or transmitted.
- No custom Google login form or WebView — Google's own picker only.
- No auth tokens are stored by hand; Firebase owns session persistence.
- No custom auth cryptography.
- No Firebase Admin SDK or service-account JSON anywhere near the app.
- Sign-in links and verification codes are **never logged**.

---

## Firebase setup

1. **Create a project** at <https://console.firebase.google.com>.
2. **Add an Android app** with package `com.unbreakablelock.app`.
3. **Add SHA-1 and SHA-256 fingerprints.** Google Sign-In will not work without
   them.

   ```bash
   # Debug key (the one Expo generates)
   keytool -list -v -keystore android/app/debug.keystore \
     -alias androiddebugkey -storepass android -keypass android

   # Your release upload key
   keytool -list -v -keystore <your-release>.keystore -alias <your-alias>
   ```

   Add **both**. A build signed with a fingerprint Firebase does not know will
   fail Google Sign-In with a generic error that is miserable to debug.

   If you use Play App Signing, also add the **App signing key** SHA-1 from
   Play Console → Setup → App integrity.

4. **Copy the config** into `.env` (Project settings → General → Your apps):

   ```bash
   EXPO_PUBLIC_FIREBASE_API_KEY=AIza...
   EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   EXPO_PUBLIC_FIREBASE_PROJECT_ID=your-project
   EXPO_PUBLIC_FIREBASE_APP_ID=1:123:android:abc
   EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
   EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
   ```

   These are **public client configuration**. They identify the project; they do
   not authorise anything. Security comes from authorised domains and rules, not
   from hiding them.

### Google setup

1. **Authentication → Sign-in method → Google → Enable.**
2. Copy the **Web client ID** (Firebase creates one automatically; it is under
   the Google provider's "Web SDK configuration"):

   ```bash
   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=123-abc.apps.googleusercontent.com
   ```

   ⚠️ It must be the **Web** client id, not the Android one. Passing the Android
   id is the single most common cause of `DEVELOPER_ERROR` here.

3. Leave it empty to hide the Google button entirely.

### Email setup

1. **Authentication → Sign-in method → Email/Password → Enable**, then enable
   **Email link (passwordless sign-in)** underneath it.
2. **Authentication → Settings → Authorised domains** — add the domain your
   continue URL uses.
3. Set the continue URL:

   ```bash
   EXPO_PUBLIC_FIREBASE_EMAIL_CONTINUE_URL=https://your-project.firebaseapp.com/finish
   ```

4. That page must redirect to `unbreakablelock://` (the app's scheme, already
   configured) carrying the query string intact. Firebase Hosting with a small
   redirect page is the simplest option now that Dynamic Links are gone.
5. Leave it empty to hide the email option entirely.

**Why the app also stores the email address:** completing a sign-in link
requires knowing which address it was sent to. That is Firebase's documented
protection against someone completing a link intercepted from another inbox. The
address is stored locally; the link and any token never are.

---

## RevenueCat identity

```
Firebase Auth ──► Firebase UID ──► Purchases.logIn(uid) ──► RevenueCat customer
                                                                   ↓
                                                            "pro" entitlement
```

Using the SDK's real API, verified against the installed types:

| Event | Call |
| --- | --- |
| Sign in | `Purchases.logIn(firebaseUid)` |
| Sign out | `Purchases.logOut()` |

**Why `logIn` and not reconfiguring:** RevenueCat merges the anonymous
customer's purchases into the identified one. A guest who bought Pro and then
signed in keeps what they paid for. Re-configuring the SDK with a different app
user id would orphan that purchase.

Guardrails in `PurchaseService.identify()`:

- If the SDK already has this app user id, it skips the round trip.
- If the link fails, the last known entitlement is kept — a billing hiccup never
  costs someone their features, and never blocks sign-in.

Sign-out calls `logOut()`, returning to a fresh anonymous customer. Purchases
stay attached to the account that made them and return on next sign-in.

**RevenueCat remains the sole authority on Pro.** Nothing writes entitlement to
Firebase.

---

## Guest users

Guests get the complete Free tier: 1 app, 60 minutes, Standard Mode, with ads.
Authentication is never required to start a lock. An account buys exactly one
thing — a subscription that follows you to a new phone.

---

## Test matrix (real device)

### Onboarding — fresh install

| # | Step | Expect |
| --- | --- | --- |
| 1 | Install and launch | Welcome screen, not Home |
| 2 | Get Started | How it works, 3 cards |
| 3 | Continue | Permissions, all rows `○ Required` |
| 4 | Tap Usage Access | Explanation sheet, **not** a fake system dialog |
| 5 | Continue | Android's Usage Access settings |
| 6 | Grant, press back | Row flips to `✓ Enabled` with no interaction |
| 7 | Repeat for Overlay and Notifications | All `✓ Enabled` |
| 8 | Continue | "You're all set" |
| 9 | Continue without an account | Home, header shows "Sign in" |

Skipping instead at step 8 must show **"N permissions remaining"** and never
claim setup is complete.

### Permission revocation

1. Complete onboarding.
2. Revoke Usage Access in Android Settings.
3. Reopen the app → Home reads **"Setup required"**.
4. Try to start a lock → Requirements gate appears; no lock starts.
5. Re-grant → Home reads **"Protection ready ✓"** on return.

### Google

1. Sign in → account picker → pick account → header shows avatar/initials.
2. Force-stop and reopen → still signed in (session persisted).
3. Account → Log out → header returns to "Sign in".
4. Cancel the picker mid-flow → **no error dialog**, nothing changes.

### Email

1. Enter address → Send link → "Check your email".
2. Open the link on the same device → app opens and completes sign-in.
3. Restart → session persists.
4. Reuse the same link → "link has expired or has already been used".
5. Resend and Change email both work from the waiting screen.

### RevenueCat identity

1. As a **guest**, buy Pro with a licence tester account.
2. Sign in with Google → **Pro is still active** (the merge worked).
3. Log out → entitlement reflects the anonymous customer.
4. Sign back in → Pro returns.

---

## Known gaps

- **None of the auth flows have been run against real Firebase.** Every test
  mocks the provider. Google Sign-In, the email link round trip, and the
  RevenueCat merge need a configured project and a real device.
- The email continue URL needs a redirect page you must host. There is no way
  around this since Dynamic Links shut down.
- iOS is untouched this sprint, by instruction.
