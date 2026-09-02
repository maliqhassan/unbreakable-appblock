import { sheetPadding } from '../src/components/PermissionExplainer';
import { spacing } from '../src/constants/theme';

/**
 * The app targets SDK 36, where Android forces edge-to-edge: a sheet anchored
 * to the bottom of the screen draws *underneath* the system navigation bar.
 * This is the arithmetic that keeps its buttons tappable.
 */

/** A phone showing the three-button navigation bar. */
const THREE_BUTTON = { bottom: 48, left: 0, right: 0 };
/** Gesture navigation — a slimmer pill, but still not zero. */
const GESTURE_PILL = { bottom: 24, left: 0, right: 0 };
/** Landscape, with the navigation bar moved to one side. */
const LANDSCAPE = { bottom: 0, left: 0, right: 48 };
/** A device reporting nothing to avoid — an old phone, or a tablet. */
const NONE = { bottom: 0, left: 0, right: 0 };

describe('bottom sheets clear the system navigation bar', () => {
  it('pads past the three-button navigation bar', () => {
    // The reported bug: "Not now" rendered under the nav buttons.
    expect(sheetPadding(THREE_BUTTON).paddingBottom).toBeGreaterThan(THREE_BUTTON.bottom);
  });

  it('pads past the gesture pill', () => {
    expect(sheetPadding(GESTURE_PILL).paddingBottom).toBeGreaterThan(GESTURE_PILL.bottom);
  });

  it('leaves the sheet its own breathing room on top of the inset', () => {
    // Padding equal to the inset would leave the button flush against the
    // system bar, which reads as a rendering glitch rather than a layout.
    expect(sheetPadding(THREE_BUTTON).paddingBottom).toBe(spacing.xl + THREE_BUTTON.bottom);
  });

  it('steps around a side navigation bar in landscape', () => {
    const padding = sheetPadding(LANDSCAPE);

    expect(padding.paddingRight).toBe(spacing.xl + LANDSCAPE.right);
    expect(padding.paddingLeft).toBe(spacing.xl);
  });

  it('falls back to the plain design padding when there is no inset', () => {
    const padding = sheetPadding(NONE);

    expect(padding.paddingBottom).toBe(spacing.xl);
    expect(padding.paddingLeft).toBe(spacing.xl);
    expect(padding.paddingRight).toBe(spacing.xl);
  });

  it('ignores a negative inset rather than shrinking the padding', () => {
    // Not expected from the platform, but a negative value here would pull the
    // button *further* under the navigation bar, which is the exact failure
    // this function exists to prevent.
    expect(sheetPadding({ bottom: -20, left: -20, right: -20 })).toEqual({
      paddingBottom: spacing.xl,
      paddingLeft: spacing.xl,
      paddingRight: spacing.xl,
    });
  });

  it('scales with whatever inset the device reports', () => {
    // Some OEM skins report a taller navigation area than stock Android.
    for (const bottom of [0, 16, 24, 48, 72, 96]) {
      expect(sheetPadding({ bottom, left: 0, right: 0 }).paddingBottom).toBe(
        spacing.xl + bottom
      );
    }
  });
});
