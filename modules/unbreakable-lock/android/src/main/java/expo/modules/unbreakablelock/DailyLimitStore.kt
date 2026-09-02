package expo.modules.unbreakablelock

import android.content.Context

/**
 * Where daily limits live, and the daily-usage contribution to enforcement.
 *
 * Local device configuration in SharedPreferences — never a backend, never
 * Firebase. The service must be able to read these with no network, no
 * signed-in user and no JS runtime.
 */
object DailyLimitStore {
    private const val PREFS = "unbreakable_daily_limits"
    private const val KEY_LIMITS = "limits"

    // The computed contribution, written only by DailyLimitEngine.
    private const val KEY_LOCK_ACTIVE = "lock_active"
    private const val KEY_LOCK_PACKAGES = "lock_packages"
    private const val KEY_LOCK_STRICT = "lock_strict"
    private const val KEY_LOCK_RESETS_AT = "lock_resets_at"
    private const val KEY_DEGRADED = "lock_degraded"
    private const val KEY_MEASURED_DAY = "measured_day"
    private const val KEY_MEASURED_AT = "measured_at"

    data class LockState(
        val active: Boolean,
        val packages: Set<String>,
        val strictMode: Boolean,
        /** Epoch ms of the next local midnight. */
        val resetsAt: Long,
        /** Non-null when usage could not be measured on the latest attempt. */
        val degradedReason: String?,
        /**
         * Local day start (epoch ms) that [packages] was established for.
         *
         * This is what separates "previously exhausted, cannot re-measure right
         * now" from "never measured today". Only a set established for *today*
         * may be preserved through a failed measurement.
         */
        val measuredDayStart: Long,
        /** When the last SUCCESSFUL measurement happened. 0 means never. */
        val lastMeasuredAt: Long
    )

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun readLimits(context: Context): List<DailyLimit> {
        val raw = prefs(context).getString(KEY_LIMITS, null) ?: return emptyList()
        return DailyLimit.listFromJson(raw)
    }

    /** Replaces the whole list. commit(), because a re-evaluation follows. */
    @Suppress("ApplySharedPref")
    fun replaceLimits(context: Context, limits: List<DailyLimit>) {
        prefs(context).edit().putString(KEY_LIMITS, DailyLimit.listToJson(limits)).commit()
    }

    /** True when anything needs watching, which is what keeps the service alive. */
    fun hasEnabledLimits(context: Context): Boolean =
        readLimits(context).any { it.enabled }

    @Suppress("ApplySharedPref")
    fun saveLockState(
        context: Context,
        packages: Set<String>,
        strictMode: Boolean,
        resetsAt: Long,
        degradedReason: String?,
        measuredDayStart: Long,
        lastMeasuredAt: Long
    ) {
        prefs(context).edit()
            .putBoolean(KEY_LOCK_ACTIVE, packages.isNotEmpty())
            .putStringSet(KEY_LOCK_PACKAGES, packages)
            .putBoolean(KEY_LOCK_STRICT, strictMode)
            .putLong(KEY_LOCK_RESETS_AT, resetsAt)
            .putLong(KEY_MEASURED_DAY, measuredDayStart)
            .putLong(KEY_MEASURED_AT, lastMeasuredAt)
            .apply {
                if (degradedReason == null) remove(KEY_DEGRADED)
                else putString(KEY_DEGRADED, degradedReason)
            }
            .commit()
    }

    fun readLockState(context: Context): LockState {
        val p = prefs(context)
        return LockState(
            active = p.getBoolean(KEY_LOCK_ACTIVE, false),
            packages = p.getStringSet(KEY_LOCK_PACKAGES, emptySet()) ?: emptySet(),
            strictMode = p.getBoolean(KEY_LOCK_STRICT, false),
            resetsAt = p.getLong(KEY_LOCK_RESETS_AT, 0L),
            degradedReason = p.getString(KEY_DEGRADED, null),
            measuredDayStart = p.getLong(KEY_MEASURED_DAY, 0L),
            lastMeasuredAt = p.getLong(KEY_MEASURED_AT, 0L)
        )
    }

    /**
     * True when a daily allowance is currently spent.
     *
     * The stored contribution expires at midnight on its own: past the reset
     * time it is stale by definition, and the engine will recompute.
     */
    fun isActive(context: Context, now: Long = System.currentTimeMillis()): Boolean {
        val state = readLockState(context)
        return state.active && state.packages.isNotEmpty() && now < state.resetsAt
    }
}
