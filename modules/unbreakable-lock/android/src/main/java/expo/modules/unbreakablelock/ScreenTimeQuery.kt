package expo.modules.unbreakablelock

import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Build
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/**
 * Screen time, broken down by app and by category.
 *
 * Separate from [UsageQuery], which exists to enforce daily limits and is
 * deliberately narrow: it measures only the packages it was asked about, from
 * paired foreground/background events, because an allowance must be exact.
 * This is the reporting view — every app, several days, for a chart.
 *
 * **Where the categories come from.** Android apps declare their own category
 * in their manifest and the platform exposes it as `ApplicationInfo.category`.
 * That is the honest source: it is the developer's own classification, not a
 * guess of ours and not a list we would have to maintain. Apps that declare
 * nothing land in "Other" rather than being assigned somewhere plausible —
 * inventing a category would make the chart look more authoritative than it is.
 */
object ScreenTimeQuery {
    private const val TAG = "UnbreakableScreenTime"

    /**
     * Apps below this are noise in a chart — a launcher redraw, a notification
     * shade tap. Excluding them keeps the breakdown readable.
     *
     * Kept low on purpose: usage only starts accruing once the user grants
     * usage access, so on the first day there may be very little to show, and a
     * high floor would leave the screen looking broken rather than new.
     */
    private const val MIN_REPORTABLE_SECONDS = 20L

    private const val HOUR_MS = 60L * 60L * 1000L

    /** Events from before midnight, so a session begun yesterday is visible. */
    private const val LOOKBEHIND_MS = 6L * HOUR_MS

    /**
     * Foreground seconds per app, for a run of days ending today.
     *
     * Today is measured from paired events, the same way daily limits are, so
     * the two never disagree on screen. Earlier days come from Android's own
     * daily rollups: events are not retained reliably beyond a few days, and a
     * rollup is both cheaper and all a trend line needs.
     *
     * @return null when usage access is missing. Null is distinct from empty:
     *   "we cannot ask" must never be drawn as "you used nothing".
     */
    fun dailyTotals(
        context: Context,
        days: Int,
        nowMs: Long = System.currentTimeMillis()
    ): List<Map<String, Long>>? {
        if (!LockPermissions.isGranted(context, LockPermissions.USAGE_ACCESS)) return null

        val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
            ?: return null

        val out = ArrayList<Map<String, Long>>(days)

        // Oldest first, so the caller can draw left to right.
        for (offset in (days - 1) downTo 0) {
            val dayStart = startOfDay(nowMs, -offset)
            val dayEnd = minOf(startOfDay(nowMs, -offset + 1), nowMs)
            if (dayEnd <= dayStart) {
                out.add(emptyMap())
                continue
            }

            val totals = if (offset == 0) {
                todayFromEvents(context, dayStart, nowMs)
            } else {
                rollupTotals(manager, dayStart, dayEnd)
            }
            out.add(totals)
        }

        return out
    }

    /**
     * Today's totals, from the same event pairing daily limits use.
     *
     * Asking [UsageQuery] for every installed package would mean enumerating
     * them first, so this re-reads the events once and buckets everything it
     * sees, which is one query rather than one per app.
     */
    private fun todayFromEvents(
        context: Context,
        dayStart: Long,
        nowMs: Long
    ): Map<String, Long> {
        val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
            ?: return emptyMap()

        val events = try {
            manager.queryEvents(dayStart - LOOKBEHIND_MS, nowMs)
        } catch (e: Exception) {
            Log.w(TAG, "queryEvents failed", e)
            return emptyMap()
        }

        val totals = HashMap<String, Long>()
        val openedAt = HashMap<String, Long>()
        val event = android.app.usage.UsageEvents.Event()

        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            val pkg = event.packageName ?: continue

            when {
                isForeground(event) -> if (!openedAt.containsKey(pkg)) {
                    openedAt[pkg] = event.timeStamp
                }

                isBackground(event) -> {
                    val opened = openedAt.remove(pkg) ?: continue
                    val from = maxOf(opened, dayStart)
                    val to = minOf(event.timeStamp, nowMs)
                    if (to > from) totals[pkg] = (totals[pkg] ?: 0L) + (to - from)
                }
            }
        }

        // Whatever is still open is on screen now and accrues up to this moment.
        for ((pkg, opened) in openedAt) {
            val from = maxOf(opened, dayStart)
            if (nowMs > from) totals[pkg] = (totals[pkg] ?: 0L) + (nowMs - from)
        }

        return totals.mapValues { it.value / 1000L }
    }

    /** A past day, from Android's own daily aggregation. */
    private fun rollupTotals(
        manager: UsageStatsManager,
        dayStart: Long,
        dayEnd: Long
    ): Map<String, Long> {
        val stats = try {
            manager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, dayStart, dayEnd)
        } catch (e: Exception) {
            Log.w(TAG, "queryUsageStats failed", e)
            return emptyMap()
        } ?: return emptyMap()

        val totals = HashMap<String, Long>()
        for (entry in stats) {
            // The daily bucket can extend past the window we asked for, so
            // discard anything that clearly belongs to another day.
            if (entry.lastTimeStamp < dayStart) continue
            val seconds = entry.totalTimeInForeground / 1000L
            if (seconds <= 0L) continue
            totals[entry.packageName] = (totals[entry.packageName] ?: 0L) + seconds
        }
        return totals
    }

    /**
     * The full report the UI draws: per-app rows with a label and a category,
     * plus each day's total.
     */
    fun reportJson(context: Context, days: Int, nowMs: Long = System.currentTimeMillis()): String {
        val totals = dailyTotals(context, days, nowMs)
        val root = JSONObject()

        if (totals == null) {
            // Explicitly "unknown", so the UI can say so rather than drawing an
            // empty chart that reads as a quiet day.
            root.put("available", false)
            root.put("days", JSONArray())
            root.put("apps", JSONArray())
            root.put("hourly", JSONArray())
            return root.toString()
        }

        root.put("available", true)

        val dayTotals = JSONArray()
        for (day in totals) dayTotals.put(day.values.sum())
        root.put("days", dayTotals)

        // When today went, hour by hour. Only today: earlier days come from
        // Android's daily rollups, which carry no timestamps to bucket by.
        val hourly = JSONArray()
        for (hour in hourlyCategoryTotals(context, startOfDay(nowMs, 0), nowMs)) {
            val segments = JSONArray()
            for ((category, seconds) in hour) {
                if (seconds <= 0L) continue
                segments.put(JSONObject().apply {
                    put("category", category)
                    put("seconds", seconds)
                })
            }
            hourly.put(segments)
        }
        root.put("hourly", hourly)

        // Today is the last entry; the per-app list describes today.
        val today = totals.lastOrNull() ?: emptyMap()
        val manager = context.packageManager
        val apps = JSONArray()

        for ((pkg, seconds) in today) {
            if (seconds < MIN_REPORTABLE_SECONDS) continue
            if (pkg == context.packageName) continue

            val info = try {
                manager.getApplicationInfo(pkg, 0)
            } catch (e: Exception) {
                null
            }

            // Skip apps with no launcher entry: system services and background
            // components are not "screen time" in any sense the user means.
            if (info == null || manager.getLaunchIntentForPackage(pkg) == null) continue

            apps.put(
                JSONObject().apply {
                    put("packageName", pkg)
                    put("appName", manager.getApplicationLabel(info).toString())
                    put("seconds", seconds)
                    put("category", categoryOf(info))
                }
            )
        }

        root.put("apps", apps)
        return root.toString()
    }


    /**
     * Today, split into hourly buckets and attributed to categories.
     *
     * The daily figures answer "how much?"; this answers "when?", which is the
     * question that actually changes behaviour — an hour of social media at
     * 11pm is a different problem from an hour spread across lunch.
     *
     * Each foreground interval is split across the hour boundaries it crosses,
     * so a session from 10:45 to 11:15 contributes fifteen minutes to each hour
     * rather than thirty to whichever end we happened to pick.
     *
     * Hours later than now are genuinely zero rather than unknown: they have not
     * happened yet. That is a different fact from "could not measure", which is
     * carried by the report's `available` flag.
     */
    private fun hourlyCategoryTotals(
        context: Context,
        dayStart: Long,
        nowMs: Long
    ): Array<HashMap<String, Long>> {
        val hours = Array(24) { HashMap<String, Long>() }

        val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
            ?: return hours

        val events = try {
            manager.queryEvents(dayStart - LOOKBEHIND_MS, nowMs)
        } catch (e: Exception) {
            Log.w(TAG, "hourly queryEvents failed", e)
            return hours
        }

        // One PackageManager lookup per package, not one per interval.
        val categories = HashMap<String, String?>()
        val packageManager = context.packageManager

        fun categoryFor(pkg: String): String? = categories.getOrPut(pkg) {
            try {
                val info = packageManager.getApplicationInfo(pkg, 0)
                // Same filter as the app list: a package with no launcher entry
                // is a system service, not screen time.
                if (packageManager.getLaunchIntentForPackage(pkg) == null) null
                else categoryOf(info)
            } catch (e: Exception) {
                null
            }
        }

        fun add(pkg: String, fromMs: Long, toMs: Long) {
            if (pkg == context.packageName) return
            val category = categoryFor(pkg) ?: return

            var cursor = maxOf(fromMs, dayStart)
            val end = minOf(toMs, nowMs)

            while (cursor < end) {
                val hour = hourOf(cursor, dayStart)
                if (hour < 0 || hour > 23) break

                val hourEnd = dayStart + (hour + 1) * HOUR_MS
                val slice = minOf(end, hourEnd) - cursor
                if (slice > 0) {
                    hours[hour][category] = (hours[hour][category] ?: 0L) + slice
                }
                cursor = hourEnd
            }
        }

        val openedAt = HashMap<String, Long>()
        val event = android.app.usage.UsageEvents.Event()

        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            val pkg = event.packageName ?: continue

            when {
                isForeground(event) -> if (!openedAt.containsKey(pkg)) {
                    openedAt[pkg] = event.timeStamp
                }

                isBackground(event) -> {
                    val opened = openedAt.remove(pkg) ?: continue
                    add(pkg, opened, event.timeStamp)
                }
            }
        }

        // Still open means still on screen, accruing up to this moment.
        for ((pkg, opened) in openedAt) add(pkg, opened, nowMs)

        // Milliseconds while accumulating, seconds on the way out.
        for (hour in hours) {
            for (key in hour.keys.toList()) hour[key] = (hour[key] ?: 0L) / 1000L
        }
        return hours
    }

    /** Which hour of the day a timestamp falls in, relative to local midnight. */
    private fun hourOf(timestampMs: Long, dayStart: Long): Int =
        ((timestampMs - dayStart) / HOUR_MS).toInt()

    /**
     * Android's own category, as a stable string.
     *
     * `ApplicationInfo.category` arrived in Android 8, which is this app's
     * minimum, so there is no older path to support. Undeclared stays
     * undeclared: see the note at the top of this file.
     */
    private fun categoryOf(info: ApplicationInfo): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return "other"

        return when (info.category) {
            ApplicationInfo.CATEGORY_SOCIAL -> "social"
            ApplicationInfo.CATEGORY_VIDEO, ApplicationInfo.CATEGORY_AUDIO -> "entertainment"
            ApplicationInfo.CATEGORY_GAME -> "games"
            ApplicationInfo.CATEGORY_PRODUCTIVITY -> "productivity"
            ApplicationInfo.CATEGORY_NEWS -> "news"
            ApplicationInfo.CATEGORY_MAPS -> "travel"
            ApplicationInfo.CATEGORY_IMAGE -> "creativity"
            else -> "other"
        }
    }

    private fun startOfDay(nowMs: Long, dayOffset: Int): Long {
        val calendar = Calendar.getInstance().apply {
            timeInMillis = nowMs
            add(Calendar.DAY_OF_YEAR, dayOffset)
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        return calendar.timeInMillis
    }

    private fun isForeground(event: android.app.usage.UsageEvents.Event): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            event.eventType == android.app.usage.UsageEvents.Event.ACTIVITY_RESUMED
        } else {
            @Suppress("DEPRECATION")
            event.eventType == android.app.usage.UsageEvents.Event.MOVE_TO_FOREGROUND
        }

    private fun isBackground(event: android.app.usage.UsageEvents.Event): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            event.eventType == android.app.usage.UsageEvents.Event.ACTIVITY_PAUSED ||
                event.eventType == android.app.usage.UsageEvents.Event.ACTIVITY_STOPPED
        } else {
            @Suppress("DEPRECATION")
            event.eventType == android.app.usage.UsageEvents.Event.MOVE_TO_BACKGROUND
        }
}
