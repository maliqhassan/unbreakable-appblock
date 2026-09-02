package expo.modules.unbreakablelock

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.SystemClock
import android.provider.Settings
import android.util.Log

/**
 * The enforcement loop.
 *
 * What this actually does, precisely:
 *   1. Runs as a foreground service so Android keeps it alive while a lock runs.
 *   2. While the screen is on, polls UsageStatsManager for the most recent
 *      foreground-app event.
 *   3. If that app is on the blocked list, starts [BlockActivity] over it.
 *   4. Stops itself exactly when the persisted deadline passes.
 *
 * What it does NOT do, because the OS does not permit it:
 *   - It cannot prevent the blocked app from launching, only interrupt it
 *     immediately afterwards. There is a sub-second window where the app is
 *     visible.
 *   - It cannot stop the user disabling this service, revoking usage access,
 *     force-stopping the app, or uninstalling it. See README.
 *
 * The service reads its state from [LockStateStore] on every tick, never from
 * React Native, so it keeps working when the JS runtime is gone and picks up
 * changes made while it was dead.
 */
class LockForegroundService : Service() {

    companion object {
        private const val TAG = "UnbreakableLockSvc"
        private const val CHANNEL_ID = "unbreakable_lock_session"
        private const val NOTIFICATION_ID = 4711
        private const val POLL_INTERVAL_MS = 1000L

        /**
         * Usage events lag slightly behind the actual switch, so each query
         * looks a little way back rather than only since the previous one.
         */
        private const val EVENT_LOOKBACK_MS = 60_000L

        /** Do not re-show the block screen faster than this. */
        private const val REBLOCK_COOLDOWN_MS = 1500L

        /** Re-check permissions every N ticks rather than on every one. */
        private const val PERMISSION_CHECK_EVERY_TICKS = 5

        const val ACTION_START = "expo.modules.unbreakablelock.START"
        const val ACTION_STOP = "expo.modules.unbreakablelock.STOP"

        /**
         * Set while the service is alive. Read by the module for diagnostics —
         * a persisted "active" flag says a lock *should* be running, this says
         * enforcement actually is.
         */
        @Volatile
        var isRunning: Boolean = false
            private set

        fun start(context: Context) {
            val intent = Intent(context, LockForegroundService::class.java)
                .setAction(ACTION_START)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.startService(
                Intent(context, LockForegroundService::class.java).setAction(ACTION_STOP)
            )
        }
    }

    private var thread: HandlerThread? = null
    private var handler: Handler? = null
    private var lastBlockAtElapsed = 0L
    private var tickCount = 0L
    private var screenOn = true
    private var protectedPackages: Set<String> = emptySet()

    /**
     * The last package we actually saw come to the foreground.
     *
     * UsageStats only reports *transitions*. Sit in one app for longer than the
     * lookback window and the query returns nothing at all — which used to read
     * as "no app is open" and silently stop enforcing. Remembering the last
     * transition keeps the answer correct until the next one arrives.
     */
    private var lastForegroundPackage: String? = null

    /**
     * Polling only happens while the screen is on.
     *
     * Nothing can be launched on a dark screen, so a 1s poll during a sleeping
     * 8-hour lock would burn battery for no enforcement benefit at all — the
     * single biggest cause of a lock being killed by an OEM battery manager.
     */
    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                Intent.ACTION_SCREEN_ON -> {
                    screenOn = true
                    // Poll immediately: the user may already be opening something.
                    handler?.removeCallbacks(tick)
                    handler?.post(tick)
                }
                Intent.ACTION_SCREEN_OFF -> screenOn = false
            }
        }
    }

    private val tick = object : Runnable {
        override fun run() {
            try {
                pollOnce()
            } catch (e: Exception) {
                // A single bad poll must never take the service down; the lock
                // continuing matters more than this tick succeeding.
                Log.w(TAG, "poll failed", e)
            }
            // Still wake once a second when the screen is off so expiry and
            // state changes are noticed, but skip the usage query itself.
            handler?.postDelayed(this, POLL_INTERVAL_MS)
        }
    }

    /** Fires exactly at the deadline rather than waiting for a poll to notice. */
    private val expiryRunnable = Runnable {
        // `watching` matters as much as `active` here. A daily limit that has
        // not been reached yet locks nothing, so the session looks finished
        // while it is in fact the state the watcher exists to sit in. Shutting
        // down here stopped daily limits from ever being enforced.
        if (!EffectiveLock.isActive(this) && !DailyLimitStore.hasEnabledLimits(this)) {
            finishSession()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopEverything()
            return START_NOT_STICKY
        }

        // A null intent means Android recreated us after killing the process.
        // Everything below re-derives from persisted state, so that path and a
        // fresh start are handled identically.
        val effective = EffectiveLock.read(this)
        // Daily limits need the service running before anything is locked: it
        // is what measures usage and notices the threshold being crossed.
        val watching = DailyLimitStore.hasEnabledLimits(this)

        if (!effective.active && !watching) {
            // Tidy up whichever source has run out; the other may be untouched.
            if (LockStateStore.read(this).active && LockStateStore.isExpired(this)) {
                LockStateStore.clear(this)
            }
            if (!ScheduleLockStore.isActive(this)) ScheduleLockStore.clear(this)
            stopEverything()
            return START_NOT_STICKY
        }

        protectedPackages = ProtectedPackages.forDevice(this)

        // If Android refuses the foreground start there is nothing to poll, and
        // starting the loop anyway would leave a stopping service ticking.
        if (!startForegroundSafely(effective)) return START_NOT_STICKY

        startPolling()
        scheduleExactExpiry()

        // START_STICKY: if Android kills us for memory, restart the service and
        // re-read the persisted lock rather than silently ending the session.
        return START_STICKY
    }

    override fun onDestroy() {
        stopPolling()
        isRunning = false
        super.onDestroy()
    }

    // MARK: - Lifecycle

    private fun startPolling() {
        if (thread != null) return

        val t = HandlerThread("unbreakable-lock-poll").also { it.start() }
        thread = t
        handler = Handler(t.looper)

        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_SCREEN_OFF)
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(screenReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(screenReceiver, filter)
            }
        } catch (e: Exception) {
            // Without the receiver we simply poll all the time — less efficient
            // but still correct, so this is not fatal.
            Log.w(TAG, "Could not register screen receiver", e)
        }

        isRunning = true
        handler?.post(tick)
    }

    private fun stopPolling() {
        handler?.removeCallbacksAndMessages(null)
        handler = null
        thread?.quitSafely()
        thread = null

        try {
            unregisterReceiver(screenReceiver)
        } catch (e: IllegalArgumentException) {
            // Never registered, or already gone. Nothing to undo.
        }
    }

    /** Posts the stop for the exact moment the deadline passes. */
    private fun scheduleExactExpiry() {
        val remaining = EffectiveLock.remainingMs(this)
        handler?.removeCallbacks(expiryRunnable)

        // Nothing is locked, so there is no deadline to fire on. This is the
        // normal state while watching daily limits, and posting a near-instant
        // runnable here would just ask the service to reconsider shutting down
        // every time it starts. The poll loop handles this state.
        if (remaining <= 0L) return

        handler?.postDelayed(expiryRunnable, remaining + 250L)
    }

    /**
     * Every source has run out: clear them and shut down.
     *
     * Each source is cleared only if it is genuinely finished, so a manual lock
     * ending never wipes a schedule that is still running, or vice versa.
     */
    private fun finishSession() {
        if (LockStateStore.read(this).active && LockStateStore.isExpired(this)) {
            LockStateStore.clear(this)
        }
        if (!ScheduleLockStore.isActive(this)) ScheduleLockStore.clear(this)
        stopEverything()
    }

    private fun stopEverything() {
        stopPolling()
        isRunning = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }

    // MARK: - The loop

    private fun pollOnce() {
        tickCount += 1

        // Re-read every tick: sources may have changed while the service was
        // dead, and caching them in a field was how stale package lists used to
        // survive a restart.
        val state = EffectiveLock.read(this)
        val watching = DailyLimitStore.hasEnabledLimits(this)

        if (!state.active && !watching) {
            finishSession()
            return
        }

        if (tickCount % PERMISSION_CHECK_EVERY_TICKS == 0L) {
            checkEnforcementStillPossible(state)
        }

        // Nothing can be opened while the screen is off, so skip the query.
        if (!screenOn) return

        val current = currentForegroundPackage()

        // Usage only accrues for the app in front of the user, so the allowance
        // is only ever re-measured for that one package. Querying every limited
        // app on every tick would be wasted work.
        if (current != null && watching) {
            checkDailyAllowance(current)
        }
        if (current == null) {
            // Usage access is the only reason this stays null, and the periodic
            // permission check above reports that; log once in a while so a
            // device-specific failure is visible in logcat.
            if (tickCount % 30L == 0L) Log.w(TAG, "No foreground app detected")
            return
        }

        if (tickCount % 30L == 0L) {
            Log.d(TAG, "Foreground=$current blocked=${state.packages}")
        }

        // Defence in depth: even if a protected package somehow reached the
        // session, never block it. Stranding the user is worse than a miss.
        if (current in protectedPackages) return

        // Re-read: checkDailyAllowance may have just exhausted this very app,
        // and waiting for the next tick would hand out another second of use.
        val blocked = EffectiveLock.read(this).packages
        if (current !in blocked) return

        val now = SystemClock.elapsedRealtime()
        if (now - lastBlockAtElapsed < REBLOCK_COOLDOWN_MS) return
        lastBlockAtElapsed = now

        showBlockScreen(current, state)
    }

    /**
     * Measures the foreground app against its daily allowance.
     *
     * Only the app actually in front of the user is measured, and only while a
     * limit exists for it. This is the moment the allowance can be crossed, so
     * it runs every tick rather than on a slow timer — a minute of slack here
     * would be a minute of free usage.
     */
    private fun checkDailyAllowance(packageName: String) {
        val limit = DailyLimitStore.readLimits(this)
            .firstOrNull { it.enabled && it.packageName == packageName }
            ?: return

        // Already spent: nothing to recompute until midnight.
        if (DailyLimitStore.isActive(this) &&
            DailyLimitStore.readLockState(this).packages.contains(packageName)
        ) {
            return
        }

        val used = UsageQuery.usageTodaySeconds(this, packageName) ?: return
        if (used < limit.limitSeconds) return

        Log.d(TAG, "Daily allowance spent for $packageName (${used}s)")
        DailyLimitEngine.evaluate(this)
        updateNotification()
    }

    /**
     * Detects a permission being revoked mid-session.
     *
     * Without this the service keeps running, silently blocks nothing, and the
     * app goes on telling the user they are protected. Recording the reason
     * lets the UI say what actually happened.
     */
    private fun checkEnforcementStillPossible(state: EffectiveLock.State) {
        val reason = when {
            !LockPermissions.isGranted(this, LockPermissions.USAGE_ACCESS) ->
                "Usage access was turned off, so blocked apps can no longer be detected."
            !LockPermissions.isGranted(this, LockPermissions.OVERLAY) ->
                "Display over other apps was turned off, so the block screen cannot appear."
            else -> null
        }

        if (reason != state.degradedReason) {
            LockStateStore.setDegradedReason(this, reason)
            updateNotification()
            if (reason != null) Log.w(TAG, "Enforcement degraded: $reason")
        }
    }

    /**
     * @return the package most recently moved to the foreground, or null when
     *   usage access is missing or no event is available.
     */
    private fun currentForegroundPackage(): String? {
        val usage = getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
            ?: return null

        val end = System.currentTimeMillis()
        val events = try {
            usage.queryEvents(end - EVENT_LOOKBACK_MS, end)
        } catch (e: Exception) {
            return null
        }

        val event = UsageEvents.Event()
        var latestPackage: String? = null
        var latestTime = 0L

        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            val isForeground = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                event.eventType == UsageEvents.Event.ACTIVITY_RESUMED
            } else {
                @Suppress("DEPRECATION")
                event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND
            }
            if (isForeground && event.timeStamp >= latestTime) {
                latestTime = event.timeStamp
                latestPackage = event.packageName
            }
        }

        if (latestPackage != null) {
            lastForegroundPackage = latestPackage
            return latestPackage
        }

        // No transition in this window means nothing has changed, not that the
        // screen is empty.
        return lastForegroundPackage
    }

    private fun showBlockScreen(packageName: String, state: EffectiveLock.State) {
        // Android 10+ blocks background activity starts unless the app holds
        // SYSTEM_ALERT_WINDOW. Without it we cannot interrupt anything, so we
        // log rather than pretending the block happened.
        if (!Settings.canDrawOverlays(this)) {
            Log.w(TAG, "Overlay permission missing; cannot show block screen")
            return
        }

        val intent = Intent(this, BlockActivity::class.java)
            .addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TASK or
                    Intent.FLAG_ACTIVITY_NO_ANIMATION
            )
            .putExtra(BlockActivity.EXTRA_PACKAGE, packageName)
            .putExtra(BlockActivity.EXTRA_END_TIMESTAMP, state.endWallMs)
            .putExtra(BlockActivity.EXTRA_STRICT, state.strictMode)

        try {
            startActivity(intent)
        } catch (e: Exception) {
            Log.w(TAG, "Could not start block activity", e)
        }
    }

    // MARK: - Notification

    /** @return true when the service is actually in the foreground. */
    private fun startForegroundSafely(state: EffectiveLock.State): Boolean {
        val notification = buildNotification(state)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            return true
        } catch (e: Exception) {
            // Notifications denied, or a foreground-service start restriction.
            // We cannot enforce without the service, so record why instead of
            // leaving a session that claims to be protecting the user.
            Log.e(TAG, "startForeground failed", e)
            LockStateStore.setDegradedReason(
                this,
                "Android would not let the lock service start. Check that notifications " +
                    "are allowed for Unbreakable Lock."
            )
            stopSelf()
            return false
        }
    }

    private fun updateNotification() {
        val state = EffectiveLock.read(this)
        // Not `state.active`: while watching daily limits nothing is locked,
        // and the notification still has to say so.
        if (!state.active && !DailyLimitStore.hasEnabledLimits(this)) return
        try {
            val manager = getSystemService(NotificationManager::class.java) ?: return
            manager.notify(NOTIFICATION_ID, buildNotification(state))
        } catch (e: Exception) {
            Log.w(TAG, "Could not update notification", e)
        }
    }

    private fun buildNotification(state: EffectiveLock.State): Notification {
        createChannel()

        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val contentIntent = launch?.let {
            PendingIntent.getActivity(
                this,
                0,
                it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        val degraded = state.degradedReason
        val count = state.packages.size
        val scheduled = state.sources.contains("schedule")
        val scheduleName = state.scheduleNames.firstOrNull()

        val dailyOnly = state.sources == listOf("daily_usage")
        val watchingOnly = !state.active && DailyLimitStore.hasEnabledLimits(this)

        val title = when {
            degraded != null -> "Lock is not being enforced"
            watchingOnly -> "Watching daily limits"
            dailyOnly -> "Daily limit reached"
            scheduled && scheduleName != null -> "Scheduled lock: $scheduleName"
            scheduled -> "Scheduled lock active"
            else -> "Lock active"
        }
        val text = degraded
            ?: when {
                watchingOnly -> "Tracking your app usage against today's limits."
                dailyOnly -> "Locked until tomorrow."
                else -> "Blocking $count app${if (count == 1) "" else "s"} until the timer ends."
            }

        builder
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setSmallIcon(applicationInfo.icon)
            .setOngoing(true)
            .also { b -> contentIntent?.let { b.setContentIntent(it) } }

        // A live countdown in the shade, for free, with no extra timer of ours.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N &&
            degraded == null &&
            !watchingOnly &&
            !dailyOnly
        ) {
            builder
                .setWhen(state.endWallMs)
                .setUsesChronometer(true)
                .setChronometerCountDown(true)
        }

        return builder.build()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            "Active lock",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Shown while an app lock session is running."
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }
}
