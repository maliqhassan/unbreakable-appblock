package expo.modules.unbreakablelock

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * The schedule engine.
 *
 * One entry point — [reevaluate] — called whenever anything could have changed:
 * an alarm firing, a boot, a clock or timezone change, or the user editing a
 * schedule. It is idempotent, so calling it too often is harmless and calling
 * it twice for the same event costs nothing.
 *
 * What it does NOT do is enforce anything itself. It computes which schedules
 * are running, writes that into [ScheduleLockStore], and lets the existing
 * [LockForegroundService] do the work. There is one enforcement engine in this
 * app and this is not a second one.
 *
 * **No polling.** The next transition is computed exactly and a single alarm is
 * set for it. Between transitions nothing runs at all.
 */
object ScheduleCoordinator {
    private const val TAG = "UnbreakableSchedules"
    private const val ALARM_REQUEST_CODE = 8121

    /**
     * Recomputes everything from the persisted schedules and the current time.
     *
     * @return true when a schedule is currently running.
     */
    fun reevaluate(context: Context): Boolean {
        val app = context.applicationContext
        val now = System.currentTimeMillis()
        val schedules = ScheduleStore.readAll(app)

        val active = ScheduleCalculator.activeSchedules(schedules, now)

        if (active.isEmpty()) {
            ScheduleLockStore.clear(app)
        } else {
            val packages = HashSet<String>()
            val ids = HashSet<String>()
            val names = HashSet<String>()
            var strict = false
            var end = 0L

            for (schedule in active) {
                // Union of apps, strictest mode, latest end: an overlap must
                // never weaken protection. See EffectiveLock for the same rules
                // applied across manual and scheduled sources.
                packages.addAll(schedule.packages)
                ids.add(schedule.id)
                names.add(schedule.name)
                if (schedule.strictMode) strict = true
                end = maxOf(end, ScheduleCalculator.currentEnd(schedule, now))
            }

            // Protected packages are stripped here as well as at manual start:
            // a schedule must not be able to lock the user out of their launcher.
            val safePackages = packages - ProtectedPackages.forDevice(app)

            if (safePackages.isEmpty() || end <= now) {
                ScheduleLockStore.clear(app)
            } else {
                ScheduleLockStore.save(app, end, strict, safePackages, ids, names)
            }
        }

        syncService(app)
        scheduleNextTransition(app, schedules, now)

        return ScheduleLockStore.isActive(app, now)
    }

    /**
     * Starts or stops the enforcement service to match the merged state.
     *
     * Note it reads [EffectiveLock], not the schedule store: a manual lock may
     * still be running when every schedule has ended, and stopping the service
     * then would silently drop the user's own session.
     */
    private fun syncService(context: Context) {
        val effective = EffectiveLock.read(context)

        if (effective.active) {
            if (!LockForegroundService.isRunning) {
                try {
                    LockForegroundService.start(context)
                } catch (e: Exception) {
                    // Android 12+ restricts background foreground-service starts.
                    // State survives; the service picks it up on next launch.
                    Log.w(TAG, "Could not start the lock service from a schedule", e)
                }
            } else {
                // Already running, but the package set or end time may have
                // changed. A no-op start makes it re-read persisted state.
                try {
                    LockForegroundService.start(context)
                } catch (e: Exception) {
                    Log.w(TAG, "Could not refresh the lock service", e)
                }
            }
        } else if (LockForegroundService.isRunning) {
            LockForegroundService.stop(context)
        }
    }

    /**
     * Sets one alarm for the next transition.
     *
     * Exact alarms need SCHEDULE_EXACT_ALARM on Android 12+, which the user can
     * revoke. When it is unavailable we fall back to an inexact alarm rather
     * than failing: Android may then delay the transition by several minutes
     * during Doze. That is a real limitation and is documented rather than
     * papered over.
     */
    private fun scheduleNextTransition(
        context: Context,
        schedules: List<LockSchedule>,
        now: Long
    ) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
        if (alarmManager == null) {
            Log.w(TAG, "No AlarmManager; schedules cannot fire in the background")
            return
        }

        val pendingIntent = alarmIntent(context)
        alarmManager.cancel(pendingIntent)

        val next = ScheduleCalculator.nextTransition(schedules, now)
        if (next <= 0L) {
            Log.d(TAG, "No upcoming schedule transition; no alarm set")
            return
        }

        try {
            if (canScheduleExactAlarms(alarmManager)) {
                alarmManager.setExactAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    next,
                    pendingIntent
                )
            } else {
                Log.w(TAG, "Exact alarms unavailable; transition may be delayed by Doze")
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pendingIntent)
            }
        } catch (e: SecurityException) {
            // The permission was revoked between the check and the call.
            Log.w(TAG, "Exact alarm refused; falling back to inexact", e)
            alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pendingIntent)
        }
    }

    fun canScheduleExactAlarms(context: Context): Boolean {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
            ?: return false
        return canScheduleExactAlarms(alarmManager)
    }

    private fun canScheduleExactAlarms(alarmManager: AlarmManager): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            alarmManager.canScheduleExactAlarms()
        } else {
            true
        }

    private fun alarmIntent(context: Context): PendingIntent {
        val intent = Intent(context.applicationContext, ScheduleAlarmReceiver::class.java)
            .setAction(ScheduleAlarmReceiver.ACTION_TRANSITION)

        return PendingIntent.getBroadcast(
            context.applicationContext,
            ALARM_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
}
