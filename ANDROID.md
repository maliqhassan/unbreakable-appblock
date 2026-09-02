# Android enforcement engine

Everything about how the lock actually works on Android, and what it cannot do.

> **Best-effort Android OS-level enforcement.**
> This is the honest description of the product. A determined user with physical
> access to their own unlocked phone can always get around it — see
> [Limitations](#limitations). Nothing in this app claims otherwise.

---

## The contract

```
User selects YouTube
      ↓
Sets a 30 minute lock
      ↓
Requirements checked  ──── missing? ──→ Permissions screen, lock does NOT start
      ↓
Native session persisted (SharedPreferences)
      ↓
LockForegroundService starts
      ↓
React Native can be killed          ← lock survives
Phone can sleep                     ← lock survives
Phone can reboot                    ← lock survives
      ↓
endTimestamp reached
      ↓
Native stops enforcement, clears state
      ↓
YouTube accessible again
```

**React Native is the configuration and display layer. Native is the
enforcement authority.** No enforcement decision anywhere depends on the JS
process being alive.

---

## Components

| File | Role |
| --- | --- |
| `LockStateStore.kt` | The native source of truth. SharedPreferences-backed session: id, targets, start/end timestamps, strict flag, degraded reason. |
| `LockForegroundService.kt` | The enforcement loop. Foreground service, screen-aware usage polling, exact expiry, permission-revocation detection. |
| `BlockActivity.kt` | The screen shown over a blocked app. Live countdown, built in code (no resource merging). |
| `BootReceiver.kt` | Restores an unexpired session after reboot or app update. |
| `ProtectedPackages.kt` | The hard denylist. Packages that can never be blocked. |
| `AppInventory.kt` | Launcher-visible app enumeration, minus protected packages. |
| `LockPermissions.kt` | Permission checks and the system-settings intents that grant them. |
| `UnbreakableLockModule.kt` | The Expo module. A remote control for the lock, not the lock itself. |

---

## Absolute timestamps, always

There is no decrementing counter anywhere in this codebase — native or JS.

```kotlin
// LockForegroundService, every tick
if (LockStateStore.isExpired(this)) finishSession()
```

Expiry is evaluated three independent ways, so no single failure extends or
truncates a lock:

1. The **1-second poll** checks `isExpired()`.
2. A **scheduled runnable** fires at exactly `endTimestamp`.
3. **`getLockStatus()`** cleans up whenever the app is opened.
4. **`BootReceiver`** refuses to restart an already-expired session.

### Clock-change resistance

`LockStateStore` persists two deadlines: wall-clock (`System.currentTimeMillis`)
and monotonic (`SystemClock.elapsedRealtime`). A lock ends only when **both**
have passed, so moving the system clock forward does not shorten it.

A reboot resets `elapsedRealtime`, which would make the monotonic deadline
meaningless, so `BootReceiver` calls `invalidateElapsedDeadline()` and the
session falls back to wall clock alone. This is deliberate: after a reboot we
would rather be slightly gameable than accidentally never expire.

---

## Surviving JS process death

The service holds no reference to React Native. On every tick it re-reads
`LockStateStore` rather than trusting a cached field, so:

- Killing the app from the recents switcher does not stop enforcement.
- Android killing the process for memory triggers `START_STICKY`; the service is
  recreated with a `null` intent and re-derives everything from persisted state.
- If the app is reopened and finds a live session with no running service
  (`serviceRunning == false`), `getLockStatus()` restarts it.

`LockForegroundService.isRunning` is a separate signal from the persisted
`active` flag on purpose: `active` means a lock *should* be running, `isRunning`
means enforcement actually *is*. The diagnostics screen shows both.

---

## Never blocking the user out of their own phone

`ProtectedPackages` is enforced in two places:

1. `AppInventory` hides them, so they cannot be selected.
2. `LockForegroundService` re-checks at enforcement time, so a stale or
   hand-edited session still cannot block them.

Protected: this app itself, **every** package that can act as a home screen
(resolved at runtime, not hardcoded), SystemUI, Settings, the dialer, telecom,
emergency, and the package/permission installers.

Blocking your own launcher would leave you with no way to reach anything for the
rest of the session. Blocking Settings would trap you with no way to revoke the
app's permissions. Both are defects, not features.

---

## Degraded enforcement

The failure mode that matters most is **silent**: a lock that is counting down
while blocking nothing, with the UI still claiming protection.

Every 5 ticks the service re-checks usage access and overlay permission. If
either is gone it writes a `degradedReason` to the session, and:

- the notification changes to **"Lock is not being enforced"** with the reason,
- the Active Lock screen shows a red **"Not Enforcing"** badge, an explanation,
  and a button to fix it,
- `getLockStatus()` returns the reason to JS.

The timer keeps running. The app just stops claiming to be protecting you.

---

## Battery

Polling only happens **while the screen is on**. Nothing can be launched on a
dark screen, so a 1-second poll through an 8-hour overnight lock would burn
battery for zero enforcement benefit — and being a visible battery hog is the
single most likely way an OEM power manager decides to kill the service.

The service registers `ACTION_SCREEN_ON` / `ACTION_SCREEN_OFF` and polls
immediately on wake, so there is no window where the screen is on and the lock
is not watching.

The notification uses `setChronometerCountDown`, so the live countdown in the
shade costs nothing — Android renders it.

---

## Permissions

All three required permissions are granted by the user in system Settings. None
can be granted programmatically; the app only opens the correct screen.

| Permission | Required? | Why | Without it |
| --- | --- | --- | --- |
| **Usage access** (`PACKAGE_USAGE_STATS`) | Yes | Read which app is in the foreground | Nothing can be detected |
| **Display over other apps** (`SYSTEM_ALERT_WINDOW`) | Yes | Android 10+ blocks background activity starts without it | Block screen cannot appear |
| **Notifications** (Android 13+) | Yes | A foreground service must show one | Service cannot start |
| **Unrestricted battery** | Optional | Some OEMs kill background services aggressively | Lock may end early |

The app reads app **names** only. It does not read screen contents, keystrokes,
or anything inside the apps you block.

### No AccessibilityService

This app deliberately ships **no AccessibilityService**. It is reported in
diagnostics as permanently `false`.

An AccessibilityService could detect app launches marginally faster, but it
grants the ability to read the contents of every screen the user sees. That is
wildly disproportionate for a timed blocker, it is the single most abused
permission on Android, and Play policy scrutinises it heavily. `UsageStatsManager`
does the job with a fraction of the access.

---

## Free / Pro

Unchanged from Day 1. Entitlement checks happen in
`LockService.validateConfiguration` **before** any native call, so tier logic
never sits in the enforcement path.

| | Free | Pro |
| --- | --- | --- |
| Apps per lock | 1 | Multiple |
| Max duration | 60 min | 24 h |
| Strict Mode | — | ✓ |

---

## Real-device test matrix

Run these on hardware. An emulator will pass tests that real OEM builds fail.

Enable the dev diagnostics screen (gear icon on Home, dev builds only) to watch
native state directly while testing.

| # | Test | Steps | Pass criteria |
| --- | --- | --- | --- |
| **A** | Basic | Grant permissions → select YouTube → 5 min lock → open YouTube → wait for expiry | Block screen appears; YouTube works again after expiry |
| **B** | Background | Start lock → background the app → open YouTube | Still blocked |
| **C** | JS death | Start lock → swipe app from recents → open YouTube | Still blocked. Diagnostics shows `serviceRunning: true` |
| **D** | Screen lock | Start lock → lock phone → wait 5 min → unlock → open YouTube | Still blocked; remaining time decreased by the real elapsed time |
| **E** | Reboot | Start 10 min lock → reboot → open YouTube after boot | Still blocked; session recovered |
| **F** | Expiry during reboot | Start 2 min lock → reboot immediately → wait past original end | Enforcement stops; no session restored |
| **G** | Multiple apps | Select YouTube + Instagram + TikTok → start lock → open each | All three blocked |
| **H** | Permission removal | Start lock → revoke Usage access in Settings → return to app | Red "Not Enforcing" banner with the reason. **No claim of protection** |
| **I** | Protected packages | Confirm launcher/Settings absent from picker; open launcher during a lock | Never blocked |
| **J** | Clock change | Start 30 min lock → set system clock forward 1 hour → check remaining | Lock does not end early |
| **K** | Force stop | Start lock → Settings → Force stop → reopen app | Session restored, service restarted |
| **L** | Battery | Start 8 h lock → leave overnight, screen off | Lock alive next morning; battery use negligible |

### Manufacturer notes

| OEM | Expected behaviour |
| --- | --- |
| **Pixel / stock** | Baseline. Everything above should pass. |
| **Samsung** | "Put unused apps to sleep" can kill the service. Exclude the app in Settings → Battery → Background usage limits. |
| **Xiaomi / MIUI** | Most restrictive. Needs Autostart enabled **and** battery saver set to "No restrictions", or boot recovery (Test E) will fail. MIUI also requires a separate "Display pop-up windows while running in background" permission for the block screen. |
| **OnePlus / Oppo / Vivo** | Aggressive "deep optimization". Lock the app in recents and disable battery optimization. |
| **Huawei** | "Protected apps" list must include the app. |

These are OEM power-management decisions, not bugs we can fix in code. The app
detects and reports the resulting failure rather than pretending it did not
happen — that is what the degraded-enforcement path is for.

---

## Limitations

Stated plainly, because the product name over-promises:

**Nothing here can be prevented by any Android app:**

- **Uninstalling the app** ends the lock. No API prevents this.
- **Revoking permissions** in Settings ends enforcement. Detected and reported,
  not prevented.
- **Force-stopping** the app stops the service until it is reopened or the
  device reboots.
- **Safe mode** disables third-party apps entirely.
- **Factory reset** obviously ends everything.

**Technical limits of the approach:**

- The block screen appears *after* the blocked app launches, typically well
  under a second. There is no way to pre-empt a launch without an
  AccessibilityService, and see above for why we do not ship one.
- `UsageStatsManager` events lag slightly; a very fast app-switch may be missed
  until the next poll.
- Some OEMs restrict launcher-intent queries, degrading app enumeration to an
  empty list (handled with an empty state, never a crash).
- Android 12+ can refuse a background foreground-service start after boot. The
  session survives and the service restarts when the app is next opened.
- Split-screen and picture-in-picture may report foreground packages
  unintuitively.

**Deliberately not implemented:**

- `DeviceAdminReceiver` uninstall protection — unreliable across OEMs, against
  Play policy for this use case, and revocable anyway. `canPreventUninstall`
  is hardcoded `false`.
- Blocking the Settings app — no public API allows it, and it would be hostile.
  `canRestrictSettings` is hardcoded `false`.
- AccessibilityService — see above.
