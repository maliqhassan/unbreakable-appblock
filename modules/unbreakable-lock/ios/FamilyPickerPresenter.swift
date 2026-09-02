import Foundation
import SwiftUI
import FamilyControls
import UIKit

/**
 Presents Apple's own FamilyActivityPicker.

 Apple never exposes the list of installed apps to third-party code, and the
 tokens the picker returns are opaque -- we cannot read a bundle id or a name
 out of them. So iOS app selection has to happen in this system UI, and the app
 can only report *how many* things were chosen. That asymmetry with Android is
 modelled explicitly in the JS layer rather than papered over.
 */
@available(iOS 16.0, *)
enum FamilyPickerPresenter {

  static func present(completion: @escaping (Result<FamilyActivitySelection, Error>) -> Void) {
    DispatchQueue.main.async {
      guard let presenter = topViewController() else {
        completion(.failure(LockError.noPresenter))
        return
      }

      var selection = LockSharedState.loadSelection()

      var hosting: UIHostingController<PickerView>?
      let view = PickerView(
        selection: Binding(
          get: { selection },
          set: { selection = $0 }
        ),
        onDone: {
          hosting?.dismiss(animated: true) {
            completion(.success(selection))
          }
        },
        onCancel: {
          hosting?.dismiss(animated: true) {
            // Cancelling keeps whatever was previously saved.
            completion(.success(LockSharedState.loadSelection()))
          }
        }
      )

      let controller = UIHostingController(rootView: view)
      hosting = controller
      controller.modalPresentationStyle = .formSheet
      presenter.present(controller, animated: true)
    }
  }

  private static func topViewController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive }

    guard let window = scene?.windows.first(where: { $0.isKeyWindow }) ?? scene?.windows.first
    else { return nil }

    var top = window.rootViewController
    while let presented = top?.presentedViewController {
      top = presented
    }
    return top
  }

  enum LockError: Error {
    case noPresenter
  }
}

@available(iOS 16.0, *)
private struct PickerView: View {
  @Binding var selection: FamilyActivitySelection
  let onDone: () -> Void
  let onCancel: () -> Void

  var body: some View {
    NavigationView {
      FamilyActivityPicker(selection: $selection)
        .navigationTitle("Choose what to block")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button("Cancel", action: onCancel)
          }
          ToolbarItem(placement: .confirmationAction) {
            Button("Done", action: onDone)
          }
        }
    }
  }
}
