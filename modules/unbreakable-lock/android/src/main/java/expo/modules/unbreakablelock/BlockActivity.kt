package expo.modules.unbreakablelock

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * The screen shown when the user opens a blocked app.
 *
 * The UI is built in code rather than XML so this module needs no resource
 * merging into the host app.
 *
 * Tone: this screen says what is locked, how long is left, and one line about
 * why the user set the lock. It does not explain the mechanism, and it offers
 * no way to shorten the session — a "back to the app" affordance here would
 * defeat the entire point.
 *
 * Honest behaviour: this is a normal activity placed in front of the blocked
 * app. Back sends the user to their launcher.
 */
class BlockActivity : Activity() {

    companion object {
        const val EXTRA_PACKAGE = "blocked_package"
        const val EXTRA_END_TIMESTAMP = "end_timestamp"
        const val EXTRA_STRICT = "strict_mode"

        /** True when this block is a spent daily allowance rather than a timer. */
        const val EXTRA_DAILY_LIMIT = "daily_limit"

        /** The configured allowance, in minutes. Labels the snooze option. */
        const val EXTRA_LIMIT_MINUTES = "limit_minutes"

        /**
         * Whether the user may extend past the allowance.
         *
         * Decided by the service, not here: it depends on Strict Mode *and* on
         * whether another source is blocking the same app.
         */
        const val EXTRA_CAN_OVERRIDE = "can_override"

        /** Epoch ms of the next local midnight, when the allowance resets. */
        const val EXTRA_RESETS_AT = "resets_at"

        private const val ONE_MINUTE_MS = 60_000L

        /** Close by itself if the lock ended while this screen was open. */
        private const val REFRESH_INTERVAL_MS = 1000L

        private const val COLOR_BACKGROUND = "#0B0D10"
        private const val COLOR_SURFACE = "#16191E"
        private const val COLOR_BORDER = "#242932"
        private const val COLOR_TEXT = "#F2F4F7"
        private const val COLOR_MUTED = "#8A93A0"
        private const val COLOR_ACCENT = "#5A8CFF"
    }

    private var endTimestamp = 0L
    private var blockedPackage: String? = null
    private var isDailyLimit = false
    private var canOverride = false
    private var limitMinutes = 0
    private var resetsAt = 0L
    private lateinit var countdownView: TextView
    private val handler = Handler(Looper.getMainLooper())

    private val refresh = object : Runnable {
        override fun run() {
            if (LockStateStore.isExpired(this@BlockActivity)) {
                finish()
                return
            }
            countdownView.text = formatRemaining()
            handler.postDelayed(this, REFRESH_INTERVAL_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        endTimestamp = intent?.getLongExtra(EXTRA_END_TIMESTAMP, 0L) ?: 0L
        blockedPackage = intent?.getStringExtra(EXTRA_PACKAGE)
        isDailyLimit = intent?.getBooleanExtra(EXTRA_DAILY_LIMIT, false) ?: false
        canOverride = intent?.getBooleanExtra(EXTRA_CAN_OVERRIDE, false) ?: false
        limitMinutes = intent?.getIntExtra(EXTRA_LIMIT_MINUTES, 0) ?: 0
        resetsAt = intent?.getLongExtra(EXTRA_RESETS_AT, 0L) ?: 0L

        val blockedLabel = readableLabel(blockedPackage)

        setContentView(
            if (isDailyLimit) {
                buildDailyLimitLayout(blockedLabel)
            } else {
                // Seeded by the session so re-opening a blocked app repeatedly
                // shows a consistent message rather than cycling through lines.
                buildLayout(blockedLabel, FocusQuotes.forSession(LockStateStore.read(this).sessionId))
            }
        )
    }

    override fun onResume() {
        super.onResume()
        // The daily-limit screen has no countdown to run: the allowance lasts
        // until midnight, and the only thing that ends it early is the user
        // choosing to extend, which finishes this activity itself.
        if (isDailyLimit) return

        if (LockStateStore.isExpired(this)) {
            finish()
            return
        }
        handler.post(refresh)
    }

    override fun onPause() {
        handler.removeCallbacks(refresh)
        super.onPause()
    }

    @Deprecated("Back handling is intentionally simple here")
    override fun onBackPressed() {
        // Send the user home rather than back into the blocked app.
        goHome()
    }

    private fun goHome() {
        val home = Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_HOME)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            startActivity(home)
        } catch (e: Exception) {
            // No launcher resolvable -- nothing sensible left to do.
        }
        finish()
    }

    private fun readableLabel(packageName: String?): String {
        if (packageName.isNullOrEmpty()) return "This app"
        return try {
            val info = packageManager.getApplicationInfo(packageName, 0)
            packageManager.getApplicationLabel(info).toString()
        } catch (e: Exception) {
            packageName
        }
    }

    private fun formatRemaining(): String {
        val remaining = (endTimestamp - System.currentTimeMillis()).coerceAtLeast(0L)
        val hours = TimeUnit.MILLISECONDS.toHours(remaining)
        val minutes = TimeUnit.MILLISECONDS.toMinutes(remaining) % 60
        val seconds = TimeUnit.MILLISECONDS.toSeconds(remaining) % 60
        return String.format(Locale.US, "%02d:%02d:%02d", hours, minutes, seconds)
    }

    private fun buildLayout(blockedLabel: String, quote: String): ViewGroup {
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor(COLOR_BACKGROUND))
            setPadding(dp(32), dp(48), dp(32), dp(48))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        // Lock glyph in a soft circle, so the screen reads as designed rather
        // than as a system error dialog.
        root.addView(TextView(this).apply {
            text = "🔒"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 34f)
            gravity = Gravity.CENTER
            val diameter = dp(84)
            layoutParams = LinearLayout.LayoutParams(diameter, diameter).apply {
                gravity = Gravity.CENTER_HORIZONTAL
            }
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor(COLOR_SURFACE))
                setStroke(dp(1), Color.parseColor(COLOR_BORDER))
            }
        })

        root.addView(spacer(dp(28)))

        // The countdown is the hero: it is the only thing that actually changes.
        countdownView = TextView(this).apply {
            text = formatRemaining()
            setTextColor(Color.parseColor(COLOR_TEXT))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 52f)
            gravity = Gravity.CENTER
            letterSpacing = -0.02f
            typeface = android.graphics.Typeface.MONOSPACE
        }
        root.addView(countdownView)

        root.addView(spacer(dp(8)))

        root.addView(TextView(this).apply {
            text = blockedLabel.uppercase(Locale.getDefault()) + " IS LOCKED"
            setTextColor(Color.parseColor(COLOR_ACCENT))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            gravity = Gravity.CENTER
            letterSpacing = 0.12f
        })

        root.addView(spacer(dp(40)))

        root.addView(TextView(this).apply {
            text = quote
            setTextColor(Color.parseColor(COLOR_TEXT))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 19f)
            gravity = Gravity.CENTER
            setLineSpacing(dp(6).toFloat(), 1f)
        })

        root.addView(spacer(dp(12)))

        root.addView(TextView(this).apply {
            text = "Press back to return home."
            setTextColor(Color.parseColor(COLOR_MUTED))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            gravity = Gravity.CENTER
        })

        return root
    }

    // MARK: - Daily limit

    /**
     * The screen for a spent daily allowance.
     *
     * Deliberately different from the timer block. A timer is a commitment the
     * user made for a fixed stretch and the honest thing is to show how long is
     * left. An allowance is a budget for the day, and — with Strict Mode off —
     * the user is allowed to overspend it knowingly. Pretending otherwise would
     * just teach them to uninstall the app.
     *
     * "Ignore limit" is never hidden behind a delay or a puzzle. The friction
     * that matters is being interrupted and having to choose; anything beyond
     * that is theatre.
     */
    private fun buildDailyLimitLayout(blockedLabel: String): ViewGroup {
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor(COLOR_BACKGROUND))
            setPadding(dp(32), dp(48), dp(32), dp(48))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        root.addView(TextView(this).apply {
            text = "⏳"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 34f)
            gravity = Gravity.CENTER
            val diameter = dp(84)
            layoutParams = LinearLayout.LayoutParams(diameter, diameter).apply {
                gravity = Gravity.CENTER_HORIZONTAL
            }
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor(COLOR_SURFACE))
                setStroke(dp(1), Color.parseColor(COLOR_BORDER))
            }
        })

        root.addView(spacer(dp(28)))

        root.addView(TextView(this).apply {
            text = "Daily limit reached"
            setTextColor(Color.parseColor(COLOR_TEXT))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 28f)
            gravity = Gravity.CENTER
            letterSpacing = -0.02f
        })

        root.addView(spacer(dp(10)))

        root.addView(TextView(this).apply {
            text = if (limitMinutes > 0) {
                "You've used your $limitMinutes minutes of $blockedLabel for today."
            } else {
                "You've used your time for $blockedLabel today."
            }
            setTextColor(Color.parseColor(COLOR_MUTED))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            gravity = Gravity.CENTER
            setLineSpacing(dp(5).toFloat(), 1f)
        })

        root.addView(spacer(dp(6)))

        root.addView(TextView(this).apply {
            text = resetLine()
            setTextColor(Color.parseColor(COLOR_ACCENT))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            gravity = Gravity.CENTER
        })

        root.addView(spacer(dp(36)))

        root.addView(button("OK", primary = true) { goHome() })

        if (canOverride) {
            root.addView(spacer(dp(12)))
            root.addView(button("Ignore limit", primary = false) { showIgnoreOptions() })
        } else {
            root.addView(spacer(dp(16)))
            root.addView(TextView(this).apply {
                // Say why there is no way out, rather than leaving the user to
                // wonder whether the button is missing or broken.
                text = "Strict Mode is on, so this limit can't be extended today."
                setTextColor(Color.parseColor(COLOR_MUTED))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                gravity = Gravity.CENTER
            })
        }

        return root
    }

    /**
     * The four ways out, once the user has said they want one.
     *
     * A second step rather than four buttons on the block screen itself: the
     * first screen should read as "you are done for today", and offering a menu
     * of escapes there would undercut it.
     */
    private fun showIgnoreOptions() {
        val snoozeMinutes = if (limitMinutes > 0) limitMinutes else 15

        val labels = arrayOf(
            "One more minute",
            "Remind me in $snoozeMinutes minutes",
            "Ignore limit for today",
            "Cancel"
        )

        AlertDialog.Builder(this)
            .setTitle("Ignore today's limit?")
            .setItems(labels) { dialog, which ->
                when (which) {
                    0 -> grant(ONE_MINUTE_MS)
                    1 -> grant(snoozeMinutes * ONE_MINUTE_MS)
                    2 -> grantUntilReset()
                    else -> dialog.dismiss()
                }
            }
            .setOnCancelListener { /* Stay blocked; the user changed their mind. */ }
            .show()
    }

    /** Extends the allowance by [durationMs] and returns the user to their app. */
    private fun grant(durationMs: Long) {
        applyOverride(System.currentTimeMillis() + durationMs)
    }

    /**
     * Ignores the limit for the rest of the day.
     *
     * Bounded by the reset, not open-ended: tomorrow the allowance applies
     * again without the user having to remember to re-enable anything.
     */
    private fun grantUntilReset() {
        val until = if (resetsAt > System.currentTimeMillis()) {
            resetsAt
        } else {
            UsageQuery.nextMidnight(System.currentTimeMillis())
        }
        applyOverride(until)
    }

    private fun applyOverride(untilMs: Long) {
        val pkg = blockedPackage
        if (pkg.isNullOrEmpty()) {
            finish()
            return
        }

        DailyLimitStore.setOverride(this, pkg, untilMs)
        // Recompute at once so the service stops treating the app as locked
        // before the user gets back to it.
        DailyLimitEngine.evaluate(this)

        returnToBlockedApp(pkg)
    }

    /**
     * Reopens the app the user was trying to use.
     *
     * The block screen was launched with CLEAR_TASK, so simply finishing would
     * drop them on the launcher — having just been told they may continue,
     * which would read as the override not working.
     */
    private fun returnToBlockedApp(packageName: String) {
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                startActivity(launch)
            } catch (e: Exception) {
                // Nothing sensible left to do; at least stop blocking.
            }
        }
        finish()
    }

    private fun resetLine(): String {
        if (resetsAt <= 0L) return "Resets at midnight"
        val formatter = java.text.SimpleDateFormat("h:mm a", Locale.getDefault())
        return "Resets at ${formatter.format(java.util.Date(resetsAt))}"
    }

    /** A full-width button, built in code like the rest of this screen. */
    private fun button(label: String, primary: Boolean, onClick: () -> Unit): View {
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        return TextView(this).apply {
            text = label
            gravity = Gravity.CENTER
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setTextColor(Color.parseColor(if (primary) "#FFFFFF" else COLOR_TEXT))
            setPadding(dp(20), dp(15), dp(20), dp(15))
            isClickable = true
            isFocusable = true
            background = GradientDrawable().apply {
                cornerRadius = dp(14).toFloat()
                setColor(Color.parseColor(if (primary) COLOR_ACCENT else COLOR_SURFACE))
                if (!primary) setStroke(dp(1), Color.parseColor(COLOR_BORDER))
            }
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            setOnClickListener { onClick() }
        }
    }

    private fun spacer(height: Int): View = View(this).apply {
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            height
        )
    }
}
