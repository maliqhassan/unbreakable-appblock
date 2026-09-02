# Daily Usage Limits — Android

"I want to use YouTube for only 15 minutes a day."

**Pro gating follows the existing tier limits.** Free allows one configured
limit; Pro allows one per app.

---

## The one idea that matters

An allowance is **measured, not counted down**.

It is *not* a timer that starts when you open the app and fires 15 minutes
later. It is a running total of real foreground time, recomputed from Android's
own usage record every time anyone asks. That is why it survives the app being
killed, the process dying, and a reboot: nothing is being remembered in
JavaScript, or anywhere else of ours.

```
Android UsageStats  ──►  UsageQuery  ──►  DailyLimitEngine
   (the record)          (measure)         (compare to limit)
                                                  │
                                                  ▼
                                          DailyLimitStore
                                                  │
manual ──┐                                        │
schedule ─┼──►  EffectiveLock (union)  ◄──────────┘
daily ───┘             │
                       ▼
             LockForegroundService
              (the ONE enforcer)
```

There is no second lock engine. Daily limits are a third **rule source**
alongside manual locks and schedules; all three feed `EffectiveLock`, and the
existing foreground service does the blocking.

---

## Data model

```ts
type DailyUsageLimit = {
  id: string;
  appPackageName: string;
  dailyLimitSeconds: number;   // seconds, displayed as "15 min/day"
  enabled: boolean;
  strictMode: boolean;
  createdAt: number;
  updatedAt: number;
};
```

One limit per app, enforced at creation: a second limit for the same package is
refused with "Edit that one instead" rather than creating two competing
allowances.

Each app's allowance is entirely independent. Using YouTube never spends
Instagram's budget.

---

## How usage is measured

`UsageQuery` reads `UsageStatsManager.queryEvents` from local midnight to now,
pairs each `ACTIVITY_RESUMED` with the following `ACTIVITY_PAUSED`/`STOPPED`,
and sums the intervals — **for the limited packages only**, never the whole
device.

Three cases the naive version gets wrong:

| Case | Handling |
| --- | --- |
| **Still open** | An unmatched RESUMED means the app is in the foreground *now*, so it accrues to the current instant. Without this, sitting in an app forever would cost nothing. |
| **Open across midnight** | Events before the window are clipped to its start, so last night's session does not spend today's budget. The query looks 12 hours behind midnight so the opening event is visible to clip. |
| **Repeated RESUMED** | Real devices emit these without an intervening pause. The earliest is kept so the interval is not truncated. |

Background time is never counted.

The identical algorithm exists in TypeScript (`src/utils/dailyUsage.ts`) as the
documented spec with the test suite; the Kotlin mirrors it because alarms and
boots arrive with no JS runtime alive.

### Accuracy

Android reports usage in intervals and flushes events on its own schedule, so
the figure can lag real time by a few seconds. **This is not millisecond-exact
enforcement and the app does not claim it is.** In practice a 15-minute
allowance ends within a second or two of 15 minutes, because the foreground app
is re-measured every second while the screen is on.

---

## When it is checked

The service already polls once a second while the screen is on. Daily limits
add one measurement to that tick — **only for the app currently in front of the
user**, since that is the only app accruing time.

```
tick → which app is in front?
     → does it have a limit?
     → measure that ONE package
     → spent? → write to DailyLimitStore → EffectiveLock → block
```

Everything else is event-driven: a single midnight alarm, boot, clock/timezone
changes, and limit edits. There is no extra polling, no second service, and no
JavaScript timer anywhere in the enforcement path.

### The service now runs to *measure*, not only to block

This is the one lifecycle change. Manual locks and schedules only need the
service while something is locked; a daily limit needs it running **before**
anything is locked, because it is what notices the threshold being crossed. So
the service stays alive whenever any limit is enabled, and its notification says
honestly *"Watching daily limits"* rather than implying something is blocked.

---

## Midnight reset

Allowances reset at **local midnight on the device's calendar day** — not 24
hours after first use.

`nextMidnight()` advances the calendar day rather than adding 24 hours, so
daylight-saving transitions still land on midnight. One `AlarmManager` alarm is
set for it; no long-running timer.

The UI says **"Resets tomorrow"**, never a countdown, because the allowance does
not tick down toward a moment — it is simply spent until the boundary.

---

## Reboot

`BootReceiver` calls `DailyLimitEngine.evaluate()` unconditionally, before
touching anything else. Because usage is read back from Android's record rather
than remembered, a spent allowance is still spent after a reboot — no need for
the user to open the app first.

---

## Interaction with manual locks and schedules

`EffectiveLock` merges every active source, with rules chosen so an overlap can
never *weaken* protection:

- **apps** — union
- **strict mode** — on if any source wants it
- **end** — the latest across sources

Consequences worth stating:

- A manual lock ending does **not** release an app whose daily allowance is
  spent.
- A midnight reset does **not** release an app a manual lock still covers.
- Deleting or disabling a limit recomputes only the daily contribution; an
  unrelated manual lock is untouched.

---

## Unknown usage — the deliberate policy

Four states are kept distinct, everywhere:

| State | Meaning |
| --- | --- |
| `KNOWN_ZERO` | Measured successfully; nothing used |
| `KNOWN_PARTIAL` | Measured; some allowance spent |
| `KNOWN_EXHAUSTED` | Measured; allowance spent |
| `UNKNOWN` | The measurement **failed** — revoked permission, bad query |

`UNKNOWN` is never converted to zero. `UsageQuery` returns `null`, the service
layer maps that to `usageSeconds: null`, and the UI says *"Can't measure right
now"* rather than *"0m used"*.

### What happens on a failed measurement

There are two opposite mistakes here, and both are silent on a device:

| Situation | Behaviour | Why |
| --- | --- | --- |
| **Allowance already spent today** | **Lock is preserved** until midnight | Clearing it would let a revoked permission silently *unlock* an app the user had already spent their day on |
| **Never measured today** | **Nothing is locked** | Assuming exhaustion would manufacture a lock out of a platform error |

The distinguishing fact is `measuredDayStart`: the local day the exhausted set
was established for. Only a set established **today** survives a failed
measurement; yesterday's is stale by definition, because the allowance has
since reset.

Critically, a preserved lock **invents no usage**. It is the last thing actually
measured, trusted only for the day it was measured on, and the UI says so:

> *"Usage can't be measured right now, so limits already reached stay locked
> until midnight."*

A successful measurement always wins over a preserved state, in both directions.

> This was a real bug found in this sprint's audit: `DailyLimitEngine` wrote
> `emptySet()` on measurement failure, so revoking Usage Access silently
> unlocked an exhausted app. Fixed, with tests.

## Permissions

Daily limits need **Usage Access**, the same permission the rest of the app
already gates on — no second permission surface. `PermissionService` is the only
place permissions are read.

If it is missing or revoked:

- `UsageQuery` returns **null**, not zero;
- `statusFor` propagates that as `usageSeconds: null`, `exhausted: false`;
- the engine writes a degraded reason and **enforces nothing**;
- the UI shows *"Daily limits need Usage Access — Fix permissions"*.

"We could not measure" and "you have used nothing" are deliberately different
all the way to the screen. Locking on an unmeasurable allowance would punish the
user for a platform problem; showing "0 minutes used" would be a lie they act
on.

---

## Free vs Pro

Gating goes through the existing `useSubscription()` hook and the existing
`FREE_LIMITS` / `PRO_LIMITS`. No second paywall, no duplicated subscription
logic; exceeding the allowance opens the existing `SubscriptionScreen`.

Limits created while Pro are **not deleted** when a subscription lapses —
losing Pro should not destroy configuration the user already made.

No account is required. Guests use the feature under the Free-plan limits, and
nothing is stored in Firebase.

---

## Future time schedules

Already done, as it happens — schedules shipped in the previous sprint and are
the second rule source. Daily limits slotted in as the third with no rewrite,
which is the evidence that the abstraction holds:

```
manual  ─┐
schedule ─┼──► EffectiveLock ──► LockForegroundService
daily   ─┘
```

A fourth source needs a store, an engine, and three lines in `EffectiveLock`.

---

## Verification status

**Automated** ✅ — 263 tests, of which 51 cover the daily-limit maths
(measurement from raw events, midnight boundaries, limit changes, validation,
independence between apps) and 21 cover persistence and gating. TypeScript,
ESLint and the Kotlin compiler all pass.

**Physical Android device** ❌ — **not verified.** No device or emulator was
available. Unit tests prove the algorithm and the JS wiring; they say nothing
about whether `UsageStatsManager` returns what we expect on your hardware, or
whether the service survives your OEM's battery manager.

### Device test procedure

| # | Test | Steps | Pass |
| --- | --- | --- | --- |
| 1 | **Basic limit** | YouTube 15 min/day, use ~15 min | Becomes locked |
| 2 | **Partial usage** | Use 5 min | ~10 min remaining shown |
| 3 | **Background time** | Use 2 min, background 5 min | ~2 min counted, not 7 |
| 4 | **Multiple sessions** | 3 min + 4 min + 5 min | ~12 min total |
| 5 | **Multiple apps** | Exhaust YouTube with an Instagram limit set | Instagram still opens |
| 6 | **Increase limit** | Exhaust 15 min, change to 30 min | Usable again |
| 7 | **Reboot exhausted** | Exhaust, reboot, open the app | Still locked, no app launch needed |
| 8 | **Reboot with allowance** | Use 5 of 15 min, reboot | ~10 min remaining |
| 9 | **Midnight reset** | Exhaust, wait past local midnight | New day's allowance |
| 10 | **Session across midnight** | Keep the app open through midnight | Usage split between the days |
| 11 | **Usage Access revoked** | Revoke with a limit configured | "Can't measure", never a fake zero. **If already exhausted, stays locked** |
| 12 | **Manual + daily** | Exhaust daily, add a manual lock, end the manual lock | Still locked |
| 13 | **Schedule + daily** | Let a schedule end while daily is exhausted | Still locked |
| 14 | **Disable / delete** | Remove the daily rule | Daily source gone; other sources unaffected |
| 15 | **Process lifecycle** | Swipe app from recents | Native monitoring continues |

Case **11** is the one to run first: it is the invariant fixed this sprint, and
the failure mode is completely invisible from the UI.


---

## Known limitations

- **UsageStats granularity.** A few seconds of lag is inherent; the app does not
  claim exact enforcement.
- **Force-stop** clears alarms and stops the service until the app is reopened
  or the device reboots. No app can avoid this.
- **Doze** can delay the midnight reset by minutes when exact alarms are
  unavailable — harmless at a daily boundary.
- Everything in [ANDROID.md](ANDROID.md) still applies: uninstalling, revoking
  permissions and safe mode all end enforcement.

### OEM behaviour

| OEM | Expect |
| --- | --- |
| **Pixel / stock** | Baseline |
| **Samsung** | "Put unused apps to sleep" can kill the measuring service; exclude the app in Battery settings |
| **Xiaomi / MIUI** | Most restrictive — needs Autostart and "No restrictions" battery, or measurement stops when the app is closed |
| **OnePlus / Oppo / Vivo** | Deep optimisation kills background services; lock the app in recents |

None of this is verified on hardware. The matrix above is the gate.
