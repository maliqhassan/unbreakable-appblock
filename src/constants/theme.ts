import { useColorScheme, type ColorSchemeName } from 'react-native';

/**
 * The design system.
 *
 * Dark-first. A focus app is most often opened at night, at the moment someone
 * is trying to put their phone down, and a bright screen is the wrong thing to
 * hand them. The light palette is kept in step so the app still behaves if the
 * theme is ever set back to `automatic` in app.config.js.
 *
 * The look: deep navy ground, a monochrome accent taken from the logo, large
 * tight-tracked headings,
 * generous whitespace, softly rounded cards. Colour is used sparingly and
 * always means something — accent for action, green for protected, amber for
 * attention, red for broken.
 */
const palette = {
  dark: {
    /** Deep navy rather than pure black: less harsh, and lets surfaces lift. */
    background: '#0A0C12',
    surface: '#141821',
    surfaceMuted: '#1D222D',
    surfaceRaised: '#232937',
    border: '#252B38',
    borderStrong: '#333B4D',
    text: '#F5F7FA',
    textMuted: '#98A2B3',
    // Lightened from #667085, which scored 2.92:1 on surfaceRaised -- below
    // even the large-text threshold, for text that is deliberately small.
    textFaint: '#8892A6',
    /**
     * The brand: the logo's own tone, used for action, selection and progress.
     *
     * Monochrome on purpose. The app now has one place where colour carries
     * meaning — the category chart — and a coloured accent competed with it,
     * because a purple button and a purple category slice look like they are
     * about the same thing. Reserving hue for data makes the chart the only
     * colourful object on screen, which is what makes it read instantly.
     *
     * This is literally #E9ECF1 from scripts/generate-icons.mjs, so the launcher
     * icon and the primary button are the same colour.
     */
    accent: '#E9ECF1',
    accentSoft: 'rgba(233,236,241,0.10)',
    /** The pressed state of a filled accent surface. */
    accentPressed: '#CBD3DE',
    /**
     * Text ON an accent fill.
     *
     * The page's own background, so a primary button reads as the screen
     * inverted rather than as a coloured object. 16.5:1.
     */
    accentText: '#0A0C12',
    /**
     * Accent-coloured TEXT on a dark surface.
     *
     * The same tone as the fill: on a dark ground it is already the most
     * legible thing available, so there is no lighter variant to reach for.
     * Emphasis here comes from weight, not hue.
     */
    accentOnSurface: '#E9ECF1',
    /** A row or chip the user has chosen. Reads as selected without shouting. */
    surfaceSelected: 'rgba(233,236,241,0.12)',
    danger: '#F87171',
    dangerSoft: 'rgba(248,113,113,0.12)',
    success: '#34D399',
    successSoft: 'rgba(52,211,153,0.12)',
    warning: '#FBBF24',
    warningSoft: 'rgba(251,191,36,0.12)',
    overlay: 'rgba(5,7,12,0.72)',
  },
  light: {
    background: '#F5F6F9',
    surface: '#FFFFFF',
    surfaceMuted: '#EDEFF4',
    surfaceRaised: '#FFFFFF',
    border: '#E2E6ED',
    borderStrong: '#CBD2DE',
    text: '#0A0C12',
    textMuted: '#525C6B',
    textFaint: '#5E6878',
    // The mirror of the dark theme: the logo's plate colour, so a primary
    // button is a near-black block on a white ground. 19.2:1.
    accent: '#0D0F12',
    accentSoft: 'rgba(13,15,18,0.06)',
    accentPressed: '#23272E',
    accentText: '#FFFFFF',
    accentOnSurface: '#0D0F12',
    surfaceSelected: 'rgba(13,15,18,0.08)',
    danger: '#DC2626',
    dangerSoft: 'rgba(220,38,38,0.08)',
    success: '#059669',
    successSoft: 'rgba(5,150,105,0.10)',
    warning: '#B45309',
    warningSoft: 'rgba(180,83,9,0.10)',
    overlay: 'rgba(10,12,18,0.5)',
  },
};

export type Colors = typeof palette.dark;

/** A 4pt base scale. `gutter` is the standard screen inset. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  gutter: 20,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/**
 * Big, tightly tracked headings against small quiet body text.
 *
 * The contrast is the point: one thing per screen should be obviously the
 * thing, and everything else should recede.
 */
export const typography = {
  hero: { fontSize: 40, fontWeight: '800' as const, letterSpacing: -1.2, lineHeight: 46 },
  display: { fontSize: 34, fontWeight: '800' as const, letterSpacing: -0.9, lineHeight: 40 },
  title: { fontSize: 26, fontWeight: '700' as const, letterSpacing: -0.6, lineHeight: 32 },
  heading: { fontSize: 19, fontWeight: '700' as const, letterSpacing: -0.3 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 23 },
  label: { fontSize: 15, fontWeight: '600' as const, letterSpacing: -0.1 },
  caption: { fontSize: 13, fontWeight: '400' as const, lineHeight: 19 },
  /** Small-caps section markers, e.g. "PROTECTION". */
  eyebrow: {
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
  },
  /** Countdowns and clock values. */
  mono: { fontSize: 15, fontWeight: '600' as const, fontVariant: ['tabular-nums'] as const },
} as const;

/**
 * Depth is carried by surface colour, not shadow.
 *
 * Shadows read as mud on a dark ground, so cards separate by tone and a hairline
 * border instead. This stays as a token so the light theme can still use it.
 */
export const elevation = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 0,
  },
} as const;

/**
 * Motion.
 *
 * Short enough that nothing waits on an animation. A micro-interaction the user
 * has to sit through is worse than no animation at all, so these are chosen to
 * confirm an action rather than to perform one.
 *
 * Every one of these is skipped when the system reports reduce-motion — see
 * `useReducedMotion` in `src/components/motion.tsx`.
 */
export const motion = {
  /** Press feedback, toggles, chips. Fast enough to feel like the touch itself. */
  fast: 140,
  /** Status changes, expanding sections, progress. */
  base: 220,
  /** Screen entrances and anything crossing a large distance. */
  slow: 320,
  /** How far a press sinks. Small: a button should flex, not shrink. */
  pressScale: 0.97,
  /** How far entering content travels upward. */
  enterOffset: 12,
} as const;

/** Minimum comfortable tap target. */
export const HIT_SIZE = 48;

export function getColors(scheme: ColorSchemeName): Colors {
  // Dark unless the system explicitly asks for light.
  return scheme === 'light' ? palette.light : palette.dark;
}

export function useTheme() {
  const scheme = useColorScheme();
  return {
    colors: getColors(scheme),
    dark: scheme !== 'light',
    spacing,
    radius,
    typography,
    elevation,
    motion,
  };
}
