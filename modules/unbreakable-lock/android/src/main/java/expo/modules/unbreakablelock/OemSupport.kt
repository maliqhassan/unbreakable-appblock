package expo.modules.unbreakablelock

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * The manufacturers that kill background services regardless of Android's own
 * rules, and what can be done about it.
 *
 * **Why this exists.** Xiaomi, Oppo, Vivo, Huawei and a few others ship their
 * own power managers that sit above Android's. Granting "unrestricted battery
 * use" — the setting Android itself exposes and the only one this app could ask
 * for — does not stop MIUI killing a foreground service, and it does not let
 * one restart after a reboot. On those devices there is a *separate* Autostart
 * permission buried in the vendor's own security app, and without it a daily
 * limit simply stops being measured.
 *
 * **What cannot be done.** Android offers no API to read whether Autostart is
 * granted. There is no permission check, no AppOps entry, nothing. So this
 * reports the setting as `unknown` and says so, rather than claiming a status
 * it cannot know. Guessing "granted" would tell someone they are protected when
 * they may not be, which is the worst failure this app has.
 *
 * The intents below are the vendors' own settings activities. They are not
 * public API and can disappear in a firmware update, so every launch is
 * attempted and falls back to the app's normal settings page.
 */
object OemSupport {
    private const val TAG = "UnbreakableOem"

    /** Vendors known to need a separate autostart grant. */
    private val AGGRESSIVE = setOf(
        "xiaomi", "redmi", "poco",
        "oppo", "realme", "oneplus",
        "vivo", "iqoo",
        "huawei", "honor",
        "meizu", "asus", "letv", "samsung"
    )

    private val manufacturer: String
        get() = Build.MANUFACTURER.lowercase()

    private val brand: String
        get() = Build.BRAND.lowercase()

    /** True when this device's vendor is known to need extra setup. */
    fun needsAutostart(): Boolean =
        AGGRESSIVE.any { manufacturer.contains(it) || brand.contains(it) }

    /**
     * A human name for the screen the user has to visit.
     *
     * Vendors label the same setting differently, and telling someone to look
     * for "Autostart" on a phone that calls it "Auto-launch" is how people give
     * up half way through.
     */
    fun autostartLabel(): String = when {
        matches("xiaomi", "redmi", "poco") -> "Autostart"
        matches("oppo", "realme") -> "Allow auto-launch"
        matches("vivo", "iqoo") -> "Auto start"
        matches("huawei", "honor") -> "App launch"
        matches("samsung") -> "Never sleeping apps"
        matches("oneplus") -> "Battery optimisation"
        else -> "Autostart"
    }

    /**
     * Where to send the user, in order of preference.
     *
     * A list rather than one intent: vendors move these activities between
     * firmware versions, so the caller tries each until one resolves.
     */
    private fun candidates(context: Context): List<Intent> {
        val out = ArrayList<Intent>(3)

        fun add(pkg: String, cls: String) {
            out.add(Intent().setComponent(ComponentName(pkg, cls)))
        }

        when {
            matches("xiaomi", "redmi", "poco") -> {
                add(
                    "com.miui.securitycenter",
                    "com.miui.permcenter.autostart.AutoStartManagementActivity"
                )
            }

            matches("oppo", "realme") -> {
                add("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity")
                add("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity")
            }

            matches("vivo", "iqoo") -> {
                add("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity")
            }

            matches("huawei", "honor") -> {
                add("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity")
            }

            matches("samsung") -> {
                add("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity")
            }
        }

        // Always last: the app's own settings page always exists.
        out.add(
            Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(android.net.Uri.parse("package:" + context.packageName))
        )

        return out
    }

    /**
     * Opens the vendor's autostart screen, or the app settings page.
     *
     * @return true when something opened. False means every candidate was
     *   missing, which the caller should report rather than swallow.
     */
    fun openAutostartSettings(context: Context): Boolean {
        for (intent in candidates(context)) {
            try {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
                return true
            } catch (e: Exception) {
                Log.d(TAG, "Autostart candidate did not resolve: ${intent.component}", e)
            }
        }
        return false
    }

    private fun matches(vararg names: String): Boolean =
        names.any { manufacturer.contains(it) || brand.contains(it) }
}
