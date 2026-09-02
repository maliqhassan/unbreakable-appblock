package expo.modules.unbreakablelock

import kotlin.math.abs

/**
 * The lines shown on the block screen.
 *
 * Kept in sync with `src/constants/quotes.ts` so the block screen and the app
 * speak with one voice.
 *
 * These are about the user's own intent, not about the lock. Someone who has
 * just been interrupted does not need an explanation of what the app is doing;
 * they need a reason to go back to whatever they meant to be doing.
 */
object FocusQuotes {

    private val QUOTES = listOf(
        "Be productive. Focus on your goal.",
        "The work you do now is the life you get later.",
        "Deep work beats busy work.",
        "You chose this. Stay with it.",
        "Small sessions, compounded, become everything.",
        "Attention is the rarest thing you own.",
        "One thing at a time, done properly.",
        "Discipline is choosing what you want most over what you want now.",
        "Nothing out there is more interesting than what you set out to do.",
        "Finish what you started.",
        "Your future self is watching.",
        "Progress is quiet. Keep going."
    )

    /**
     * A stable quote for a given session.
     *
     * Seeded so the same session always shows the same line — re-opening a
     * blocked app five times in a row should not feel like a slot machine.
     */
    fun forSession(seed: String): String {
        if (seed.isEmpty()) return QUOTES[0]
        var hash = 0
        for (char in seed) {
            hash = hash * 31 + char.code
        }
        return QUOTES[abs(hash) % QUOTES.size]
    }
}
