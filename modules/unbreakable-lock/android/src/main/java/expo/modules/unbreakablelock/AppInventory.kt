package expo.modules.unbreakablelock

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.os.Build
import android.util.Base64
import java.io.ByteArrayOutputStream

/**
 * Lists the apps the user can actually launch.
 *
 * We query the launcher intent rather than getInstalledPackages() so the result
 * matches what the user sees on their home screen, and so it keeps working
 * under Android 11+ package visibility without requesting broad visibility.
 *
 * Every failure path returns an empty list instead of throwing: an OEM that
 * denies enumeration must degrade the picker, not crash the app.
 */
object AppInventory {
    private const val ICON_SIZE_PX = 96

    data class Entry(val packageName: String, val appName: String, val iconBase64: String?)

    fun listLaunchableApps(context: Context, includeIcons: Boolean = true): List<Entry> {
        val pm = context.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)

        val resolved = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(0L))
            } else {
                @Suppress("DEPRECATION")
                pm.queryIntentActivities(intent, 0)
            }
        } catch (e: Exception) {
            emptyList()
        }

        val seen = HashSet<String>()
        val out = ArrayList<Entry>(resolved.size)
        // The launcher is launchable, so without this the user could block their
        // own home screen and have nowhere to go for the rest of the session.
        val protectedPackages = ProtectedPackages.forDevice(context)

        for (info in resolved) {
            val activityInfo = info.activityInfo ?: continue
            val pkg = activityInfo.packageName ?: continue
            if (pkg in protectedPackages) continue
            if (!seen.add(pkg)) continue

            val appInfo: ApplicationInfo = activityInfo.applicationInfo ?: continue

            // Keep updated system apps -- Chrome and YouTube ship preinstalled on
            // many devices and are legitimate targets -- but drop untouched
            // system components the user would never think of blocking.
            val isPlainSystemApp =
                (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0 &&
                    (appInfo.flags and ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) == 0
            if (isPlainSystemApp && !isNotableSystemApp(pkg)) continue

            val label = try {
                pm.getApplicationLabel(appInfo).toString()
            } catch (e: Exception) {
                pkg
            }

            val icon = if (includeIcons) {
                try {
                    encodeIcon(pm.getApplicationIcon(appInfo))
                } catch (e: Exception) {
                    null
                }
            } else {
                null
            }

            out.add(Entry(pkg, label, icon))
        }

        return out.sortedBy { it.appName.lowercase() }
    }

    /** Preinstalled apps that are still plausible distraction targets. */
    private fun isNotableSystemApp(pkg: String): Boolean = pkg in NOTABLE_SYSTEM_APPS

    private val NOTABLE_SYSTEM_APPS = setOf(
        "com.android.chrome",
        "com.google.android.youtube",
        "com.google.android.apps.youtube.music",
        "com.google.android.gm",
        "com.android.vending",
        "com.sec.android.app.sbrowser",
        "com.samsung.android.app.tips"
    )

    private fun encodeIcon(drawable: Drawable): String? {
        val bitmap = if (drawable is BitmapDrawable && drawable.bitmap != null) {
            Bitmap.createScaledBitmap(drawable.bitmap, ICON_SIZE_PX, ICON_SIZE_PX, true)
        } else {
            val bmp = Bitmap.createBitmap(ICON_SIZE_PX, ICON_SIZE_PX, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bmp)
            drawable.setBounds(0, 0, canvas.width, canvas.height)
            drawable.draw(canvas)
            bmp
        }
        val stream = ByteArrayOutputStream()
        return if (bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)) {
            Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
        } else {
            null
        }
    }
}
