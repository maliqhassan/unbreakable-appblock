package expo.modules.unbreakablelock

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings

/**
 * Packages that must never be blocked, no matter what is in the session.
 *
 * Blocking the home launcher would leave the user with no way to reach anything
 * for the rest of the session; blocking Settings would trap them with no way to
 * revoke our permissions; blocking the dialer could stop an emergency call. A
 * digital-wellbeing app that can strand someone on their own phone is a defect,
 * not a feature.
 *
 * This is enforced in two places on purpose:
 *   1. [AppInventory] hides these from the picker, so they cannot be selected.
 *   2. [LockForegroundService] re-checks at enforcement time, so a stale or
 *      hand-edited session still cannot block them.
 */
object ProtectedPackages {

    /** Known system surfaces that are never legitimate lock targets. */
    private val ALWAYS_PROTECTED = setOf(
        "com.android.systemui",
        "com.android.settings",
        "com.android.phone",
        "com.android.server.telecom",
        "com.android.dialer",
        "com.google.android.dialer",
        "com.android.emergency",
        "com.android.packageinstaller",
        "com.google.android.packageinstaller",
        "com.android.permissioncontroller",
        "com.google.android.permissioncontroller"
    )

    /**
     * @return every package the enforcement layer must leave alone, including
     *   this app itself and whichever launcher the device is actually using.
     */
    fun forDevice(context: Context): Set<String> {
        val protectedSet = HashSet<String>(ALWAYS_PROTECTED)
        protectedSet.add(context.packageName)
        protectedSet.addAll(launcherPackages(context))
        return protectedSet
    }

    fun isProtected(context: Context, packageName: String): Boolean =
        packageName in forDevice(context)

    /**
     * Every package that can act as a home screen.
     *
     * We resolve the full list rather than just the default, so switching
     * launchers mid-session cannot strand the user either.
     */
    private fun launcherPackages(context: Context): Set<String> {
        val pm = context.packageManager
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)

        val result = HashSet<String>()

        try {
            val resolved = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.queryIntentActivities(home, PackageManager.ResolveInfoFlags.of(0L))
            } else {
                @Suppress("DEPRECATION")
                pm.queryIntentActivities(home, 0)
            }
            resolved.mapNotNullTo(result) { it.activityInfo?.packageName }
        } catch (e: Exception) {
            // Package visibility refused the query. The explicit default below
            // is still worth trying.
        }

        try {
            val default = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.resolveActivity(home, PackageManager.ResolveInfoFlags.of(0L))
            } else {
                @Suppress("DEPRECATION")
                pm.resolveActivity(home, 0)
            }
            default?.activityInfo?.packageName?.let { result.add(it) }
        } catch (e: Exception) {
            // Nothing more we can do; the static list still applies.
        }

        return result
    }

    /**
     * The Settings package as the device actually reports it.
     *
     * OEMs rename it (Samsung uses `com.samsung.android.settings` on some
     * builds), so resolving the intent beats hardcoding.
     */
    fun settingsPackage(context: Context): String? = try {
        val intent = Intent(Settings.ACTION_SETTINGS)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.packageManager.resolveActivity(intent, PackageManager.ResolveInfoFlags.of(0L))
        } else {
            @Suppress("DEPRECATION")
            context.packageManager.resolveActivity(intent, 0)
        }?.activityInfo?.packageName
    } catch (e: Exception) {
        null
    }
}
