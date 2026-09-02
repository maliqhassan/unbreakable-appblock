package expo.modules.unbreakablelock

import org.json.JSONArray
import org.json.JSONObject

/**
 * A daily foreground-time budget for one app.
 *
 * Kept in sync with `src/types/index.ts` -> DailyUsageLimit and with the pure
 * functions in `src/utils/dailyUsage.ts`.
 */
data class DailyLimit(
    val id: String,
    val packageName: String,
    val limitSeconds: Long,
    val enabled: Boolean,
    val strictMode: Boolean
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("packageName", packageName)
        put("limitSeconds", limitSeconds)
        put("enabled", enabled)
        put("strictMode", strictMode)
    }

    companion object {
        /**
         * @return the limit, or null when the record is unusable.
         *
         * Null rather than an exception: one corrupt entry must not take out
         * every other limit the user configured.
         */
        fun fromJson(json: JSONObject): DailyLimit? {
            return try {
                val id = json.optString("id", "")
                val packageName = json.optString("packageName", "")
                val seconds = json.optLong("limitSeconds", -1L)
                if (id.isEmpty() || packageName.isEmpty() || seconds <= 0L) return null

                DailyLimit(
                    id = id,
                    packageName = packageName,
                    limitSeconds = seconds,
                    enabled = json.optBoolean("enabled", true),
                    strictMode = json.optBoolean("strictMode", false)
                )
            } catch (e: Exception) {
                null
            }
        }

        fun listFromJson(raw: String): List<DailyLimit> = try {
            val array = JSONArray(raw)
            val out = ArrayList<DailyLimit>(array.length())
            for (i in 0 until array.length()) {
                val json = array.optJSONObject(i) ?: continue
                fromJson(json)?.let { out.add(it) }
            }
            out
        } catch (e: Exception) {
            emptyList()
        }

        fun listToJson(limits: List<DailyLimit>): String {
            val array = JSONArray()
            for (limit in limits) array.put(limit.toJson())
            return array.toString()
        }
    }
}
