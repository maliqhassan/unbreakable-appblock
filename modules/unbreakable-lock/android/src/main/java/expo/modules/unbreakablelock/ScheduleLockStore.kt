package expo.modules.unbreakablelock

import android.content.Context

/**
 * The schedule half of the enforcement state.
 *
 * Kept separate from [LockStateStore] on purpose. A manual lock the user
 * started by hand and a schedule that happens to be running are independent
 * sources: one ending must never lift the other. Merging them into a single
 * record would make that impossible to express.
 *
 * Written only by [ScheduleCoordinator], which recomputes it from the schedule
 * list whenever anything could have changed.
 */
object ScheduleLockStore {
    private const val PREFS = "unbreakable_schedule_lock"

    private const val KEY_ACTIVE = "active"
    private const val KEY_END_WALL = "end_wall"
    private const val KEY_STRICT = "strict"
    private const val KEY_PACKAGES = "packages"
    private const val KEY_SCHEDULE_IDS = "schedule_ids"
    private const val KEY_SCHEDULE_NAMES = "schedule_names"

    data class State(
        val active: Boolean,
        val endWallMs: Long,
        val strictMode: Boolean,
        val packages: Set<String>,
        val scheduleIds: Set<String>,
        /** Shown on the active-lock screen, e.g. "Sleep". */
        val scheduleNames: Set<String>
    )

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /**
     * Records the merged contribution of every currently-running schedule.
     *
     * Uses commit() rather than apply(): the caller is usually an alarm or boot
     * receiver whose process may be killed the moment it returns, and a lost
     * write here would silently drop enforcement.
     */
    @Suppress("ApplySharedPref")
    fun save(
        context: Context,
        endWallMs: Long,
        strictMode: Boolean,
        packages: Set<String>,
        scheduleIds: Set<String>,
        scheduleNames: Set<String>
    ) {
        prefs(context).edit()
            .putBoolean(KEY_ACTIVE, true)
            .putLong(KEY_END_WALL, endWallMs)
            .putBoolean(KEY_STRICT, strictMode)
            .putStringSet(KEY_PACKAGES, packages)
            .putStringSet(KEY_SCHEDULE_IDS, scheduleIds)
            .putStringSet(KEY_SCHEDULE_NAMES, scheduleNames)
            .commit()
    }

    @Suppress("ApplySharedPref")
    fun clear(context: Context) {
        prefs(context).edit().clear().commit()
    }

    fun read(context: Context): State {
        val p = prefs(context)
        return State(
            active = p.getBoolean(KEY_ACTIVE, false),
            endWallMs = p.getLong(KEY_END_WALL, 0L),
            strictMode = p.getBoolean(KEY_STRICT, false),
            packages = p.getStringSet(KEY_PACKAGES, emptySet()) ?: emptySet(),
            scheduleIds = p.getStringSet(KEY_SCHEDULE_IDS, emptySet()) ?: emptySet(),
            scheduleNames = p.getStringSet(KEY_SCHEDULE_NAMES, emptySet()) ?: emptySet()
        )
    }

    /**
     * True when the schedule contribution is live.
     *
     * Only wall clock here, deliberately: a schedule is defined in local
     * wall-clock terms, so if the user moves the clock the schedule genuinely
     * should re-evaluate against the new time. That is the opposite of the
     * manual lock, where a clock change must not shorten a session the user
     * asked for.
     */
    fun isActive(context: Context, now: Long = System.currentTimeMillis()): Boolean {
        val state = read(context)
        return state.active && now < state.endWallMs
    }
}
