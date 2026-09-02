# Unbreakable Lock

A cross-platform digital-wellbeing app. Pick the apps that pull you away, set a
duration, start a lock — and the OS keeps them out of reach until the timer runs
out.

Built with Expo (SDK 57) + React Native + TypeScript, with real native
enforcement in Kotlin (Android) and Swift (iOS).

---

## What "unbreakable" means here

**It means best-effort, OS-sanctioned enforcement. It does not mean you cannot
get around it.**

This matters enough to say up front, because the app's name over-promises and
the product should not:

- You can always uninstall this app. Neither iOS nor Android lets a normal app
  prevent its own removal, and this app does not try.
- You can always open Settings and revoke the permissions the lock depends on.
- You can always factory-reset the device.
- On Android, there is a fraction of a second after you open a blocked app
  before the block screen appears. The OS gives no way to pre-empt a launch.

What the app *does* guarantee is that it never quietly stops working: enforcement
state lives in native storage, survives the JS runtime being killed, survives a
reboot, and the UI reports the platform's real capabilities rather than a
marketing list. Every capability the OS does not offer is reported as `false` and
shown to the user as such (`src/types/index.ts` → `EnforcementCapabilities`).

Anti-features deliberately **not** implemented: device-admin uninstall
protection, accessibility-service tricks, Settings blocking, clock-tamper
exploits, or anything requiring root/jailbreak.

---

## Architecture

```
src/
  components/    Reusable UI: Button, Card, AppRow, Checkbox, Toggle,
                 CountdownTimer, StatusBadge, EmptyState, SearchBar,
                 PermissionRow
  screens/       Home, AppSelection, LockConfiguration, ActiveLock,
                 Schedules, CreateSchedule, Subscription, Permissions,
                 Account, Auth, EmailAuth,
                 Onboarding{Welcome,HowItWorks,Permissions,Complete},
                 Diagnostics (dev only)
  navigation/    React Navigation native stack + route types
  hooks/         useCountdown, useAppForeground, useSubscription, useAuth
  services/      LockService, PermissionService, PurchaseService, AdService,
                 AuthService, ScheduleService, StorageService,
                 SimulatedLockEngine
  store/         useLockStore, useUserStore, useAuthStore, useScheduleStore,
                 useDailyLimitStore
  types/         Shared domain types
  utils/         time, schedule, dailyUsage, errors, logger
  constants/     theme, limits

modules/unbreakable-lock/       Local Expo native module
  src/types.ts                  The JS <-> native contract
  index.ts                      requireOptionalNativeModule binding
  android/                      Kotlin enforcement engine
  ios/                          Swift Screen Time engine
  ios-extension/                DeviceActivityMonitor extension source

plugins/withUnbreakableLock.js  Config plugin (iOS entitlements, App Group)
```

### The one rule that shapes everything

**Remaining time is always `endTimestamp - Date.now()`.** There is no elapsed-
seconds counter anywhere. A JS interval only decides *when to re-render*; every
displayed value is recomputed from the absolute end timestamp. The native layers
get the same absolute timestamp. That is what makes a lock survive
backgrounding, app kills, and reboots without ending early.

Android additionally stores a monotonic `elapsedRealtime` deadline alongside the
wall-clock one and requires **both** to pass, so moving the system clock forward
cannot shorten a lock. (After a reboot `elapsedRealtime` resets, so the boot
receiver drops back to wall-clock only.)

### Layering

Screens never touch native modules. They call `LockService`, which picks the real
engine when present and a simulated one otherwise, and normalises every failure
into a `LockError` with a stable `code`. Both native platforms implement the same
method names and the same error codes.

---

## Installation

```bash
npm install
cp .env.example .env
```

**This app cannot run in Expo Go.** Enforcement is a custom native module, so you
need a development build:

```bash
npx expo prebuild            # generates android/ and ios/
npx expo run:android         # needs Android SDK
npx expo run:ios             # needs macOS + Xcode
```

If you launch it without a native build (Expo Go, web), it still boots and every
screen works against `SimulatedLockEngine` — but `canShieldApps` is `false`, and
the Home screen shows a banner saying nothing is actually being blocked.

### Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies |
| `npm start` | Metro for the dev client |
| `npm run prebuild` | Generate `android/` and `ios/` |
| `npm run android` | `expo run:android` — build + install |
| `npm run ios` | `expo run:ios` — macOS only |
| `npm test` | Jest |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |

---

> **Sprint status:** Day 2 focused entirely on the Android enforcement engine.
> See **[ANDROID.md](ANDROID.md)** for the full engine documentation, the
> real-device test matrix, and manufacturer-specific limitations. iOS was
> deliberately untouched this sprint.

## Android setup

Requirements: Android SDK (compileSdk 36), JDK 17, minSdk 26.

```bash
npx expo prebuild -p android
npx expo run:android
```

### Permissions

All three required permissions must be granted by the user in system Settings —
none can be granted programmatically, and the app opens the right screen rather
than trying to route around that.

| Permission | Why | Screen |
| --- | --- | --- |
| **Usage access** (`PACKAGE_USAGE_STATS`) | Read which app is in the foreground | `ACTION_USAGE_ACCESS_SETTINGS` |
| **Display over other apps** (`SYSTEM_ALERT_WINDOW`) | Android 10+ blocks background activity starts without it, so the block screen cannot appear | `ACTION_MANAGE_OVERLAY_PERMISSION` |
| **Notifications** (Android 13+) | A foreground service must show a notification | App notification settings |
| **Unrestricted battery** *(optional)* | Some OEMs kill background services aggressively | Battery optimization settings |

The app reads app *names* only. It does not read screen contents, keystrokes, or
anything inside the apps you block.

### How Android enforcement works

1. `LockForegroundService` runs as a foreground service (type `specialUse`) for
   the duration of the lock.
2. It polls `UsageStatsManager.queryEvents` once a second for the most recent
   foreground-app event.
3. If that package is on the blocked list, it starts `BlockActivity` over it —
   a full-screen "this app is locked" screen with the live countdown.
4. `LockStateStore` (SharedPreferences) is the native source of truth. JS reads
   it back on launch; the service re-reads it if Android restarts it.
5. `BootReceiver` restarts the service after a reboot or app update.

**Play Store note:** `FOREGROUND_SERVICE_SPECIAL_USE` requires a justification in
the Play Console when you publish. The declared subtype is in the module's
`AndroidManifest.xml`.

**No `DeviceAdminReceiver`.** It is unreliable across OEMs, Play policy does not
permit it for this use case, and the user can revoke it anyway — so claiming
uninstall protection would be a lie. `canPreventUninstall` is hardcoded `false`.

---

## iOS setup

Requirements: macOS, Xcode, iOS 16.4+ deployment target, a paid Apple Developer
account.

```bash
npx expo prebuild -p ios
npx expo run:ios
```

### Required Apple capabilities

1. **Family Controls entitlement** (`com.apple.developer.family-controls`).
   The config plugin adds it to the entitlements file, but Apple must also
   approve it for your App ID. Request it at
   <https://developer.apple.com/contact/request/family-controls-distribution>.
   Development builds work with the entitlement enabled in the portal; App Store
   distribution needs Apple's approval.
   Without it, `requestAuthorization()` fails and the app reports
   `ENTITLEMENT_UNAVAILABLE` — it never fakes a lock.

2. **App Group** — `group.com.unbreakablelock.app` (change it in `app.json` and
   in `LockSharedState.swift` + `DeviceActivityMonitorExtension.swift` together).
   Enable it for **both** the app and the extension target.

3. **DeviceActivityMonitor extension** — a manual one-time Xcode step, because
   Expo cannot create extension targets:

   - In Xcode: **File → New → Target → Device Activity Monitor Extension**
   - Name it `DeviceActivityMonitorExtension`
   - Replace the generated Swift file's contents with
     `modules/unbreakable-lock/ios-extension/DeviceActivityMonitorExtension.swift`
   - Add the App Group capability to the extension target
   - Set its deployment target to 16.4

   Without the extension the app still works: `getLockStatus()` lifts the shield
   itself once the end timestamp passes. The extension makes the lock end
   promptly even if the app is never reopened.

### How iOS enforcement works

`FamilyControls` for authorization and the app picker, `ManagedSettings` for the
shield that blocks the chosen apps, `DeviceActivity` to schedule the end of the
session.

**iOS cannot enumerate installed apps.** Apple deliberately does not expose this.
So on iOS the Home screen opens Apple's own `FamilyActivityPicker`, and the
selection comes back as *opaque tokens* — the app never learns which apps you
chose, only how many. The UI says so rather than inventing app names. This is why
`TargetApp` has an `opaque` flag.

**iOS cannot observe the foreground app either**, so `canMonitorUsage` is `false`
there. It does not need to: the ManagedSettings shield is applied by the OS
*before* the app draws, which is stronger than the Android approach.

---

## Daily usage limits

"15 minutes of YouTube a day." Documented in
**[DAILY_LIMITS.md](DAILY_LIMITS.md)**.

The allowance is **measured, not counted down** — it is real foreground time
read back from Android's own usage record, so it survives process death and
reboots without anything being remembered in JavaScript. It resets at local
midnight, and it is a third rule source feeding the same effective-lock engine
as manual locks and schedules.

## Schedules

Recurring locks — "block social media on weeknights, 10pm to 6am" — are
documented in **[SCHEDULES.md](SCHEDULES.md)**: the recurrence model, overlap
merging, background alarms, reboot and time-change handling, and the real-device
test matrix.

Schedules are a **Pro** feature and reuse the existing subscription screen. They
are stored locally on the device (never in Firebase), drive the **existing**
enforcement engine rather than a second one, and coexist with manual locks —
neither source can cancel the other.

## Onboarding & accounts

First-launch onboarding, the Android permission flow, and Firebase
authentication are documented in **[AUTH.md](AUTH.md)**.

Sign-in is optional throughout — the whole free tier works as a guest. An
account exists so a Pro subscription follows you to a new phone, and nothing
else.

> **Firebase has no email OTP.** Its supported passwordless email method is a
> sign-in *link*, so the UI asks the user to open their inbox rather than
> showing a code field that could never be filled. See AUTH.md.

Identity and entitlement stay separate: Firebase answers *who is this user*,
RevenueCat answers *what have they paid for*. On sign-in the Firebase UID is
passed to `Purchases.logIn()`, which merges an anonymous guest's purchases into
the account so a guest who bought Pro keeps it.

## Monetization

Free vs Pro, RevenueCat, Google Play and AdMob are documented in full in
**[MONETIZATION.md](MONETIZATION.md)** — including Play Console product setup,

For the end-to-end store setup — Play Console product, base plan, regional
pricing and country availability, RevenueCat entitlement/offering/package — see
**[REVENUECAT_SETUP.md](REVENUECAT_SETUP.md)**.
licence testers, and the release checklist.

| | Free | Pro — $2.99/month |
| --- | --- | --- |
| Blocked apps | 1 | Multiple |
| Max duration | 60 min | 24 h |
| Strict Mode | — | ✓ |
| Ads | Shown | Never |

```bash
# .env
EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=goog_xxx
EXPO_PUBLIC_ADMOB_ANDROID_APP_ID=
EXPO_PUBLIC_ADMOB_ANDROID_BANNER_ID=
EXPO_PUBLIC_DEV_PRO_MODE=false
```

Leave everything empty for development: entitlements run in a local simulated
mode (clearly labelled in the UI) and ads use Google's published test ids.

Screens ask about entitlements through one hook, `useSubscription()`, and tier
limits live only in `src/constants/limits.ts`. RevenueCat is the source of
truth — local storage caches the answer for the first frame but never grants
anything, and a cancelled-but-unexpired subscription keeps Pro until the paid
period actually ends.


## Strict Mode

Strict Mode means **the session cannot be ended early from inside the app**. The
guard is in native code, not just the UI: `stopLock(force: false)` rejects with
`STRICT_MODE_ACTIVE` while a strict lock is running. The Active Lock screen shows
no cancel button at all under Strict Mode — not a disabled one — because a button
that never works is a lie.

`force: true` exists only for the timer expiring, which is not a user action.

The Active Lock screen also states plainly what Strict Mode cannot do: you can
still uninstall the app or revoke its permissions.

---

## Testing

```bash
npm test
```

42 tests across 5 suites:

- **validation** — free/Pro app counts, durations, Strict Mode gating
- **time** — countdown maths, padding, expiry, timestamp independence
- **lockStore** — selection, persistence, start/stop, expiry, restore after restart
- **lockEngine** — the native state machine contract (start, guards, expiry,
  strict-mode refusal) that Kotlin and Swift implement identically
- **schedule** — CRUD and next-occurrence maths, including overnight windows

The suites run against `SimulatedLockEngine`, which implements the identical
contract, so the same assertions describe what the native modules must do.

---

## Build verification status

What has actually been run, as opposed to written:

| Check | Status |
| --- | --- |
| `npm run typecheck` | ✅ clean |
| `npm run lint` | ✅ clean |
| `npm test` | ✅ 42/42 |
| Metro bundle (Android) | ✅ 889 modules |
| `npx expo prebuild` | ✅ generates `android/` |
| `npx expo-doctor` | ✅ 21/21 |
| Native module autolinking | ✅ resolves for apple + android |
| Kotlin module compiles | ✅ `:unbreakable-lock-native:compileDebugKotlin` |
| Real-device test matrix | ⚠️ documented, **not yet run** — no device here |
| Debug APK assembles | ✅ `:app:assembleDebug` |
| Module manifest merges | ✅ service, block activity, boot receiver, all permissions |
| **Swift module compiles** | ❌ **not verified — needs macOS + Xcode** |

The iOS native code is the one part that has never been through a compiler. Its
riskiest API assumptions (the `Exception` initializer, `ManagedSettingsStore.Name`,
`FamilyControlsError` handling) were checked against the vendored ExpoModulesCore
sources rather than from memory, but treat it as unproven until it builds on a Mac.

## Known limitations

**Both platforms**

- Uninstalling the app ends any lock. No app can prevent this.
- Revoking permissions in Settings ends enforcement. No app can prevent this.
- Schedules persist and compute their next occurrence, but nothing fires them yet
  (see TODO in `ScheduleService.createSchedule`).

**Android**

- The block screen appears *after* the app opens, not before — typically well
  under a second, but not instantaneous.
- Aggressive OEM battery managers (Xiaomi, Huawei, Samsung, OnePlus) can kill the
  foreground service. Hence the optional battery-optimization permission.
- Some OEMs restrict launcher-intent queries; app enumeration degrades to an
  empty list with an empty state rather than crashing.
- Android 12+ can refuse a background foreground-service start after boot; the
  lock state survives and the service restarts when the app is next opened.

**iOS**

- Requires iOS 16.4+ and Apple's Family Controls entitlement approval.
- The app never learns which apps you selected — only counts.
- `DeviceActivitySchedule` works in wall-clock components, so sessions are
  clamped just under 24 hours.
- Custom shield UI (Shield Configuration / Shield Action extensions) is not
  implemented; the system default shield is used.

**Development**

- Expo Go cannot run enforcement. Use a development build.
- `expo prebuild` on Windows generates `android/` only; `ios/` needs macOS.

---

## What is implemented

- [x] Three-screen flow: app selection → lock configuration → active dashboard
- [x] Permissions screen with a real state machine and system-settings deep links
- [x] Paywall with a stated reason, RevenueCat integration, dev fallback
- [x] Android: Kotlin module, foreground service, usage polling, block screen,
      boot receiver, native state persistence, real installed-app enumeration
- [x] iOS: Swift module, FamilyControls authorization + picker, ManagedSettings
      shield, DeviceActivity scheduling, monitor extension source
- [x] Capability reporting driving the UI instead of hardcoded promises
- [x] Timestamp-based countdown with restart survival and clock-change resistance
- [x] Zustand stores with AsyncStorage persistence
- [x] Structured error codes shared across both native platforms
- [x] Schedule data model + service interface
- [x] Light/dark theme following the system
- [x] 42 tests, ESLint clean, TypeScript strict clean

## TODO

- Fire schedules (AlarmManager on Android; repeating DeviceActivitySchedule on iOS)
- Schedule management UI
- Custom iOS shield UI via Shield Configuration/Action extensions
- Onboarding flow that requests permissions before the first lock
- Persist and display lock history / streaks
- Component-level render tests (services and stores are covered; screens are not)
