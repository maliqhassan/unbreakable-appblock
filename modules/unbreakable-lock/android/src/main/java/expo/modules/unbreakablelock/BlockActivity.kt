package expo.modules.unbreakablelock

import android.app.Activity
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
        val blockedLabel = readableLabel(intent?.getStringExtra(EXTRA_PACKAGE))

        // Seeded by the session so re-opening a blocked app repeatedly shows a
        // consistent message rather than cycling through lines.
        val quote = FocusQuotes.forSession(LockStateStore.read(this).sessionId)

        setContentView(buildLayout(blockedLabel, quote))
    }

    override fun onResume() {
        super.onResume()
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

    private fun spacer(height: Int): View = View(this).apply {
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            height
        )
    }
}
