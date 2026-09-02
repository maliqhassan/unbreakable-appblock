import ExpoModulesCore
import Foundation
import FamilyControls
import ManagedSettings
import DeviceActivity

/// Mirrors the shared LockErrorCode union so JS sees identical codes on both platforms.
internal final class LockException: Exception {
  private let message: String

  init(_ code: String, _ message: String) {
    self.message = message
    // ExpoModulesCore carries `code` straight through to the JS rejection, so
    // the Kotlin and Swift modules reject with the same strings.
    super.init(name: "LockException", description: message, code: code)
  }

  override var reason: String { message }
}

/**
 The iOS half of the JS contract in `modules/unbreakable-lock/src/types.ts`.

 Built entirely on Apple's public Screen Time APIs:
   - FamilyControls  -- authorization and the app/category picker
   - ManagedSettings -- the shield that actually blocks the chosen apps
   - DeviceActivity  -- the scheduled end of the session

 Requires the `com.apple.developer.family-controls` entitlement, which Apple
 grants per-app on request. Without it, authorization fails at runtime and this
 module reports ENTITLEMENT_UNAVAILABLE instead of pretending to be locked.
 */
public class UnbreakableLockModule: Module {

  public func definition() -> ModuleDefinition {
    Name("UnbreakableLockModule")

    Function("getCapabilities") { () -> [String: Any] in
      let supported = self.isSupportedOS()
      return [
        // ManagedSettings shields the app before it draws -- stronger than the
        // Android approach, which can only interrupt after launch.
        "canShieldApps": supported,
        // Apple gives us no foreground-app observation for third-party apps.
        "canMonitorUsage": false,
        "canPreventUninstall": false,
        "canRestrictSettings": false,
        "canBlockEarlyExit": supported,
        // The shield lives in the OS, not in our process.
        "survivesAppKill": supported,
        "survivesReboot": supported
      ]
    }

    AsyncFunction("getInstalledApps") { () -> [[String: Any]] in
      throw LockException(
        "UNSUPPORTED_PLATFORM",
        "iOS never exposes the installed app list. Use presentAppPicker instead."
      )
    }

    Function("isPermissionGranted") { (permission: String) -> Bool in
      guard permission == "familyControls" else { return false }
      guard #available(iOS 16.0, *) else { return false }
      return AuthorizationCenter.shared.authorizationStatus == .approved
    }

    AsyncFunction("requestPermission") { (permission: String) -> Bool in
      guard permission == "familyControls" else {
        throw LockException("INVALID_CONFIGURATION", "Unknown permission: \(permission)")
      }
      return try await self.authorize()
    }

    AsyncFunction("requestAuthorization") { () -> Bool in
      try await self.authorize()
    }

    AsyncFunction("presentAppPicker") { () -> [String: Any] in
      guard #available(iOS 16.0, *) else {
        throw LockException("UNSUPPORTED_OS_VERSION", "Screen Time controls require iOS 16.")
      }
      guard AuthorizationCenter.shared.authorizationStatus == .approved else {
        throw LockException(
          "AUTHORIZATION_DENIED",
          "Screen Time access must be approved before choosing apps."
        )
      }

      let selection: FamilyActivitySelection = try await withCheckedThrowingContinuation { cont in
        FamilyPickerPresenter.present { result in
          switch result {
          case .success(let selection): cont.resume(returning: selection)
          case .failure: cont.resume(
            throwing: LockException("UNKNOWN", "The app picker could not be presented.")
          )
          }
        }
      }

      LockSharedState.saveSelection(selection)

      // If a lock is already running, honour the new selection immediately.
      if LockSharedState.isActive && !LockSharedState.isExpired {
        LockSharedState.applyShield()
      }

      return self.summarize(selection)
    }

    AsyncFunction("getSelectedApplications") { () -> [String: Any] in
      guard #available(iOS 16.0, *) else {
        throw LockException("UNSUPPORTED_OS_VERSION", "Screen Time controls require iOS 16.")
      }
      return self.summarize(LockSharedState.loadSelection())
    }

    AsyncFunction("startLock") { (ids: [String], endTimestamp: Double, strictMode: Bool) -> [String: Any] in
      guard #available(iOS 16.0, *) else {
        throw LockException("UNSUPPORTED_OS_VERSION", "Screen Time controls require iOS 16.")
      }
      guard AuthorizationCenter.shared.authorizationStatus == .approved else {
        throw LockException(
          "AUTHORIZATION_DENIED",
          "Screen Time access must be approved before starting a lock."
        )
      }

      let selection = LockSharedState.loadSelection()
      let isEmpty = selection.applicationTokens.isEmpty
        && selection.categoryTokens.isEmpty
        && selection.webDomainTokens.isEmpty
      if isEmpty {
        throw LockException("NO_SELECTION", "Choose at least one app or category first.")
      }

      let now = Date().timeIntervalSince1970 * 1000
      if endTimestamp <= now {
        throw LockException("INVALID_CONFIGURATION", "The end time is already in the past.")
      }

      if LockSharedState.isActive && !LockSharedState.isExpired {
        throw LockException("ALREADY_ACTIVE", "A lock is already running.")
      }

      LockSharedState.saveSession(endTimestamp: endTimestamp, strictMode: strictMode)
      LockSharedState.applyShield()
      self.startMonitoring(endTimestamp: endTimestamp)

      return self.statusPayload()
    }

    AsyncFunction("stopLock") { (force: Bool) -> [String: Any] in
      guard LockSharedState.isActive else {
        throw LockException("NOT_ACTIVE", "No lock is currently running.")
      }
      if LockSharedState.strictMode && !LockSharedState.isExpired && !force {
        throw LockException(
          "STRICT_MODE_ACTIVE",
          "Strict Mode is on. This lock cannot be ended before it expires."
        )
      }

      self.stopMonitoring()
      LockSharedState.removeShield()
      LockSharedState.clearSession()

      return self.statusPayload()
    }

    AsyncFunction("getLockStatus") { () -> [String: Any] in
      // The DeviceActivity extension normally lifts the shield at the interval
      // end. This is the belt-and-braces path for when the extension is missing
      // or was not scheduled: whoever notices expiry first cleans up.
      if LockSharedState.isActive && LockSharedState.isExpired {
        self.stopMonitoring()
        LockSharedState.removeShield()
        LockSharedState.clearSession()
      }
      return self.statusPayload()
    }
  }

  // MARK: - Helpers

  private func isSupportedOS() -> Bool {
    if #available(iOS 16.0, *) { return true }
    return false
  }

  private func authorize() async throws -> Bool {
    guard #available(iOS 16.0, *) else {
      throw LockException("UNSUPPORTED_OS_VERSION", "Screen Time controls require iOS 16.")
    }
    do {
      try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
      return AuthorizationCenter.shared.authorizationStatus == .approved
    } catch {
      // Two very different failures land here: the user declined the prompt, or
      // the build has no Family Controls entitlement (so the framework refuses
      // outright). Only the framework's own errors can be the latter.
      //
      // We match on the bridged error domain rather than a specific enum case:
      // the case list is not API-stable enough to switch on safely, and getting
      // this wrong would mean telling a user their setup is broken when they
      // simply tapped "Don't Allow".
      let ns = error as NSError
      if ns.domain.contains("FamilyControls") {
        throw LockException(
          "ENTITLEMENT_UNAVAILABLE",
          "Screen Time is unavailable for this build. Check that the Family Controls "
            + "entitlement is enabled for this App ID. (\(error.localizedDescription))"
        )
      }
      throw LockException(
        "AUTHORIZATION_DENIED",
        "Screen Time access was not granted: \(error.localizedDescription)"
      )
    }
  }

  @available(iOS 16.0, *)
  private func summarize(_ selection: FamilyActivitySelection) -> [String: Any] {
    [
      "applicationCount": selection.applicationTokens.count,
      "categoryCount": selection.categoryTokens.count,
      "webDomainCount": selection.webDomainTokens.count
    ]
  }

  /**
   Schedules the end of the session with DeviceActivity.

   DeviceActivitySchedule works in wall-clock DateComponents, not absolute
   dates, so a session is expressed as "now until the end time". Sessions longer
   than 24 hours are clamped to just under a day -- the free/Pro limits keep us
   inside that anyway.
   */
  private func startMonitoring(endTimestamp: Double) {
    guard #available(iOS 16.0, *) else { return }

    let calendar = Calendar.current
    let start = Date()
    let maxEnd = start.addingTimeInterval(23 * 60 * 60 + 55 * 60)
    let end = min(Date(timeIntervalSince1970: endTimestamp / 1000), maxEnd)

    let schedule = DeviceActivitySchedule(
      intervalStart: calendar.dateComponents([.hour, .minute, .second], from: start),
      intervalEnd: calendar.dateComponents([.hour, .minute, .second], from: end),
      repeats: false
    )

    let center = DeviceActivityCenter()
    let name = DeviceActivityName(LockSharedState.activityName)
    center.stopMonitoring([name])

    do {
      try center.startMonitoring(name, during: schedule)
    } catch {
      // Monitoring failing is not fatal: the shield is already applied, and
      // getLockStatus() lifts it once the end timestamp passes. We log rather
      // than throw so the user still gets their lock.
      NSLog("[UnbreakableLock] DeviceActivity monitoring failed: \(error)")
    }
  }

  private func stopMonitoring() {
    guard #available(iOS 16.0, *) else { return }
    DeviceActivityCenter().stopMonitoring([DeviceActivityName(LockSharedState.activityName)])
  }

  private func statusPayload() -> [String: Any] {
    let active = LockSharedState.isActive && !LockSharedState.isExpired
    var blockedIds: [String] = []
    if #available(iOS 16.0, *) {
      let selection = LockSharedState.loadSelection()
      // Tokens are opaque, so we surface stable placeholder ids only.
      blockedIds = (0..<selection.applicationTokens.count).map { "ios.app.\($0)" }
        + (0..<selection.categoryTokens.count).map { "ios.category.\($0)" }
    }
    return [
      "active": active,
      "endTimestamp": LockSharedState.endTimestamp,
      "strictMode": LockSharedState.strictMode,
      "blockedIds": blockedIds
    ]
  }
}
