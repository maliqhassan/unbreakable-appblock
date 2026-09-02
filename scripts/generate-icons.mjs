/**
 * Generates every icon asset from one vector definition of the logo.
 *
 * The mark is two interlocking rings — a chain link. It is defined here as
 * geometry rather than shipped as a flat PNG because the app needs several
 * different compositions of it (launcher icon, adaptive foreground with a safe
 * zone, Android 13 monochrome layer, splash, favicon), and each wants a
 * different size, colour and padding. Deriving them all from one source keeps
 * them identical in shape.
 *
 * Run:  node scripts/generate-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

const VIEW = 500;
/** Centre-line radius of each ring. */
const R = 118.5;
/** Width of the drawn band. */
const BAND = 50;
/** Horizontal distance between the two ring centres. */
const GAP = 153;

const CY = 250;
const CXL = 250 - GAP / 2;
const CXR = 250 + GAP / 2;

/**
 * Half-width, in degrees, of the break left in the ring that passes *under*
 * at a crossing. Wide enough to read as a gap at 48px, narrow enough not to
 * look like a broken ring.
 */
const BREAK = 23;

const deg = (radians) => (radians * 180) / Math.PI;
const rad = (degrees) => (degrees * Math.PI) / 180;

const point = (cx, angle) => [
  (cx + R * Math.cos(rad(angle))).toFixed(2),
  (CY + R * Math.sin(rad(angle))).toFixed(2),
];

/**
 * The angle, measured at each ring's centre, of the points where the two
 * centre-lines cross. Derived rather than eyeballed so the gaps sit exactly on
 * the crossings whatever the geometry above is changed to.
 */
const CROSS = deg(Math.acos(GAP / 2 / R));

/** An arc that runs the long way round, leaving a break centred on `at`. */
function ringWithBreak(cx, at) {
  const from = at + BREAK;
  const to = at - BREAK;
  const [x1, y1] = point(cx, from);
  const [x2, y2] = point(cx, to);
  // sweep 1, large-arc 1: the 316° way round, not the 44° way.
  return `M ${x1} ${y1} A ${R} ${R} 0 1 1 ${x2} ${y2}`;
}

/**
 * The mark.
 *
 * The left ring is broken where the right ring crosses above it, and the right
 * ring is broken where the left crosses below. That alternation is what makes
 * the two rings read as linked rather than merely overlapping.
 */
function mark(color) {
  return `
    <g fill="none" stroke="${color}" stroke-width="${BAND}" stroke-linecap="butt">
      <path d="${ringWithBreak(CXL, -CROSS)}" />
      <path d="${ringWithBreak(CXR, 180 - CROSS)}" />
    </g>`;
}

/**
 * @param scale fraction of the canvas the mark occupies. Android's adaptive
 *   icon crops to a circle and animates within its frame, so its foreground
 *   layer needs the mark well inside the 66% safe zone.
 */
function svg({ size, color, background = null, scale = 1 }) {
  const inner = VIEW * scale;
  const offset = (VIEW - inner) / 2;
  const bg = background
    ? `<rect width="${VIEW}" height="${VIEW}" fill="${background}"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${VIEW} ${VIEW}">
  ${bg}
  <g transform="translate(${offset} ${offset}) scale(${scale})">${mark(color)}</g>
</svg>`;
}

/* ------------------------------------------------------------------ *
 * Palette
 * ------------------------------------------------------------------ */

/** Matches the adaptive-icon background already configured in app.config.js. */
const DARK = '#0D0F12';
/** The mark on a dark tile. Near-white rather than pure white: less glare. */
const LIGHT = '#E9ECF1';
/** The supplied logo's own grey, kept for light surfaces. */
const GREY = '#555555';

const OUTPUTS = [
  // Launcher icon: the mark on the app's own dark tile.
  { file: 'icon.png', size: 1024, color: LIGHT, background: DARK, scale: 0.72 },

  // Adaptive icon. Android crops and animates these, so the foreground sits
  // inside the safe zone and the background is a flat colour.
  { file: 'android-icon-foreground.png', size: 1024, color: LIGHT, scale: 0.56 },
  { file: 'android-icon-background.png', size: 1024, color: DARK, background: DARK, scale: 0 },

  // Android 13+ themed icon: a silhouette the system recolours. Must be white
  // on transparent, and is masked the same way as the foreground.
  { file: 'android-icon-monochrome.png', size: 1024, color: '#FFFFFF', scale: 0.56 },

  // Splash: drawn on the splash background colour, so transparent here.
  { file: 'splash-icon.png', size: 512, color: LIGHT, scale: 0.8 },

  // Favicon: light background, so the grey original reads correctly.
  { file: 'favicon.png', size: 96, color: GREY, scale: 0.92 },
];

mkdirSync(ASSETS, { recursive: true });

for (const { file, size, color, background, scale } of OUTPUTS) {
  // scale 0 means "background plate only" — no mark drawn.
  const source = svg({ size, color, background, scale: scale || 0.0001 });
  await sharp(Buffer.from(source)).png().toFile(join(ASSETS, file));
  console.log(`${file.padEnd(32)} ${size}x${size}`);
}

// The in-app <Logo /> draws from these, so the mark on screen can never drift
// from the mark on the launcher icon.
writeFileSync(
  join(ROOT, 'src', 'constants', 'logo.ts'),
  [
    '/**',
    ' * The logo, as vector geometry.',
    ' *',
    ' * GENERATED by scripts/generate-icons.mjs -- do not edit by hand. The same',
    ' * numbers produce the launcher icon, the adaptive and monochrome layers, the',
    ' * splash mark and the in-app <Logo />, so none of them can drift apart.',
    ' */',
    '',
    `export const LOGO_VIEW_BOX = '0 0 ${VIEW} ${VIEW}';`,
    `export const LOGO_STROKE_WIDTH = ${BAND};`,
    '',
    '/** Two arcs: the left ring, then the right, each broken at one crossing. */',
    'export const LOGO_PATHS = [',
    `  '${ringWithBreak(CXL, -CROSS)}',`,
    `  '${ringWithBreak(CXR, 180 - CROSS)}',`,
    '] as const;',
    '',
  ].join('\n')
);
console.log('src/constants/logo.ts         (shared with the in-app logo)');
