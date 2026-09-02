package expo.modules.unbreakablelock

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Wakes the schedule engine.
 *
 * Three things reach it:
 *
 *  - **The transition alarm.** The single alarm set for the next start or end.
 *  - **ACTION_TIME_CHANGED.** The user moved the clock. Schedules are defined
 *    in wall-clock terms, so "10pm" genuinely means the *new* 10pm and the
 *    engine must recompute. This is not an attempt to prevent clock changes —
 *    the user is entitled to set their own clock — it is simply honouring what
 *    a wall-clock schedule means.
 *  - **ACTION_TIMEZONE_CHANGED.** Same reasoning: a schedule follows the user.
 *
 * All three do the same thing, because [ScheduleCoordinator.reevaluate]
 * recomputes from scratch rather than advancing a state machine.
 */
class ScheduleAlarmReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "UnbreakableSchedules"
        const val ACTION_TRANSITION = "expo.modules.unbreakablelock.SCHEDULE_TRANSITION"
        const val ACTION_DAILY_RESET = "expo.modules.unbreakablelock.DAILY_RESET"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return

        val known = action == ACTION_TRANSITION ||
            action == ACTION_DAILY_RESET ||
            action == Intent.ACTION_TIME_CHANGED ||
            action == Intent.ACTION_TIMEZONE_CHANGED
        if (!known) return

        // Receivers get roughly ten seconds. Everything here is SharedPreferences
        // reads and one alarm call, so it stays well inside that without needing
        // goAsync().
        try {
            val scheduleActive = ScheduleCoordinator.reevaluate(context)
            // Daily allowances are wall-clock bound too, so a clock or timezone
            // change moves the reset boundary and both engines must recompute.
            val dailyActive = DailyLimitEngine.evaluate(context)
            Log.d(
                TAG,
                "Re-evaluated after $action; schedule=$scheduleActive daily=$dailyActive"
            )
        } catch (e: Exception) {
            Log.e(TAG, "Schedule re-evaluation failed after $action", e)
        }
    }
}
