package expo.modules.unbreakablelock

import org.json.JSONArray
import org.json.JSONObject

/**
 * A recurring lock, as stored on the device.
 *
 * Times are local wall-clock minutes-from-midnight, not instants. "Weekdays at
 * 22:00" must mean 22:00 wherever the user is; storing a UTC timestamp would
 * quietly shift the schedule when they cross a timezone, which is never what
 * anyone means by a daily routine.
 *
 * Kept in sync with `src/types/index.ts` -> LockSchedule and with the pure
 * functions in `src/utils/schedule.ts`.
 */
data class LockSchedule(
    val id: String,
    val name: String,
    val enabled: Boolean,
    val packages: Set<String>,
    /** java.util.Calendar day constants: SUNDAY = 1 .. SATURDAY = 7. */
    val days: Set<Int>,
    /** Local minutes from midnight. */
    val startMinutes: Int,
    val endMinutes: Int,
    val strictMode: Boolean
) {

    /** True when the window crosses midnight, e.g. 22:00 -> 06:00. */
    val isOvernight: Boolean get() = endMinutes <= startMinutes

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("name", name)
        put("enabled", enabled)
        put("packages", JSONArray(packages.toList()))
        put("days", JSONArray(days.toList()))
        put("startMinutes", startMinutes)
        put("endMinutes", endMinutes)
        put("strictMode", strictMode)
    }

    companion object {
        /**
         * @return the schedule, or null when the record is unusable.
         *
         * Returning null rather than throwing matters: one corrupt entry must
         * not take out the whole schedule list, and with it every other lock
         * the user set up.
         */
        fun fromJson(json: JSONObject): LockSchedule? {
            return try {
                val id = json.optString("id", "")
                if (id.isEmpty()) return null

                val start = json.optInt("startMinutes", -1)
                val end = json.optInt("endMinutes", -1)
                if (start !in 0..1439 || end !in 0..1439) return null
                // Equal times are genuinely ambiguous -- zero length or a full
                // day? JS validation rejects them, and so do we.
                if (start == end) return null

                LockSchedule(
                    id = id,
                    name = json.optString("name", "Schedule"),
                    enabled = json.optBoolean("enabled", true),
                    packages = json.optJSONArray("packages").toStringSet(),
                    days = json.optJSONArray("days").toIntSet(),
                    startMinutes = start,
                    endMinutes = end,
                    strictMode = json.optBoolean("strictMode", false)
                )
            } catch (e: Exception) {
                null
            }
        }

        private fun JSONArray?.toStringSet(): Set<String> {
            if (this == null) return emptySet()
            val out = HashSet<String>(length())
            for (i in 0 until length()) {
                val value = optString(i, "")
                if (value.isNotEmpty()) out.add(value)
            }
            return out
        }

        private fun JSONArray?.toIntSet(): Set<Int> {
            if (this == null) return emptySet()
            val out = HashSet<Int>(length())
            for (i in 0 until length()) out.add(optInt(i, -1))
            out.remove(-1)
            return out
        }
    }
}
