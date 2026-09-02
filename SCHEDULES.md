# Recurring Schedules — Android

Automatically lock chosen apps at chosen times. **Pro feature.**

---

## Architecture

```
SchedulesScreen / CreateScheduleScreen        UI, authoring only
        ↓
ScheduleService  ──►  ScheduleStore (Kotlin, SharedPreferences)
        ↓
ScheduleCoordinator                           the engine
        ↓  computes active set, sets ONE alarm
ScheduleLockStore ──┐
                    ├──►  EffectiveLock  ──►  LockForegroundService
LockStateStore    ──┘        (union)              (existing engine)
```

**There is no second enforcement engine.** The coordinator decides *what* should
be locked and writes it down; the existing foreground service does the locking,
exactly as it does for a manual lock.

### Where the logic lives — and why it exists twice

The recurrence maths is implemented in **both** TypeScript
(`src/utils/schedule.ts`) and Kotlin (`ScheduleCalculator.kt`).

That duplication is deliberate, and it is a real cost worth naming:

- Alarms, boots and time-change broadcasts arrive with **no JS runtime alive**.
  The decision has to be makeable in Kotlin alone.
- The UI needs the same answers to show "Active" and "Next at 9 AM" without
  waking native on every render.

The TypeScript version is the **spec**: it carries the 51-test suite that
defines the semantics. The Kotlin mirrors it. Changing one means changing both.

---

## The model

```ts
type LockSchedule = {
  id: string;
  name: string;
  enabled: boolean;
  appPackageNames: string[];
  daysOfWeek: Weekday[];   // explicit list, never "weekdays" as a concept
  startTime: string;       // local wall clock, "HH:mm"
  endTime: string;
  strictMode: boolean;
  createdAt: number;
  updatedAt: number;
};
```

**Times are local wall clock, never instants.** "Weekdays at 22:00" means 22:00
wherever the user is. Storing a UTC timestamp would silently shift the schedule
when they cross a timezone, which is the opposite of what anyone means by a
daily routine.

`startTime === endTime` is **rejected**, not guessed. Zero minutes or twenty-four
hours? Refusing beats silently picking one.

### Same-day vs overnight

| Definition | Meaning |
| --- | --- |
| `09:00 → 17:00` | Active 09:00–17:00 on each selected day. End is exclusive. |
| `22:00 → 06:00` | Starts 22:00 on a selected day, runs to 06:00 **the next morning**. |

The subtle part of overnight: at 02:00 Tuesday, the occurrence running is the one
that began **Monday**. So `isScheduleActive` checks both the window that could
have opened today and the one that could have opened yesterday.

A Friday-only 22:00→06:00 schedule is therefore active at 02:00 Saturday and
**not** active at 23:00 Saturday. The selected day is the *starting* day.

---

## Overlapping schedules

Three merge rules, each chosen so an overlap can never *weaken* protection:

| | Rule | Why |
| --- | --- | --- |
| Apps | **Union** | No app slips through because one schedule omitted it |
| Strict Mode | **Any** active schedule wants it | The stricter intent wins |
| End time | **Latest** | A short schedule ending must not unlock apps a longer one still covers |

```
Work    09:00–17:00   YouTube, Instagram
Social  12:00–20:00   TikTok, Instagram   (strict)

At 13:00 → YouTube + Instagram + TikTok, strict, until 20:00
```

The same rules merge the schedule contribution with a manual lock, in
`EffectiveLock.kt`.

---

## Manual vs scheduled locks

```
LockStateStore     → the manual lock the user started by hand
ScheduleLockStore  → the merged contribution of running schedules
        ↓
EffectiveLock      → union of both; this is what gets enforced
```

Neither source may cancel the other:

- `stopLock()` from the UI clears **only** the manual source. If a schedule is
  still running, enforcement continues.
- A schedule ending recomputes only the schedule contribution. A manual lock is
  untouched.
- The service shuts down only when **every** source is finished.

The Active Lock screen shows **"Scheduled Lock"** with the schedule's name when
the session came from a schedule, rather than implying the user started it.

---

## Background execution

**No polling.** The next transition — the earliest start or end across all
schedules — is computed exactly, and **one** `AlarmManager` alarm is set for it.
Between transitions nothing runs at all.

```
ScheduleCoordinator.reevaluate()
   ├─ compute active schedules at now
   ├─ write ScheduleLockStore (or clear it)
   ├─ start/stop LockForegroundService via EffectiveLock
   └─ set ONE alarm for the next transition
```

`reevaluate()` is idempotent and recomputes from scratch, so calling it twice
costs nothing and no event can leave a half-advanced state machine.

### What triggers a re-evaluation

| Trigger | Receiver |
| --- | --- |
| The transition alarm | `ScheduleAlarmReceiver` |
| `BOOT_COMPLETED` / `MY_PACKAGE_REPLACED` | `BootReceiver` |
| `ACTION_TIME_CHANGED` | `ScheduleAlarmReceiver` |
| `ACTION_TIMEZONE_CHANGED` | `ScheduleAlarmReceiver` |
| Creating / editing / deleting a schedule | `saveSchedules` from JS |
| App foreground | `refreshSchedules` from JS |

### Exact alarms

Exact alarms need `SCHEDULE_EXACT_ALARM`, which the user can revoke on Android
12+. The engine checks `canScheduleExactAlarms()` and falls back to
`setAndAllowWhileIdle`, which **Doze may delay by several minutes**.

The Schedules screen says so plainly when the permission is missing rather than
promising to-the-minute accuracy Android will not give.

---

## Reboot and missed transitions

`BootReceiver` calls `reevaluate()` **unconditionally**, before touching the
manual session. That is what handles the missed-transition case:

> Schedule is 22:00 → 06:00. Device powered off at 21:00, booted at 02:00.

At boot the engine evaluates *the current time against the schedule*, sees the
window is already open, and starts enforcing immediately. It does not wait for
the next 22:00, and it does not need the app to have been opened.

---

## Time and timezone changes

Evaluation is a pure function of the supplied instant. There is no accumulated
counter to corrupt, so a clock jump is simply a different input.

On `TIME_CHANGED` or `TIMEZONE_CHANGED` the engine recomputes and re-arms the
alarm against the new local time.

**This is not anti-tamper.** The user is entitled to set their own clock, and
this app makes no claim to prevent it. Recomputing is simply what "22:00 local"
honestly means. (Note the deliberate contrast with a *manual* lock, which does
resist a forward clock jump — there the user asked for a fixed duration, so
shortening it would break a promise they made to themselves.)

---

## Free vs Pro

Schedules are **Pro**. Creation routes to the existing `SubscriptionScreen` —
there is no second paywall, and the limits come from the same
`FREE_LIMITS`/`PRO_LIMITS` that gate manual locks.

Free users can **see** the Schedules screen; the feature is worth understanding
before paying for it. `CreateScheduleScreen` re-checks entitlement on mount and
redirects, so a deep link or a lapsed subscription cannot slip past.

Existing schedules are **not deleted** when Pro lapses — losing a subscription
should not destroy work the user already did.

---

## Real-device test matrix

Run on hardware. An emulator will pass things a real OEM build fails.

| # | Test | Steps | Pass |
| --- | --- | --- | --- |
| **1** | Basic | Schedule every day, now+2min → now+5min | Lock starts and ends on its own |
| **2** | Overnight | 22:00 → 06:00; check 23:00, 02:00, 05:59, 06:01 | Active for the first three, not the last |
| **3** | App closed | Create schedule, swipe app from recents, wait for start | Lock still starts |
| **4** | Force stop | Force-stop from Settings, wait for start | ⚠️ Alarms are cancelled by force-stop — see limitations |
| **5** | Reboot mid-window | Start an active schedule, reboot | Enforcement resumes within seconds of boot |
| **6** | Missed transition | Power off before start, boot inside the window | Starts immediately, does not wait for tomorrow |
| **7** | Timezone | Change timezone during a schedule | Recomputes against new local time |
| **8** | Clock change | Move the clock past a start time | Schedule activates |
| **9** | Multiple | Two overlapping schedules | Union of apps; latest end honoured |
| **10** | Delete active | Delete one of two overlapping schedules | Remaining apps stay locked |
| **11** | Edit active | Change the end time of a running schedule | Takes effect immediately |
| **12** | Manual + schedule | Start a manual lock, let a schedule begin | Both coexist; ending one keeps the other |
| **13** | Permission revoked | Revoke Usage Access during a scheduled lock | "Not Enforcing" shown — no false claim |
| **14** | Exact alarms off | Revoke "Alarms & reminders" | Warning shown; transitions may be minutes late |

---

## Known limitations

**These are real and not worked around:**

- **Force-stop cancels alarms.** Android drops all alarms when the user
  force-stops an app, and nothing can re-arm them until the app is opened or
  the device reboots. A force-stopped app cannot schedule anything. No app can
  avoid this.
- **Doze can delay an inexact alarm** by several minutes when
  `SCHEDULE_EXACT_ALARM` is unavailable.
- **Android 12+ can refuse a background foreground-service start.** The state
  survives and the service starts when the app is next opened, but there may be
  a gap.
- Everything in [ANDROID.md](ANDROID.md) still applies: uninstalling, revoking
  permissions, and safe mode all end enforcement, and no app can prevent that.

### OEM behaviour

| OEM | Expect |
| --- | --- |
| **Pixel / stock** | Baseline. Should pass the whole matrix. |
| **Samsung** | "Put unused apps to sleep" can drop alarms. Exclude the app from Battery → Background usage limits. |
| **Xiaomi / MIUI** | Most restrictive. Needs Autostart **and** "No restrictions" battery, or alarms will not survive. |
| **OnePlus / Oppo / Vivo** | Deep optimisation kills alarms; lock the app in recents. |
| **Huawei** | Add to "Protected apps". |

**None of this has been verified on hardware.** The matrix above is the gate.

---

## Test coverage

70 schedule tests across two suites:

- `__tests__/schedule.test.ts` — the recurrence spec: parsing, same-day,
  overnight, day selection, overlaps, next transition, missed transitions,
  clock and timezone changes, validation.
- `__tests__/scheduleService.test.ts` — persistence, editing, deletion,
  enable/disable, Home summary, manual/schedule independence, Pro gating.
