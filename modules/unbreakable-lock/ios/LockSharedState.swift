import Foundation
import FamilyControls
import ManagedSettings

/**
 Shared state between the app and its DeviceActivityMonitor extension.

 The extension runs in a separate process, so anything both sides need lives in
 an App Group. `LOCK_APP_GROUP` must match the App Group id configured in
 `app.json` (see `plugins/withUnbreakableLock.js`) and added to BOTH targets in
 the Apple Developer portal.
 */
public enum LockSharedState {
  /// Keep in sync with `IOS_APP_GROUP` in src/constants/native.ts.
  public static let appGroup = "group.com.unbreakablelock.app"

  /// A named store so the extension can clear the very shield the app applied.
  public static let storeName = ManagedSettingsStore.Name("unbreakableLock")

  public static let activityName = "UnbreakableLockSession"

  private static let keySelection = "family_activity_selection"
  private static let keyEndTimestamp = "lock_end_timestamp"
  private static let keyStrictMode = "lock_strict_mode"
  private static let keyActive = "lock_active"

  public static var defaults: UserDefaults {
    // A missing/misconfigured App Group would silently drop state, so fall back
    // to standard defaults: the app still works, only the extension loses sight
    // of the session (and the app clears the shield itself on next launch).
    UserDefaults(suiteName: appGroup) ?? .standard
  }

  public static var store: ManagedSettingsStore {
    ManagedSettingsStore(named: storeName)
  }

  // MARK: - Selection

  public static func saveSelection(_ selection: FamilyActivitySelection) {
    guard let data = try? JSONEncoder().encode(selection) else { return }
    defaults.set(data, forKey: keySelection)
  }

  public static func loadSelection() -> FamilyActivitySelection {
    guard
      let data = defaults.data(forKey: keySelection),
      let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
    else {
      return FamilyActivitySelection()
    }
    return selection
  }

  public static func clearSelection() {
    defaults.removeObject(forKey: keySelection)
  }

  // MARK: - Session

  public static func saveSession(endTimestamp: Double, strictMode: Bool) {
    let d = defaults
    d.set(true, forKey: keyActive)
    d.set(endTimestamp, forKey: keyEndTimestamp)
    d.set(strictMode, forKey: keyStrictMode)
  }

  public static func clearSession() {
    let d = defaults
    d.set(false, forKey: keyActive)
    d.removeObject(forKey: keyEndTimestamp)
    d.removeObject(forKey: keyStrictMode)
  }

  public static var isActive: Bool { defaults.bool(forKey: keyActive) }
  public static var endTimestamp: Double { defaults.double(forKey: keyEndTimestamp) }
  public static var strictMode: Bool { defaults.bool(forKey: keyStrictMode) }

  /// Epoch milliseconds, matching the JS side.
  public static var isExpired: Bool {
    endTimestamp <= Date().timeIntervalSince1970 * 1000
  }

  // MARK: - Shield

  /// Applies the shield for the saved selection. Safe to call repeatedly.
  public static func applyShield() {
    let selection = loadSelection()
    let s = store
    s.shield.applications = selection.applicationTokens.isEmpty
      ? nil : selection.applicationTokens
    s.shield.applicationCategories = selection.categoryTokens.isEmpty
      ? nil : .specific(selection.categoryTokens)
    s.shield.webDomains = selection.webDomainTokens.isEmpty
      ? nil : selection.webDomainTokens
  }

  /// Removes every restriction this app applied. Never touches other stores.
  public static func removeShield() {
    let s = store
    s.shield.applications = nil
    s.shield.applicationCategories = nil
    s.shield.webDomains = nil
    s.clearAllSettings()
  }
}
