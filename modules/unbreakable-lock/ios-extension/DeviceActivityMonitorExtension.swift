import DeviceActivity
import ManagedSettings
import FamilyControls
import Foundation

/**
 DeviceActivityMonitor extension.

 This file is NOT compiled into the app target. It belongs to a separate
 "Device Activity Monitor Extension" target that must be added in Xcode after
 `npx expo prebuild` -- see the iOS setup section of the README. Expo cannot
 create an extension target for you, and creating one by hand is a one-time,
 five-minute step.

 Its only job: when the scheduled interval ends, lift the shield. That is what
 makes a lock end reliably even if the app was never reopened.

 The extension is also the reason the App Group exists -- it runs in its own
 process and cannot see the app's own UserDefaults.
 */
class DeviceActivityMonitorExtension: DeviceActivityMonitor {

  // Keep these three constants identical to LockSharedState.swift.
  private let appGroup = "group.com.unbreakablelock.app"
  private let storeName = ManagedSettingsStore.Name("unbreakableLock")
  private let keyActive = "lock_active"
  private let keyEndTimestamp = "lock_end_timestamp"
  private let keyStrictMode = "lock_strict_mode"
  private let keySelection = "family_activity_selection"

  private var defaults: UserDefaults {
    UserDefaults(suiteName: appGroup) ?? .standard
  }

  override func intervalDidStart(for activity: DeviceActivityName) {
    super.intervalDidStart(for: activity)
    applyShield()
  }

  override func intervalDidEnd(for activity: DeviceActivityName) {
    super.intervalDidEnd(for: activity)
    endSession()
  }

  override func eventDidReachThreshold(
    _ event: DeviceActivityEvent.Name,
    activity: DeviceActivityName
  ) {
    super.eventDidReachThreshold(event, activity: activity)
  }

  // MARK: - Shield

  private func applyShield() {
    guard
      let data = defaults.data(forKey: keySelection),
      let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
    else { return }

    let store = ManagedSettingsStore(named: storeName)
    store.shield.applications = selection.applicationTokens.isEmpty
      ? nil : selection.applicationTokens
    store.shield.applicationCategories = selection.categoryTokens.isEmpty
      ? nil : .specific(selection.categoryTokens)
    store.shield.webDomains = selection.webDomainTokens.isEmpty
      ? nil : selection.webDomainTokens
  }

  private func endSession() {
    let store = ManagedSettingsStore(named: storeName)
    store.shield.applications = nil
    store.shield.applicationCategories = nil
    store.shield.webDomains = nil
    store.clearAllSettings()

    let d = defaults
    d.set(false, forKey: keyActive)
    d.removeObject(forKey: keyEndTimestamp)
    d.removeObject(forKey: keyStrictMode)
  }
}
