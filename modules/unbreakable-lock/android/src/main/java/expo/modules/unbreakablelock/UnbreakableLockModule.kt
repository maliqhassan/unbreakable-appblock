package expo.modules.unbreakablelock

import android.content.Context
import android.os.Build
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Every rejection crossing into JS carries one of the shared LockErrorCode values. */
class LockException(code: String, message: String) : CodedException(code, message, null)

/**
 * The Android half of the JS contract in `modules/unbreakable-lock/src/types.ts`.
 *
 * This class is a thin, honest adapter: it validates input, delegates to the
 * service and the persisted store, and reports exactly what the platform can
 * do. Any capability Android does not offer through public APIs is reported as
 * false rather than approximated.
 *
 * Note the division of responsibility: this module is a *remote control* for
 * the lock, not the lock itself. Every method here reads or writes
 * [LockStateStore]; enforcement lives entirely in [LockForegroundService] and
 * keeps running with no JS process at all.
 */
class UnbreakableLockModule : Module() {

    private companion object {
        const val PICKER_IS_IOS_ONLY =
            "Android selects apps in the app itself, not a system picker."
    }

    /**
     * Rejects a method this platform does not implement.
     *
     * The declared return type matters: a lambda whose body only throws would
     * infer `Nothing`, which Expo cannot build a return converter for.
     */
    private fun <T> unsupported(message: String): T =
        throw LockException("UNSUPPORTED_PLATFORM", message)

    private val context: Context
        get() = appContext.reactContext
            ?: throw LockException("UNKNOWN", "Android context is unavailable.")

    override fun definition() = ModuleDefinition {
        Name("UnbreakableLockModule")

        Function("getCapabilities") { capabilitiesMap() }

        Function("getEnforcementCapabilities") { capabilitiesMap() }

        /**
         * Human-readable names for a handful of packages.
         *
         * Separate from `getInstalledApps` because that one base64-encodes an
         * icon for every launchable app on the device — far too much work when
         * all that is needed is a label for the two or three apps a lock
         * happens to cover.
         *
         * Unknown or uninstalled packages are simply absent from the result;
         * the caller keeps whatever it already had.
         */
        AsyncFunction("getAppLabels") { packages: List<String> ->
            val manager = context.packageManager
            val out = HashMap<String, String>(packages.size)
            for (pkg in packages) {
                try {
                    val info = manager.getApplicationInfo(pkg, 0)
                    out[pkg] = manager.getApplicationLabel(info).toString()
                } catch (e: Exception) {
                    // Not installed, or hidden by package visibility. Skipping
                    // leaves the caller showing the package name, which is at
                    // least true.
                }
            }
            out
        }

        /**
         * Whether this device's vendor needs a separate autostart grant, and
         * what that vendor calls it.
         *
         * `granted` is deliberately absent: Android exposes no way to read the
         * setting, so the app reports it as unknown rather than guessing.
         */
        Function("getOemAutostart") {
            mapOf(
                "needed" to OemSupport.needsAutostart(),
                "label" to OemSupport.autostartLabel(),
                "manufacturer" to Build.MANUFACTURER
            )
        }

        AsyncFunction("openAutostartSettings") {
            mapOf("opened" to OemSupport.openAutostartSettings(context))
        }

        AsyncFunction("getInstalledApps") {
            AppInventory.listLaunchableApps(context).map { entry ->
                mapOf(
                    "packageName" to entry.packageName,
                    "appName" to entry.appName,
                    "iconBase64" to entry.iconBase64
                )
            }
        }

        Function("isPermissionGranted") { permission: String ->
            LockPermissions.isGranted(context, permission)
        }

        Function("getPermissionStatus") { LockPermissions.statusMap(context) }

        AsyncFunction("requestPermission") { permission: String ->
            if (LockPermissions.isGranted(context, permission)) return@AsyncFunction true

            val intent = LockPermissions.settingsIntent(context, permission)
                ?: throw LockException(
                    "INVALID_CONFIGURATION",
                    "Unknown permission: $permission"
                )

            val activity = appContext.currentActivity
            try {
                if (activity != null) activity.startActivity(intent) else context.startActivity(intent)
            } catch (e: Exception) {
                throw LockException(
                    "UNSUPPORTED_PLATFORM",
                    "This device has no settings screen for $permission."
                )
            }

            // The user has only been shown the screen; they have not granted
            // anything yet. JS re-checks on app foreground.
            false
        }

        /** Diagnostics for the dev-only screen. Cheap enough to call on demand. */
        Function("getDiagnostics") {
            val state = LockStateStore.read(context)
            mapOf(
                "androidRelease" to Build.VERSION.RELEASE,
                "sdkInt" to Build.VERSION.SDK_INT,
                "manufacturer" to Build.MANUFACTURER,
                "model" to Build.MODEL,
                "serviceRunning" to LockForegroundService.isRunning,
                "sessionActive" to (state.active && !LockStateStore.isExpired(context)),
                "sessionId" to state.sessionId,
                "startTimestamp" to state.startWallMs.toDouble(),
                "endTimestamp" to state.endWallMs.toDouble(),
                "remainingMs" to LockStateStore.remainingMs(context).toDouble(),
                "strictMode" to state.strictMode,
                "targets" to state.packages.toList(),
                "degradedReason" to state.degradedReason,
                "permissions" to LockPermissions.statusMap(context),
                "protectedPackages" to ProtectedPackages.forDevice(context).toList(),
                // The merged view, so a report distinguishes "nothing is set"
                // from "a session exists but nothing is enforcing it".
                "effectiveActive" to EffectiveLock.isActive(context),
                "effectivePackages" to EffectiveLock.read(context).packages.toList(),
                "effectiveSources" to EffectiveLock.read(context).sources,
                "scheduleCount" to ScheduleStore.readAll(context).size,
                "scheduleActive" to ScheduleLockStore.isActive(context),
                "canScheduleExactAlarms" to ScheduleCoordinator.canScheduleExactAlarms(context),
                "dailyLimitCount" to DailyLimitStore.readLimits(context).size,
                "dailyLimitActive" to DailyLimitStore.isActive(context),
                "dailyLimitPackages" to DailyLimitStore.readLockState(context).packages.toList()
            )
        }

        // --- iOS-only surface. Present so the JS contract stays uniform. ---

        AsyncFunction("requestAuthorization") {
            unsupported<Boolean>("Screen Time authorization is an iOS concept.")
        }

        AsyncFunction("presentAppPicker") {
            unsupported<Map<String, Any>>(PICKER_IS_IOS_ONLY)
        }

        AsyncFunction("getSelectedApplications") {
            unsupported<Map<String, Any>>(PICKER_IS_IOS_ONLY)
        }

        // --- Lock lifecycle ---

        AsyncFunction("startLock") { ids: List<String>, endTimestamp: Double, strictMode: Boolean, sessionId: String ->
            if (ids.isEmpty()) {
                throw LockException("NO_SELECTION", "Select at least one app to block.")
            }

            val endMs = endTimestamp.toLong()
            val now = System.currentTimeMillis()
            if (endMs <= now) {
                throw LockException("INVALID_CONFIGURATION", "The end time is already in the past.")
            }

            if (!LockPermissions.isGranted(context, LockPermissions.USAGE_ACCESS)) {
                throw LockException(
                    "PERMISSION_REQUIRED",
                    "Usage access is required to detect which app is open."
                )
            }
            if (!LockPermissions.isGranted(context, LockPermissions.OVERLAY)) {
                throw LockException(
                    "PERMISSION_REQUIRED",
                    "Display over other apps is required to show the block screen."
                )
            }

            val existing = LockStateStore.read(context)
            if (existing.active && !LockStateStore.isExpired(context)) {
                throw LockException("ALREADY_ACTIVE", "A lock is already running.")
            }

            // Silently drop anything that would strand the user, rather than
            // refusing the whole lock over one bad entry.
            val protectedSet = ProtectedPackages.forDevice(context)
            val targets = ids.toSet() - protectedSet
            if (targets.isEmpty()) {
                throw LockException(
                    "INVALID_CONFIGURATION",
                    "Those apps cannot be blocked. The launcher, Settings and " +
                        "Unbreakable Lock itself are always allowed."
                )
            }

            LockStateStore.save(context, sessionId, now, endMs, strictMode, targets)

            try {
                LockForegroundService.start(context)
            } catch (e: Exception) {
                LockStateStore.clear(context)
                throw LockException(
                    "UNKNOWN",
                    "The enforcement service could not start: ${e.message}"
                )
            }

            // startForegroundService() returns immediately and reports nothing
            // if the service later fails its startForeground() call. Without
            // this wait, a service that died on startup still looked like a
            // successful lock: the UI counted down while nothing was enforced.
            if (!awaitServiceRunning()) {
                val reason = LockStateStore.read(context).degradedReason
                LockStateStore.clear(context)
                throw LockException(
                    "UNKNOWN",
                    reason
                        ?: "Android did not let the lock service start. Check that " +
                        "notifications are allowed for Unbreakable Lock, then try again."
                )
            }

            statusMap()
        }

        /**
         * Adds apps to the lock that is already running.
         *
         * Permitted during Strict Mode, unlike stopLock: this only tightens the
         * session. Refusing it would mean a user who decides mid-session that
         * one more app is a problem has to wait out the timer to act on that,
         * which punishes exactly the behaviour the app exists to encourage.
         *
         * The deadline and Strict Mode flag are left untouched.
         */
        AsyncFunction("addAppsToLock") { ids: List<String> ->
            if (ids.isEmpty()) {
                throw LockException("NO_SELECTION", "Select at least one app to add.")
            }

            val state = LockStateStore.read(context)
            if (!state.active || LockStateStore.isExpired(context)) {
                throw LockException("NOT_ACTIVE", "No lock is currently running.")
            }

            val protectedSet = ProtectedPackages.forDevice(context)
            val additions = ids.toSet() - protectedSet - state.packages
            if (additions.isEmpty()) {
                // Nothing new: report the current state rather than erroring.
                return@AsyncFunction statusMap()
            }

            LockStateStore.addPackages(context, additions)

            // The service re-reads persisted state every tick, so enforcement
            // picks the new packages up on its own. Nudging it just refreshes
            // the notification count promptly.
            try {
                LockForegroundService.start(context)
            } catch (e: Exception) {
                // Already running is the normal case; the tick will catch up.
            }

            statusMap()
        }

        /**
         * Ends the MANUAL lock only.
         *
         * A schedule that happens to be running is untouched: the user asking
         * to end a session they started by hand is not asking to cancel their
         * recurring routine. Enforcement continues if a schedule still covers it.
         */
        AsyncFunction("stopLock") { force: Boolean ->
            val state = LockStateStore.read(context)
            if (!state.active) {
                throw LockException("NOT_ACTIVE", "No lock is currently running.")
            }

            val expired = LockStateStore.isExpired(context)
            if (state.strictMode && !expired && !force) {
                throw LockException(
                    "STRICT_MODE_ACTIVE",
                    "Strict Mode is on. This lock cannot be ended before it expires."
                )
            }

            LockStateStore.clear(context)

            // Only stop enforcement if nothing else still needs it.
            if (EffectiveLock.isActive(context)) {
                LockForegroundService.start(context)
            } else {
                LockForegroundService.stop(context)
            }

            statusMap()
        }

        // --- Daily usage limits ---

        /**
         * Replaces the whole limit list, then re-evaluates against real usage.
         *
         * Evaluating on the same call is what makes an edit take effect at
         * once: lowering a limit below today's usage must lock immediately, not
         * at the next app launch.
         */
        AsyncFunction("saveDailyLimits") { limitsJson: String ->
            val parsed = DailyLimit.listFromJson(limitsJson)
            DailyLimitStore.replaceLimits(context, parsed)

            val exhausted = DailyLimitEngine.evaluate(context)
            // Keeps the service alive while anything needs measuring, and stops
            // it once the last limit is deleted.
            DailyLimitEngine.syncService(context)

            mapOf("saved" to parsed.size, "anyExhausted" to exhausted)
        }

        AsyncFunction("getDailyLimits") {
            DailyLimit.listToJson(DailyLimitStore.readLimits(context))
        }

        /** Today's usage for every configured limit. Drives the progress bars. */
        AsyncFunction("getDailyUsageStatus") { DailyLimitEngine.statusJson(context) }

        /** Forces a re-measure, e.g. when the app returns to the foreground. */
        AsyncFunction("refreshDailyLimits") { DailyLimitEngine.evaluate(context) }

        /**
         * Screen time for the last [days] days: a per-day total for the chart,
         * and today's apps with their categories.
         */
        AsyncFunction("getScreenTimeReport") { days: Int ->
            ScreenTimeQuery.reportJson(context, days.coerceIn(1, 14))
        }

        // --- Schedules ---

        /**
         * Replaces the whole schedule list, then re-evaluates immediately.
         *
         * A whole-list write rather than per-item CRUD: JS owns the collection,
         * and a single atomic replace removes any chance of the native list
         * disagreeing with what the user sees after an edit.
         */
        AsyncFunction("saveSchedules") { schedulesJson: String ->
            val parsed = try {
                val array = org.json.JSONArray(schedulesJson)
                val out = ArrayList<LockSchedule>(array.length())
                for (i in 0 until array.length()) {
                    val json = array.optJSONObject(i) ?: continue
                    LockSchedule.fromJson(json)?.let { out.add(it) }
                }
                out
            } catch (e: Exception) {
                throw LockException("INVALID_CONFIGURATION", "Schedules could not be read.")
            }

            ScheduleStore.replaceAll(context, parsed)
            // Editing an active schedule must take effect now, not at the next
            // alarm, or stale enforcement keeps running against the old times.
            val active = ScheduleCoordinator.reevaluate(context)

            mapOf("saved" to parsed.size, "scheduleActive" to active)
        }

        AsyncFunction("getSchedules") {
            org.json.JSONArray(ScheduleStore.readAll(context).map { it.toJson() }).toString()
        }

        /** Forces a re-evaluation, e.g. when the app returns to the foreground. */
        AsyncFunction("refreshSchedules") { ScheduleCoordinator.reevaluate(context) }

        /**
         * Whether Android will let us set exact alarms.
         *
         * False means transitions can be delayed by Doze, which the UI says
         * plainly rather than promising to-the-minute accuracy it cannot give.
         */
        Function("canScheduleExactAlarms") {
            ScheduleCoordinator.canScheduleExactAlarms(context)
        }

        AsyncFunction("getLockStatus") {
            val state = LockStateStore.read(context)

            // Reading is also the moment we notice expiry, so a lock that ran
            // out while the app was closed is tidied up here.
            if (state.active && LockStateStore.isExpired(context)) {
                LockStateStore.clear(context)
                LockForegroundService.stop(context)
            } else if (state.active && !LockForegroundService.isRunning) {
                // The session is live but nothing is enforcing it — the process
                // was killed and Android has not restarted the service yet.
                // Restart it now that we are alive to notice.
                try {
                    LockForegroundService.start(context)
                } catch (e: Exception) {
                    LockStateStore.setDegradedReason(
                        context,
                        "The lock service is not running and could not be restarted."
                    )
                }
            }

            statusMap()
        }
    }

    /**
     * Waits briefly for the foreground service to actually come up.
     *
     * @return true once [LockForegroundService.isRunning] is set, false if it
     *   never starts within the timeout.
     */
    private fun awaitServiceRunning(timeoutMs: Long = 2500L): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (LockForegroundService.isRunning) return true
            try {
                Thread.sleep(50L)
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                return LockForegroundService.isRunning
            }
        }
        return LockForegroundService.isRunning
    }

    private fun capabilitiesMap(): Map<String, Any> = mapOf(
        // We interrupt a blocked app after launch; we cannot pre-empt it.
        "canShieldApps" to true,
        "canMonitorUsage" to true,
        // Enforcement lives in a foreground service with persisted state.
        "canSurviveJsDeath" to true,
        "canSurviveReboot" to true,
        // Device admin can request uninstall protection, but it is unreliable
        // across OEMs, is disallowed by Play policy for this use case, and the
        // user can always revoke it. We do not ship it and we do not claim it.
        "canPreventUninstall" to false,
        // No public API lets a normal app block the Settings app.
        "canRestrictSettings" to false,
        "canBlockEarlyExit" to true
    )

    private fun statusMap(): Map<String, Any?> {
        val manual = LockStateStore.read(context)
        val effective = EffectiveLock.read(context)

        return mapOf(
            "active" to effective.active,
            "sessionId" to manual.sessionId,
            "startTimestamp" to manual.startWallMs.toDouble(),
            "endTimestamp" to effective.endWallMs.toDouble(),
            "strictMode" to effective.strictMode,
            "blockedIds" to effective.packages.toList(),
            "serviceRunning" to LockForegroundService.isRunning,
            "degradedReason" to effective.degradedReason,
            // Lets the UI say "Scheduled Lock" instead of implying the user
            // started this by hand.
            "sources" to effective.sources,
            "scheduleNames" to effective.scheduleNames.toList(),
            "dailyLimitPackages" to effective.dailyLimitPackages.toList(),
            "resetsAt" to effective.resetsAt.toDouble()
        )
    }
}
