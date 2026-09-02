package expo.modules.unbreakablelock

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * The daily-limit rule engine.
 *
 * One entry point — [evaluate] — which recomputes from Android's usage record
 * and writes the result into [DailyLimitStore]. It enforces nothing itself:
 * that is [LockForegroundService]'s job, exactly as for manual locks and
 * schedules. There is one enforcement engine in this app and this is not a
 * second one.
 *
 * Sits alongside [ScheduleCoordinator] as a peer rule source; both feed
 * [EffectiveLock], which merges them.
 */
object DailyLimitEngine {
    private const val TAG = "UnbreakableDaily"
    private const val MIDNIGHT_REQUEST_CODE = 8122

    /**
     * Recomputes every limit against real usage.
     *
     * @return true when at least one allowance is spent.
     */
    fun evaluate(context: Context, nowMs: Long = System.currentTimeMillis()): Boolean {
        val app = context.applicationContext
        val limits = DailyLimitStore.readLimits(app).filter { it.enabled }

        if (limits.isEmpty()) {
            DailyLimitStore.saveLockState(app, emptySet(), false, 0L, null, 0L, 0L)
            scheduleMidnightReset(app, nowMs)
            return false
        }

        val packages = limits.map { it.packageName }.toSet()
        val usage = UsageQuery.usageTodaySeconds(app, packages, nowMs)

        if (usage == null) {
            // The measurement failed -- revoked Usage Access, or a bad query.
            //
            // Two very different situations hide behind that, and conflating
            // them causes opposite bugs:
            //
            //   1. Already exhausted today. Clearing the lock here would mean a
            //      revoked permission silently UNLOCKS an app the user had
            //      already spent their allowance on. The established state is
            //      preserved until midnight. This invents no usage: it is the
            //      last thing we actually measured, and it is only trusted for
            //      the day it was measured on.
            //
            //   2. Never measured today. There is nothing to preserve, so
            //      nothing is locked. Assuming exhaustion would manufacture a
            //      lock out of a platform failure.
            val previous = DailyLimitStore.readLockState(app)
            val today = UsageQuery.startOfToday(nowMs)
            val establishedToday =
                previous.packages.isNotEmpty() && previous.measuredDayStart == today

            DailyLimitStore.saveLockState(
                app,
                if (establishedToday) previous.packages else emptySet(),
                if (establishedToday) previous.strictMode else false,
                UsageQuery.nextMidnight(nowMs),
                if (establishedToday) {
                    "Usage can't be measured right now, so limits already reached stay " +
                        "locked until midnight."
                } else {
                    "Usage access is off, so daily limits are not being enforced."
                },
                // Provenance is carried forward untouched: this attempt measured
                // nothing, so it must not look like a fresh measurement.
                previous.measuredDayStart,
                previous.lastMeasuredAt
            )

            syncService(app)
            scheduleMidnightReset(app, nowMs)
            return establishedToday
        }

        val exhausted = HashSet<String>()
        var strict = false

        for (limit in limits) {
            val used = usage[limit.packageName] ?: 0L
            if (used >= limit.limitSeconds) {
                exhausted.add(limit.packageName)
                if (limit.strictMode) strict = true
            }
        }

        // Defence in depth, matching the manual path: a limit must never be able
        // to lock the user out of their launcher or Settings.
        val safe = exhausted - ProtectedPackages.forDevice(app)

        DailyLimitStore.saveLockState(
            app,
            safe,
            strict,
            UsageQuery.nextMidnight(nowMs),
            null,
            UsageQuery.startOfToday(nowMs),
            nowMs
        )

        syncService(app)
        scheduleMidnightReset(app, nowMs)

        return safe.isNotEmpty()
    }

    /**
     * Keeps the enforcement service alive while there is anything to watch.
     *
     * Unlike manual locks and schedules, daily limits need the service running
     * *before* anything is locked — it is what measures usage and notices the
     * threshold being crossed. Without this the allowance would only ever be
     * checked when the app happened to be open.
     */
    fun syncService(context: Context) {
        val app = context.applicationContext
        val shouldRun = EffectiveLock.isActive(app) || DailyLimitStore.hasEnabledLimits(app)

        if (shouldRun) {
            try {
                LockForegroundService.start(app)
            } catch (e: Exception) {
                // Android 12+ restricts background foreground-service starts.
                // State survives; the service starts next time the app opens.
                Log.w(TAG, "Could not start the lock service for daily limits", e)
            }
        } else if (LockForegroundService.isRunning) {
            LockForegroundService.stop(app)
        }
    }

    /**
     * One alarm at the next local midnight, to clear spent allowances.
     *
     * No long-running timer and no polling for the reset: the transition is a
     * known instant, so it gets a single alarm. Exact alarms may be unavailable
     * on Android 12+, in which case the reset can land a few minutes late —
     * harmless for a daily boundary, and documented rather than hidden.
     */
    private fun scheduleMidnightReset(context: Context, nowMs: Long) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
            ?: return

        val pendingIntent = PendingIntent.getBroadcast(
            context.applicationContext,
            MIDNIGHT_REQUEST_CODE,
            Intent(context.applicationContext, ScheduleAlarmReceiver::class.java)
                .setAction(ScheduleAlarmReceiver.ACTION_DAILY_RESET),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        alarmManager.cancel(pendingIntent)

        // Nothing configured means nothing to reset.
        if (!DailyLimitStore.hasEnabledLimits(context)) return

        val midnight = UsageQuery.nextMidnight(nowMs)

        try {
            val exact = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                alarmManager.canScheduleExactAlarms()
            } else {
                true
            }

            if (exact) {
                alarmManager.setExactAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    midnight,
                    pendingIntent
                )
            } else {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, midnight, pendingIntent)
            }
        } catch (e: SecurityException) {
            alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, midnight, pendingIntent)
        }
    }

    /**
     * Today's status for every configured limit, for the UI.
     *
     * `usageSeconds` is -1 when usage could not be measured, which the JS layer
     * maps to null so "unknown" never renders as "zero".
     */
    fun statusJson(context: Context, nowMs: Long = System.currentTimeMillis()): String {
        val limits = DailyLimitStore.readLimits(context)
        if (limits.isEmpty()) return "[]"

        val usage = UsageQuery.usageTodaySeconds(
            context,
            limits.map { it.packageName }.toSet(),
            nowMs
        )
        val resetsAt = UsageQuery.nextMidnight(nowMs)
        val lockState = DailyLimitStore.readLockState(context)

        val array = org.json.JSONArray()
        for (limit in limits) {
            val used = usage?.get(limit.packageName) ?: -1L
            array.put(
                org.json.JSONObject().apply {
                    put("id", limit.id)
                    put("packageName", limit.packageName)
                    put("limitSeconds", limit.limitSeconds)
                    // -1 means "could not measure", never "zero".
                    put("usageSeconds", used)
                    put("enabled", limit.enabled)
                    put("strictMode", limit.strictMode)
                    put("resetsAt", resetsAt)
                    // The authoritative answer, which survives a failed
                    // measurement. Without this the UI would show "usage
                    // unavailable" next to an app that is genuinely locked.
                    put("lockedNow", lockState.packages.contains(limit.packageName))
                }
            )
        }
        return array.toString()
    }
}
