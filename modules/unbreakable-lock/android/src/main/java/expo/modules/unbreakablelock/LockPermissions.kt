package expo.modules.unbreakablelock

import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.provider.Settings

/**
 * Permission checks, and the system-settings intents that let the user grant
 * them.
 *
 * None of these can be granted programmatically. Each one deliberately requires
 * the user to make the choice in Settings, so `settingsIntent` only opens the
 * right screen -- we never try to route around that.
 */
object LockPermissions {
    const val USAGE_ACCESS = "usageAccess"
    const val OVERLAY = "overlay"
    const val NOTIFICATIONS = "notifications"
    const val BATTERY_OPTIMIZATION = "batteryOptimization"

    /** Reported for diagnostics only — see [statusMap]. Never requested. */
    const val ACCESSIBILITY = "accessibility"

    /**
     * Every permission's state in one call.
     *
     * `accessibility` is reported for diagnostic completeness and is always
     * false: this app deliberately ships no AccessibilityService. Reading the
     * screen contents of other apps is not needed for timed blocking, and
     * requesting that access for a wellbeing app would be disproportionate.
     */
    fun statusMap(context: Context): Map<String, Boolean> = mapOf(
        USAGE_ACCESS to isGranted(context, USAGE_ACCESS),
        OVERLAY to isGranted(context, OVERLAY),
        NOTIFICATIONS to isGranted(context, NOTIFICATIONS),
        BATTERY_OPTIMIZATION to isGranted(context, BATTERY_OPTIMIZATION),
        ACCESSIBILITY to false
    )

    fun isGranted(context: Context, permission: String): Boolean = when (permission) {
        USAGE_ACCESS -> hasUsageAccess(context)
        OVERLAY -> Settings.canDrawOverlays(context)
        NOTIFICATIONS -> hasNotificationPermission(context)
        BATTERY_OPTIMIZATION -> isIgnoringBatteryOptimizations(context)
        else -> false
    }

    /** @return an Intent opening the correct settings page, or null if unknown. */
    fun settingsIntent(context: Context, permission: String): Intent? {
        val packageUri = Uri.parse("package:" + context.packageName)
        val intent = when (permission) {
            // No per-app deep link exists for usage access on most OEM builds;
            // the system list is the documented destination.
            USAGE_ACCESS -> Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
            OVERLAY -> Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, packageUri)
            NOTIFICATIONS -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            BATTERY_OPTIMIZATION -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            else -> null
        }
        return intent?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    private fun hasUsageAccess(context: Context): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager
            ?: return false
        // Both variants are marked deprecated, but AppOps remains the only way
        // to read usage-access state -- there is no replacement API.
        @Suppress("DEPRECATION")
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName
            )
        } else {
            appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName
            )
        }
        return if (mode == AppOpsManager.MODE_DEFAULT) {
            context.checkPermission(
                android.Manifest.permission.PACKAGE_USAGE_STATS,
                Process.myPid(),
                Process.myUid()
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            mode == AppOpsManager.MODE_ALLOWED
        }
    }

    private fun hasNotificationPermission(context: Context): Boolean {
        // The runtime notification permission only exists on Android 13+.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return context.checkPermission(
            android.Manifest.permission.POST_NOTIFICATIONS,
            Process.myPid(),
            Process.myUid()
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun isIgnoringBatteryOptimizations(context: Context): Boolean {
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
        return pm.isIgnoringBatteryOptimizations(context.packageName)
    }
}
