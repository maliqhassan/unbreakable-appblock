package expo.modules.unbreakablelock

import android.content.Context

/**
 * What is actually being enforced right now, merged from every active source.
 *
 * There are two independent sources — a manual lock ([LockStateStore]) and the
 * running schedules ([ScheduleLockStore]) — and the rules for merging them are
 * chosen so an overlap can never *weaken* protection:
 *
 *   - packages are the **union**, so nothing slips through a gap between them;
 *   - strict mode is on if **either** source wants it;
 *   - the end is the **latest** of the two, so one source finishing cannot
 *     unlock apps the other is still covering.
 *
 * This is the single record [LockForegroundService] enforces. There is exactly
 * one enforcement session on the device regardless of how many sources feed it.
 */
object EffectiveLock {

    data class State(
        val active: Boolean,
        val packages: Set<String>,
        val strictMode: Boolean,
        val endWallMs: Long,
        /** "manual", "schedule", or both. */
        val sources: List<String>,
        val scheduleNames: Set<String>,
        /** Packages locked because their daily allowance is spent. */
        val dailyLimitPackages: Set<String>,
        /**
         * Packages locked by a manual lock or a schedule.
         *
         * Kept separate so the block screen can tell whether ignoring a daily
         * limit would actually let the user back in. Offering "ignore limit"
         * for an app a manual lock also covers would be a button that does
         * nothing.
         */
        val nonDailyPackages: Set<String>,
        /** Epoch ms of the next local midnight, when allowances reset. */
        val resetsAt: Long,
        val degradedReason: String?
    )

    fun read(context: Context, now: Long = System.currentTimeMillis()): State {
        val manual = LockStateStore.read(context)
        val manualActive = manual.active && !LockStateStore.isExpired(context, now)

        val schedule = ScheduleLockStore.read(context)
        val scheduleActive = ScheduleLockStore.isActive(context, now)

        val daily = DailyLimitStore.readLockState(context)
        val dailyActive = DailyLimitStore.isActive(context, now)

        if (!manualActive && !scheduleActive && !dailyActive) {
            return State(
                active = false,
                packages = emptySet(),
                strictMode = false,
                endWallMs = 0L,
                sources = emptyList(),
                scheduleNames = emptySet(),
                dailyLimitPackages = emptySet(),
                nonDailyPackages = emptySet(),
                resetsAt = daily.resetsAt,
                // A degraded reason is still worth surfacing even when nothing
                // is running; it explains why the last session stopped working,
                // or why a daily limit is not being enforced.
                degradedReason = manual.degradedReason ?: daily.degradedReason
            )
        }

        val packages = HashSet<String>()
        val nonDaily = HashSet<String>()
        val sources = ArrayList<String>(2)
        var strict = false
        var end = 0L

        if (manualActive) {
            packages.addAll(manual.packages)
            nonDaily.addAll(manual.packages)
            strict = strict || manual.strictMode
            end = maxOf(end, manual.endWallMs)
            sources.add("manual")
        }

        if (scheduleActive) {
            packages.addAll(schedule.packages)
            nonDaily.addAll(schedule.packages)
            strict = strict || schedule.strictMode
            end = maxOf(end, schedule.endWallMs)
            sources.add("schedule")
        }

        if (dailyActive) {
            packages.addAll(daily.packages)
            strict = strict || daily.strictMode
            // A spent allowance lasts until the local midnight reset, so that
            // is its end. Taking the max across sources means a manual lock
            // ending cannot release an app the daily limit still covers.
            end = maxOf(end, daily.resetsAt)
            sources.add("daily_usage")
        }

        return State(
            active = true,
            packages = packages,
            strictMode = strict,
            endWallMs = end,
            sources = sources,
            scheduleNames = if (scheduleActive) schedule.scheduleNames else emptySet(),
            dailyLimitPackages = if (dailyActive) daily.packages else emptySet(),
            nonDailyPackages = nonDaily,
            resetsAt = daily.resetsAt,
            degradedReason = manual.degradedReason ?: daily.degradedReason
        )
    }

    fun isActive(context: Context, now: Long = System.currentTimeMillis()): Boolean =
        read(context, now).active

    /**
     * Milliseconds until the last active source ends.
     *
     * Used to schedule the exact stop. Zero when nothing is running.
     */
    fun remainingMs(context: Context, now: Long = System.currentTimeMillis()): Long {
        val manualRemaining =
            if (LockStateStore.read(context).active) LockStateStore.remainingMs(context, now)
            else 0L

        val scheduleRemaining =
            if (ScheduleLockStore.isActive(context, now)) {
                (ScheduleLockStore.read(context).endWallMs - now).coerceAtLeast(0L)
            } else 0L

        val dailyRemaining =
            if (DailyLimitStore.isActive(context, now)) {
                (DailyLimitStore.readLockState(context).resetsAt - now).coerceAtLeast(0L)
            } else 0L

        return maxOf(manualRemaining, maxOf(scheduleRemaining, dailyRemaining))
    }
}
