package expo.modules.unbreakablelock

import android.content.Context
import android.util.Log
import org.json.JSONArray

/**
 * Where schedules live.
 *
 * Local device configuration in SharedPreferences — deliberately not a backend
 * and not Firebase. Schedules must be readable by an alarm receiver at 3am with
 * no network, no signed-in user, and no JS runtime, so anything remote would be
 * the wrong shape entirely.
 */
object ScheduleStore {
    private const val TAG = "UnbreakableSchedules"
    private const val PREFS = "unbreakable_schedules"
    private const val KEY_SCHEDULES = "schedules"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun readAll(context: Context): List<LockSchedule> {
        val raw = prefs(context).getString(KEY_SCHEDULES, null) ?: return emptyList()

        return try {
            val array = JSONArray(raw)
            val out = ArrayList<LockSchedule>(array.length())
            for (i in 0 until array.length()) {
                val json = array.optJSONObject(i) ?: continue
                // A single unreadable entry is skipped rather than discarding
                // every other schedule the user has set up.
                LockSchedule.fromJson(json)?.let { out.add(it) }
            }
            out
        } catch (e: Exception) {
            Log.w(TAG, "Schedule list could not be parsed; treating as empty", e)
            emptyList()
        }
    }

    /**
     * Replaces the whole list.
     *
     * commit() rather than apply(): JS calls this and then immediately expects
     * the coordinator to re-evaluate from disk, so the write has to have landed.
     */
    @Suppress("ApplySharedPref")
    fun replaceAll(context: Context, schedules: List<LockSchedule>) {
        val array = JSONArray()
        for (schedule in schedules) array.put(schedule.toJson())
        prefs(context).edit().putString(KEY_SCHEDULES, array.toString()).commit()
    }

    fun find(context: Context, id: String): LockSchedule? =
        readAll(context).firstOrNull { it.id == id }
}
