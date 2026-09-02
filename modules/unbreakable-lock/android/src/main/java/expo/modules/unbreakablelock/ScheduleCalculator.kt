package expo.modules.unbreakablelock

import java.util.Calendar

/**
 * The recurrence maths.
 *
 * A direct mirror of `src/utils/schedule.ts`. The TypeScript version is the
 * documented spec and carries the test suite; this one exists because alarms,
 * boot and time-change broadcasts all arrive with no JS runtime alive, so the
 * decision has to be makeable in Kotlin alone.
 *
 * Every function takes the reference time explicitly and touches no state, so
 * a clock or timezone change is simply a different input rather than something
 * that corrupts an accumulated counter.
 */
object ScheduleCalculator {

    private const val MINUTES_PER_DAY = 24 * 60

    private fun calendarAt(nowMs: Long): Calendar =
        Calendar.getInstance().apply { timeInMillis = nowMs }

    private fun minutesOfDay(calendar: Calendar): Int =
        calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE)

    /** Calendar.SUNDAY..SATURDAY for the day before the given one. */
    private fun previousDay(day: Int): Int = if (day == Calendar.SUNDAY) Calendar.SATURDAY else day - 1

    /**
     * Is this schedule running at [nowMs]?
     *
     * The overnight case is the one that matters: at 02:00 on Tuesday, the
     * occurrence that is running started on *Monday* at 22:00. So both the
     * window that could have opened today and the one that could have opened
     * yesterday are considered.
     */
    fun isActive(schedule: LockSchedule, nowMs: Long): Boolean {
        if (!schedule.enabled) return false
        if (schedule.days.isEmpty()) return false
        if (schedule.startMinutes == schedule.endMinutes) return false

        val calendar = calendarAt(nowMs)
        val now = minutesOfDay(calendar)
        val today = calendar.get(Calendar.DAY_OF_WEEK)

        if (!schedule.isOvernight) {
            // End is exclusive: a 09:00-17:00 lock is over at exactly 17:00.
            return schedule.days.contains(today) &&
                now >= schedule.startMinutes &&
                now < schedule.endMinutes
        }

        if (schedule.days.contains(today) && now >= schedule.startMinutes) return true
        if (schedule.days.contains(previousDay(today)) && now < schedule.endMinutes) return true

        return false
    }

    /**
     * When the currently-running occurrence ends.
     *
     * @return epoch ms, or 0 when the schedule is not running at [nowMs].
     */
    fun currentEnd(schedule: LockSchedule, nowMs: Long): Long {
        if (!isActive(schedule, nowMs)) return 0L

        val calendar = calendarAt(nowMs)
        val now = minutesOfDay(calendar)

        // Same-day: later today. Overnight started today: tomorrow morning.
        // Overnight started yesterday: later this morning.
        val dayOffset = if (!schedule.isOvernight) 0 else if (now >= schedule.startMinutes) 1 else 0

        return atLocalTime(nowMs, schedule.endMinutes, dayOffset)
    }

    /**
     * The next moment this schedule starts, strictly after [nowMs].
     *
     * Searches eight days so a weekly schedule always resolves, including when
     * today's occurrence has already begun.
     */
    fun nextStart(schedule: LockSchedule, nowMs: Long): Long {
        if (!schedule.enabled || schedule.days.isEmpty()) return 0L

        for (offset in 0 until 8) {
            val candidate = atLocalTime(nowMs, schedule.startMinutes, offset)
            if (candidate <= nowMs) continue

            val day = calendarAt(candidate).get(Calendar.DAY_OF_WEEK)
            if (!schedule.days.contains(day)) continue

            return candidate
        }

        return 0L
    }

    /**
     * The next moment the effective state changes — a schedule starting, or a
     * running one ending. This is what the alarm is set for, and it is why the
     * engine can sleep instead of polling.
     *
     * @return epoch ms, or 0 when nothing is scheduled.
     */
    fun nextTransition(schedules: List<LockSchedule>, nowMs: Long): Long {
        var earliest = 0L

        fun consider(candidate: Long) {
            if (candidate <= nowMs) return
            if (earliest == 0L || candidate < earliest) earliest = candidate
        }

        for (schedule in schedules) {
            if (!schedule.enabled) continue
            consider(currentEnd(schedule, nowMs))
            consider(nextStart(schedule, nowMs))
        }

        return earliest
    }

    fun activeSchedules(schedules: List<LockSchedule>, nowMs: Long): List<LockSchedule> =
        schedules.filter { isActive(it, nowMs) }

    /**
     * Local wall-clock time on a given day, as epoch ms.
     *
     * Built from a Calendar rather than by adding milliseconds so daylight
     * saving transitions land on the intended wall-clock time instead of
     * drifting by an hour.
     */
    private fun atLocalTime(nowMs: Long, minutes: Int, dayOffset: Int): Long {
        val calendar = calendarAt(nowMs)
        calendar.add(Calendar.DAY_OF_YEAR, dayOffset)
        calendar.set(Calendar.HOUR_OF_DAY, minutes / 60)
        calendar.set(Calendar.MINUTE, minutes % MINUTES_PER_DAY % 60)
        calendar.set(Calendar.SECOND, 0)
        calendar.set(Calendar.MILLISECOND, 0)
        return calendar.timeInMillis
    }
}
