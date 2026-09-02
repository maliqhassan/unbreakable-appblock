import Svg, { Path } from 'react-native-svg';

import { LOGO_PATHS, LOGO_STROKE_WIDTH, LOGO_VIEW_BOX } from '../constants/logo';

interface Props {
  size?: number;
  /** Defaults to the current accent. Pass a colour to override. */
  color: string;
  /** Thinner strokes read better at very small sizes. */
  strokeWidth?: number;
}

/**
 * The app mark: two interlocking rings.
 *
 * Drawn from the same geometry as the launcher icon
 * (see `src/constants/logo.ts`), so the logo in the app and the logo on the
 * home screen are the same shape rather than two drawings that drifted apart.
 *
 * Vector rather than a bundled PNG, so it stays sharp at any size and takes
 * its colour from the theme instead of needing one asset per tint.
 */
export function Logo({ size = 64, color, strokeWidth = LOGO_STROKE_WIDTH }: Props) {
  return (
    <Svg width={size} height={size} viewBox={LOGO_VIEW_BOX}>
      {LOGO_PATHS.map((d) => (
        <Path
          key={d}
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="butt"
        />
      ))}
    </Svg>
  );
}
