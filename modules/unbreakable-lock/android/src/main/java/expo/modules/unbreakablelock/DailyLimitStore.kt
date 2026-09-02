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

    /** package -> epoch ms until which a spent allowance is being ignored. */
    private const val KEY_OVERRIDES = "overrides"

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
            // Copied, not handed straight out. SharedPreferences documents the
            // returned set as one you must not modify or hand back to
            // putStringSet — and the engine does exactly that when it carries a
            // previous day's state forward.
            packages = HashSet(p.getStringSet(KEY_LOCK_PACKAGES, emptySet()) ?: emptySet()),
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

    // MARK: - Overrides
    //
    // A deliberate, user-granted extension past a spent allowance: "one more
    // minute", a snooze, or the rest of today. Stored as an expiry timestamp
    // per package, so an override needs no clean-up — it simply stops applying,
    // and one set to the next midnight expires with the day it belonged to.
    //
    // Only ever created from the block screen, and only when Strict Mode is off
    // for that limit. Strict Mode's whole promise is that there is no such door.

    /**
     * @return the epoch ms this package may be used until, or 0 when there is
     *   no override in force.
     */
    fun overrideUntil(
        context: Context,
        packageName: String,
        now: Long = System.currentTimeMillis()
    ): Long {
        val until = readOverrides(context)[packageName] ?: return 0L
        return if (until > now) until else 0L
    }

    fun setOverride(context: Context, packageName: String, untilMs: Long) {
        val next = HashMap(readOverrides(context))
        next[packageName] = untilMs
        writeOverrides(context, next)
    }

    /** Every override still in force, keyed by package. */
    fun activeOverrides(
        context: Context,
        now: Long = System.currentTimeMillis()
    ): Map<String, Long> = readOverrides(context).filterValues { it > now }

    fun clearOverride(context: Context, packageName: String) {
        val next = HashMap(readOverrides(context))
        if (next.remove(packageName) != null) writeOverrides(context, next)
    }

    private fun readOverrides(context: Context): Map<String, Long> {
        val raw = prefs(context).getString(KEY_OVERRIDES, null) ?: return emptyMap()
        return try {
            val json = org.json.JSONObject(raw)
            val out = HashMap<String, Long>(json.length())
            for (key in json.keys()) out[key] = json.optLong(key, 0L)
            out
        } catch (e: Exception) {
            // A corrupt record must not permanently disable enforcement; the
            // safe reading of "unknown" here is "no override".
            emptyMap()
        }
    }

    /**
     * Expired entries are dropped on every write, so the record cannot grow
     * without bound as days pass.
     */
    @Suppress("ApplySharedPref")
    private fun writeOverrides(context: Context, overrides: Map<String, Long>) {
        val now = System.currentTimeMillis()
        val json = org.json.JSONObject()
        for ((pkg, until) in overrides) {
            if (until > now) json.put(pkg, until)
        }
        prefs(context).edit().putString(KEY_OVERRIDES, json.toString()).commit()
    }
}
