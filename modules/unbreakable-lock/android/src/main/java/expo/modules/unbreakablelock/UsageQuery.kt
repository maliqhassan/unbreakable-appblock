package expo.modules.unbreakablelock

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build
import android.util.Log
import java.util.Calendar

/**
 * Real foreground time, measured from Android's own usage record.
 *
 * This is the whole basis of daily limits: an allowance is **measured, not
 * counted down**. Closing the app, killing the process, or rebooting changes
 * nothing, because the answer is recomputed from the platform every time.
 *
 * A mirror of `usageSecondsFromEvents` in `src/utils/dailyUsage.ts`, which
 * carries the test suite that defines these semantics.
 */
object UsageQuery {
    private const val TAG = "UnbreakableUsage"

    /** Epoch ms for local midnight at the start of today. */
    fun startOfToday(nowMs: Long = System.currentTimeMillis()): Long {
        val calendar = Calendar.getInstance().apply {
            timeInMillis = nowMs
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        return calendar.timeInMillis
    }

    /**
     * Epoch ms for the next local midnight — when allowances reset.
     *
     * Advances the calendar day rather than adding 24 hours, so daylight-saving
     * transitions still land on midnight.
     */
    fun nextMidnight(nowMs: Long = System.currentTimeMillis()): Long {
        val calendar = Calendar.getInstance().apply {
            timeInMillis = nowMs
            add(Calendar.DAY_OF_YEAR, 1)
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        return calendar.timeInMillis
    }

    /**
     * Foreground seconds today, per package, for the packages asked about.
     *
     * @return a map of package -> seconds, or null when Android could not be
     *   queried at all. Null is deliberately distinct from an empty map:
     *   "we could not ask" must never be reported to the user as "you have used
     *   nothing", and must never trigger a lock.
     */
    fun usageTodaySeconds(
        context: Context,
        packages: Set<String>,
        nowMs: Long = System.currentTimeMillis()
    ): Map<String, Long>? {
        if (packages.isEmpty()) return emptyMap()

        // Only ask when we can actually be told; otherwise the empty result
        // would look like zero usage.
        if (!LockPermissions.isGranted(context, LockPermissions.USAGE_ACCESS)) return null

        val usage = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
            ?: return null

        val windowStart = startOfToday(nowMs)

        // Query a little before midnight so a session that began yesterday
        // evening is visible; it is clipped to the window below.
        val events = try {
            usage.queryEvents(windowStart - LOOKBEHIND_MS, nowMs)
        } catch (e: Exception) {
            Log.w(TAG, "queryEvents failed", e)
            return null
        }

        val totals = HashMap<String, Long>(packages.size)
        val openedAt = HashMap<String, Long>(packages.size)
        for (pkg in packages) totals[pkg] = 0L

        val event = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            val pkg = event.packageName ?: continue
            if (!packages.contains(pkg)) continue

            when {
                isForegroundEvent(event) -> {
                    // Consecutive RESUMEDs happen on real devices; keep the
                    // earliest so the interval is not truncated.
                    if (!openedAt.containsKey(pkg)) openedAt[pkg] = event.timeStamp
                }

                isBackgroundEvent(event) -> {
                    val opened = openedAt.remove(pkg) ?: continue
                    val from = maxOf(opened, windowStart)
                    val to = minOf(event.timeStamp, nowMs)
                    if (to > from) totals[pkg] = (totals[pkg] ?: 0L) + (to - from)
                }
            }
        }

        // Anything still open is in the foreground right now and accrues up to
        // now. Without this, sitting in an app forever would cost nothing.
        for ((pkg, opened) in openedAt) {
            val from = maxOf(opened, windowStart)
            if (nowMs > from) totals[pkg] = (totals[pkg] ?: 0L) + (nowMs - from)
        }

        return totals.mapValues { (_, ms) -> ms / 1000L }
    }

    /** Convenience for a single package. Null means "could not be measured". */
    fun usageTodaySeconds(
        context: Context,
        packageName: String,
        nowMs: Long = System.currentTimeMillis()
    ): Long? = usageTodaySeconds(context, setOf(packageName), nowMs)?.get(packageName)

    private fun isForegroundEvent(event: UsageEvents.Event): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            event.eventType == UsageEvents.Event.ACTIVITY_RESUMED
        } else {
            @Suppress("DEPRECATION")
            event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND
        }

    private fun isBackgroundEvent(event: UsageEvents.Event): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            event.eventType == UsageEvents.Event.ACTIVITY_PAUSED ||
                event.eventType == UsageEvents.Event.ACTIVITY_STOPPED
        } else {
            @Suppress("DEPRECATION")
            event.eventType == UsageEvents.Event.MOVE_TO_BACKGROUND
        }

    /**
     * How far before midnight to start reading events.
     *
     * A session opened last night must be visible so it can be clipped to the
     * window; without the lookbehind its opening RESUMED would be missing and
     * the whole session would be attributed to today.
     */
    private const val LOOKBEHIND_MS = 12 * 60 * 60 * 1000L
}
