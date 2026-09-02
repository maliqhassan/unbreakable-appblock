# Google Play Compliance

An audit of Unbreakable Lock against the Play policies that actually get apps
like this one rejected, plus the Play Console declarations you must fill in.

App-blocking apps sit in a category Google reviews carefully, because the
mechanisms that block apps are the same ones malware uses. The good news is that
this app was built without any of the techniques that trigger that: no
Accessibility Service, no `QUERY_ALL_PACKAGES`, no device-admin, no uninstall
prevention, no claims it cannot back up.

**Status: three things must be done before you upload.** They are marked
🔴 below. Everything else is either already compliant or a Play Console form.

---

## 🔴 Must do before uploading

### 1. Host the privacy policy and set its URL

Play requires a privacy policy URL for any app handling personal or sensitive
data. Reading usage statistics qualifies.

1. Publish [PRIVACY_POLICY.md](PRIVACY_POLICY.md) at a public URL (GitHub Pages
   is fine). Fill in the name and contact email placeholders first.
2. Put that URL in **Play Console → App content → Privacy policy**.
3. Put it in `.env` as `EXPO_PUBLIC_PRIVACY_POLICY_URL` and rebuild, so the
   in-app link on the Account screen appears.

While the variable is empty the in-app link stays hidden — an unconfigured build
shows no dead link, but it also shows no policy, which is why this is a blocker.

### 2. Replace the AdMob test IDs

The app currently ships **Google's test ad IDs**:

- App ID `ca-app-pub-3940256099942544~3347511713` (baked into the manifest)
- Banner unit `ca-app-pub-3940256099942544/6300978111`

This is deliberate — a misconfigured build shows test ads rather than risking a
policy strike from self-served live ads — but it earns nothing. Before release:

```
EXPO_PUBLIC_ADMOB_ANDROID_APP_ID=ca-app-pub-XXXXXXXX~XXXXXXXX
EXPO_PUBLIC_ADMOB_ANDROID_BANNER_ID=ca-app-pub-XXXXXXXX/XXXXXXXX
```

The **App ID is written into `AndroidManifest.xml` at prebuild time**, so it
needs `npx expo prebuild -p android --clean` and a full rebuild, not just a JS
reload. Never click your own live ads — that closes AdMob accounts.

### 3. Provide a web account-deletion URL

Play's account-deletion policy asks for two routes: in the app, and on the web
for people who already uninstalled. The in-app one now exists (Account → Delete
account). You still need a public page — it can be a simple form or a mailto
instruction — declared in **Play Console → App content → Data deletion**, and
set as `EXPO_PUBLIC_ACCOUNT_DELETION_URL`.

---

## Play Console declarations you will be asked for

### Data safety form

Answer it from what the app actually does:

| Question | Answer |
| --- | --- |
| Does your app collect or share user data? | **Yes** (email for optional sign-in, advertising ID for ads, purchase info) |
| Is data encrypted in transit? | **Yes** — Firebase, RevenueCat and AdMob are all HTTPS |
| Can users request data deletion? | **Yes** — in-app and via the web URL above |

Data types to declare:

- **Personal info → Email address** — collected, not shared. Optional (sign-in).
  Purpose: *Account management*.
- **Personal info → Name, Photo** — only for Google Sign-In. Purpose: *Account
  management*.
- **Financial info → Purchase history** — collected via RevenueCat. Purpose:
  *App functionality*.
- **Device or other IDs → Advertising ID** — collected and shared with Google
  AdMob. Purpose: *Advertising*.

Do **not** declare app usage statistics as collected: they are read on the
device, stored on the device, and never transmitted. Say so plainly if review
asks — the code backs it up, since there is no server to send them to.

### Advertising ID declaration

The merged manifest contains `com.google.android.gms.permission.AD_ID`, added by
the AdMob SDK. Declare in **App content → Advertising ID** that the app uses it,
for *Advertising or marketing*.

### Foreground service declaration

The app declares `FOREGROUND_SERVICE_SPECIAL_USE`. Play asks you to justify why
no other foreground-service type fits. Suggested wording, which matches the
manifest's `PROPERTY_SPECIAL_USE_FGS_SUBTYPE`:

> The service enforces a user-initiated app lock session that the user started
> and configured. It must run continuously until the session's scheduled end
> time so the block screen can be shown when a blocked app is opened. No
> existing foreground service type (dataSync, mediaPlayback, location, etc.)
> describes ongoing user-requested app-blocking enforcement. The service posts
> a persistent notification showing the time remaining and stops on its own when
> the session ends.

Include a screen recording showing a lock being started by the user, the
notification, and the block screen appearing. Reviewers ask for this.

### Permissions declaration

Be ready to justify:

- **`PACKAGE_USAGE_STATS`** — needed to know which app is in the foreground so a
  blocked app can be blocked. The user grants it in Settings; it is never
  auto-granted, and the app explains why before opening that Settings page.
- **`SYSTEM_ALERT_WINDOW`** — needed to show the block screen over the blocked
  app. Android 10+ refuses background activity starts without it.
- **`SCHEDULE_EXACT_ALARM`** — schedules must start and end on the minute. The
  app falls back to inexact alarms when the user revokes it.
- **`RECEIVE_BOOT_COMPLETED`** — a lock that survives a reboot; otherwise
  restarting the phone is a trivial bypass.

### Content rating and target audience

Rate through the questionnaire honestly. The app contains ads, which the
questionnaire asks about. Target audience should be **18+ or 13+, not children**
— selecting a children's audience pulls the app into the Families policy, which
places extra restrictions on ads and on the permissions this app needs.

---

## Already compliant — and why it matters

### No Accessibility Service ✅

The single most common rejection for app blockers. Play restricts
`AccessibilityService` to apps genuinely serving users with disabilities, and
routinely removes blockers that use it to read the foreground app. This app uses
`UsageStatsManager` instead, which is the sanctioned API for the job.

### No `QUERY_ALL_PACKAGES` ✅

Play treats it as a restricted permission needing separate approval. The app
instead declares a scoped `<queries>` element for launcher-visible apps, which
needs no declaration.

### No deceptive claims ✅

Play's Deceptive Behavior policy prohibits claiming capabilities the app does
not have. The app reports `canPreventUninstall: false` in its own UI, the README
describes enforcement as *best-effort* rather than unbreakable, and nothing in
the product claims a user cannot uninstall it or end a lock in Settings. Keep
your **store listing** to the same standard — do not write "impossible to
bypass" in the description.

### No payment handling outside Play Billing ✅

Subscriptions go through Google Play Billing via RevenueCat. The app collects no
card numbers, billing addresses or payment credentials, which keeps it clear of
the Payments policy.

### Ad placement ✅

Ads appear on the Home and Daily Limits screens only. There are none on the
active lock screen, none over the native block screen, and none in permission
flows. Play's Ads policy prohibits ads that interfere with app functionality or
invite accidental clicks — an ad next to a block screen would be exactly that.

### Target API level ✅

`targetSdkVersion 36`, `minSdkVersion 26`, comfortably above Play's current
requirement for new apps.

### EEA/UK ad consent ✅ (added in this pass)

Google's EU User Consent Policy requires a certified Consent Management Platform
before serving personalised ads to users in the EEA, the UK or Switzerland. The
app now uses Google's own UMP:

- `ConsentService.gather()` runs **before** the AdMob SDK starts.
- `AdService.initialize()` refuses to start the SDK when `canRequestAds` is
  false, so an unconsented ad cannot be requested.
- The default is "no ads": a failure to reach UMP blocks ads rather than
  allowing them.
- Users whose region required a form get **Account → Privacy choices for ads**,
  the persistent entry point UMP requires.
- Outside those regions UMP reports `NOT_REQUIRED`, no form is shown, and no
  region is ever inferred by the app itself.

Configure the messages once in **AdMob → Privacy & messaging → European
regulations**, or the form will not appear on device.

### In-app account deletion ✅ (added in this pass)

Account → Delete account deletes the Firebase user and clears the apps,
schedules and daily limits stored on the device. If the deletion fails, nothing
local is cleared — being left with a wiped device and a live account is worse
than either outcome alone.

---

## Before you hit publish

- [ ] Privacy policy hosted, URL in Play Console **and** `.env`
- [ ] Real AdMob IDs set, `expo prebuild --clean`, rebuilt
- [ ] AdMob EEA consent messages configured in the AdMob dashboard
- [ ] Web account-deletion URL live and declared
- [ ] Data safety form completed as above
- [ ] Advertising ID declared
- [ ] Foreground service justification + screen recording submitted
- [ ] Content rating questionnaire completed, audience not set to children
- [ ] `EXPO_PUBLIC_DEV_PRO_MODE=false` in the release build
- [ ] Store listing avoids "unbreakable", "impossible to bypass" and similar
      claims about blocking that the app cannot deliver
- [ ] Signed AAB (not APK) uploaded — Play requires the App Bundle format for
      new apps. Build it with `cd android && ./gradlew bundleRelease`; the
      output is `android/app/build/outputs/bundle/release/app-release.aab`.
      The APKs built so far are for sideloading and testing only.

## See also

- [PRIVACY_POLICY.md](PRIVACY_POLICY.md) — the text to publish
- [REVENUECAT_SETUP.md](REVENUECAT_SETUP.md) — billing setup
- [MONETIZATION.md](MONETIZATION.md) — how Free/Pro and ads work in the app
