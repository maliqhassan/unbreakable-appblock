package expo.modules.unbreakablelock

import android.content.Context
import android.os.SystemClock

/**
 * The native source of truth for an active lock.
 *
 * Deliberately native-side and file-backed: if the React Native runtime is
 * killed (swiped away, low memory, crash), the lock must still be knowable.
 * JS reads this back on next launch rather than trusting its own memory.
 *
 * Nothing here depends on the JS process ever having existed.
 */
object LockStateStore {
    private const val PREFS = "unbreakable_lock_state"

    private const val KEY_ACTIVE = "active"
    private const val KEY_SESSION_ID = "session_id"
    private const val KEY_START_WALL = "start_wall"
    private const val KEY_END_WALL = "end_wall"
    private const val KEY_END_ELAPSED = "end_elapsed"
    private const val KEY_ELAPSED_VALID = "elapsed_valid"
    private const val KEY_STRICT = "strict"
    private const val KEY_PACKAGES = "packages"
    private const val KEY_DEGRADED_REASON = "degraded_reason"

    data class State(
        val active: Boolean,
        val sessionId: String,
        val startWallMs: Long,
        val endWallMs: Long,
        val strictMode: Boolean,
        val packages: Set<String>,
        /**
         * Non-null when enforcement is running but cannot actually block —
         * usually because the user revoked a permission mid-session. The UI
         * must surface this rather than keep claiming full protection.
         */
        val degradedReason: String?
    )

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun save(
        context: Context,
        sessionId: String,
        startWallMs: Long,
        endWallMs: Long,
        strictMode: Boolean,
        packages: Set<String>
    ) {
        val remaining = endWallMs - System.currentTimeMillis()
        prefs(context).edit()
            .putBoolean(KEY_ACTIVE, true)
            .putString(KEY_SESSION_ID, sessionId)
            .putLong(KEY_START_WALL, startWallMs)
            .putLong(KEY_END_WALL, endWallMs)
            // A second, monotonic deadline. Moving the system clock forward is a
            // legitimate user action, but it should not shorten a lock the user
            // asked for, so we require BOTH deadlines to pass.
            .putLong(KEY_END_ELAPSED, SystemClock.elapsedRealtime() + remaining)
            .putBoolean(KEY_ELAPSED_VALID, true)
            .putBoolean(KEY_STRICT, strictMode)
            .putStringSet(KEY_PACKAGES, packages)
            .remove(KEY_DEGRADED_REASON)
            .apply()
    }

    /**
     * Adds packages to a running session, leaving its deadline untouched.
     *
     * Deliberately allowed during Strict Mode: adding targets only ever makes
     * the lock *stronger*. Strict Mode exists to stop someone weakening a
     * commitment they made — shortening it, removing apps, ending it early —
     * not to stop them committing harder.
     *
     * @return the merged package set.
     */
    @Suppress("ApplySharedPref")
    fun addPackages(context: Context, extra: Set<String>): Set<String> {
        val p = prefs(context)
        // A fresh set: SharedPreferences hands back an instance it still owns,
        // and mutating it in place has undefined behaviour.
        val merged = HashSet(p.getStringSet(KEY_PACKAGES, emptySet()) ?: emptySet())
        merged.addAll(extra)
        p.edit().putStringSet(KEY_PACKAGES, merged).commit()
        return merged
    }

    fun clear(context: Context) {
        prefs(context).edit().clear().apply()
    }

    /**
     * A reboot resets elapsedRealtime, so the monotonic deadline becomes
     * meaningless. BootReceiver calls this to fall back to wall clock only.
     */
    fun invalidateElapsedDeadline(context: Context) {
        prefs(context).edit().putBoolean(KEY_ELAPSED_VALID, false).apply()
    }

    /**
     * Records that enforcement is no longer fully working.
     *
     * Written with commit() rather than apply(): the caller is usually about to
     * report status back to the user or shut the service down, and a lost write
     * here would mean claiming protection we do not have.
     */
    @Suppress("ApplySharedPref")
    fun setDegradedReason(context: Context, reason: String?) {
        val editor = prefs(context).edit()
        if (reason == null) editor.remove(KEY_DEGRADED_REASON)
        else editor.putString(KEY_DEGRADED_REASON, reason)
        editor.commit()
    }

    fun read(context: Context): State {
        val p = prefs(context)
        return State(
            active = p.getBoolean(KEY_ACTIVE, false),
            sessionId = p.getString(KEY_SESSION_ID, "") ?: "",
            startWallMs = p.getLong(KEY_START_WALL, 0L),
            endWallMs = p.getLong(KEY_END_WALL, 0L),
            strictMode = p.getBoolean(KEY_STRICT, false),
            packages = p.getStringSet(KEY_PACKAGES, emptySet()) ?: emptySet(),
            degradedReason = p.getString(KEY_DEGRADED_REASON, null)
        )
    }

    /** True once every applicable deadline has passed. */
    fun isExpired(context: Context, now: Long = System.currentTimeMillis()): Boolean {
        val p = prefs(context)
        if (!p.getBoolean(KEY_ACTIVE, false)) return true

        val wallExpired = now >= p.getLong(KEY_END_WALL, 0L)
        if (!p.getBoolean(KEY_ELAPSED_VALID, false)) return wallExpired

        val elapsedExpired = SystemClock.elapsedRealtime() >= p.getLong(KEY_END_ELAPSED, 0L)
        return wallExpired && elapsedExpired
    }

    /**
     * Milliseconds until the lock may end, from whichever deadline is later.
     * Used to schedule an exact stop instead of waiting for a poll to notice.
     */
    fun remainingMs(context: Context, now: Long = System.currentTimeMillis()): Long {
        val p = prefs(context)
        if (!p.getBoolean(KEY_ACTIVE, false)) return 0L

        val wallRemaining = p.getLong(KEY_END_WALL, 0L) - now
        if (!p.getBoolean(KEY_ELAPSED_VALID, false)) return wallRemaining.coerceAtLeast(0L)

        val elapsedRemaining = p.getLong(KEY_END_ELAPSED, 0L) - SystemClock.elapsedRealtime()
        return maxOf(wallRemaining, elapsedRemaining).coerceAtLeast(0L)
    }
}
