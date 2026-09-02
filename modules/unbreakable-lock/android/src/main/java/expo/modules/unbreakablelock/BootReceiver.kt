package expo.modules.unbreakablelock

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Restores enforcement after a reboot or an app update.
 *
 * Without this, rebooting the phone would quietly end an active lock -- which
 * would make the whole feature trivially avoidable and, worse, would make the
 * app dishonest about what it is doing.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            return
        }

        // Schedules first, and unconditionally: the device may have been off
        // through a schedule's start time, in which case the window is already
        // running and enforcement must resume immediately rather than waiting
        // for the next occurrence.
        try {
            ScheduleCoordinator.reevaluate(context)
        } catch (e: Exception) {
            Log.w("UnbreakableLockBoot", "Schedule re-evaluation failed after boot", e)
        }

        // Daily limits too, and unconditionally: usage is read back from
        // Android's own record, so a spent allowance is still spent after a
        // reboot without the user having to open the app.
        try {
            DailyLimitEngine.evaluate(context)
        } catch (e: Exception) {
            Log.w("UnbreakableLockBoot", "Daily limit evaluation failed after boot", e)
        }

        val state = LockStateStore.read(context)
        if (!state.active) return

        if (action == Intent.ACTION_BOOT_COMPLETED) {
            // elapsedRealtime restarted at zero, so the monotonic deadline no
            // longer means anything. Fall back to the wall-clock deadline.
            LockStateStore.invalidateElapsedDeadline(context)
        }

        // A session that ran out while the device was off must never come back.
        if (LockStateStore.isExpired(context)) {
            LockStateStore.clear(context)
            return
        }

        // Whatever was wrong before the reboot (a revoked permission, a service
        // that would not start) may not be wrong now. Clear the flag and let
        // the service re-detect, rather than carrying a stale warning forward.
        LockStateStore.setDegradedReason(context, null)

        try {
            LockForegroundService.start(context)
        } catch (e: Exception) {
            // Android 12+ restricts starting foreground services from the
            // background in some states. The persisted lock survives, and the
            // service restarts next time the app is opened.
            Log.w("UnbreakableLockBoot", "Could not restart lock service", e)
        }
    }
}
