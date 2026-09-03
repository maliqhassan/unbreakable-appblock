import { categoryFor, type CategoryId } from '../constants/categories';

/**
 * Turning Android's raw usage into the numbers the screens show.
 *
 * Pure functions, so the arithmetic that produces every figure on the Insights
 * screen is testable without a device. Nothing here talks to native.
 */

export interface AppUsage {
  packageName: string;
  appName: string;
  seconds: number;
  category: string;
}

export interface ScreenTimeReport {
  /** False when usage access is missing — never drawn as an empty chart. */
  available: boolean;
  /** Per-day totals in seconds, oldest first, today last. */
  days: number[];
  /** Today's apps. */
  apps: AppUsage[];
}

export interface CategoryTotal {
  id: CategoryId;
  label: string;
  color: string;
  seconds: number;
  /** 0..1 of the day's total. */
  share: number;
  appCount: number;
}

export const EMPTY_REPORT: ScreenTimeReport = { available: false, days: [], apps: [] };

/**
 * Groups today's apps into categories, largest first.
 *
 * Categories with nothing in them are omitted rather than listed as zero: an
 * empty row invites the reader to wonder whether it failed to load.
 */
export function totalsByCategory(apps: AppUsage[]): CategoryTotal[] {
  const buckets = new Map<CategoryId, { seconds: number; appCount: number }>();

  for (const app of apps) {
    const { id } = categoryFor(app.category);
    const current = buckets.get(id) ?? { seconds: 0, appCount: 0 };
    buckets.set(id, {
      seconds: current.seconds + Math.max(0, app.seconds),
      appCount: current.appCount + 1,
    });
  }

  const total = [...buckets.values()].reduce((sum, b) => sum + b.seconds, 0);

  return [...buckets.entries()]
    .map(([id, bucket]) => {
      const category = categoryFor(id);
      return {
        id,
        label: category.label,
        color: category.color,
        seconds: bucket.seconds,
        // Guard the divide: a day with no usage has no shares, not NaN ones.
        share: total > 0 ? bucket.seconds / total : 0,
        appCount: bucket.appCount,
      };
    })
    .sort((a, b) => b.seconds - a.seconds);
}

/** Today's total, in seconds. */
export function totalToday(report: ScreenTimeReport): number {
  return report.days.length > 0 ? report.days[report.days.length - 1] : 0;
}

/** The whole window, in seconds. */
export function totalForWindow(report: ScreenTimeReport): number {
  return report.days.reduce((sum, day) => sum + day, 0);
}

/**
 * The daily average across the window.
 *
 * Days before the app could measure anything read as zero and would drag the
 * average down, so only days with usage are counted. An average over days you
 * were not being measured is not an average of anything.
 */
export function dailyAverage(report: ScreenTimeReport): number {
  const measured = report.days.filter((seconds) => seconds > 0);
  if (measured.length === 0) return 0;
  return Math.round(measured.reduce((sum, day) => sum + day, 0) / measured.length);
}

/**
 * Bar heights for the trend chart, as 0..1 of the tallest day.
 *
 * Scaled to the window's own maximum rather than to a fixed ceiling, so the
 * shape of a quiet week is still readable.
 */
export function barHeights(days: number[]): number[] {
  const max = Math.max(...days, 0);
  if (max <= 0) return days.map(() => 0);
  return days.map((seconds) => seconds / max);
}

/**
 * "6h 35m", "40m", "0m".
 *
 * Seconds are never shown: nobody makes a decision about their week on the
 * strength of forty seconds, and the extra digits make the number harder to
 * read at a glance.
 */
export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.round((safe % 3600) / 60);

  // 59m30s rounding to 60m should read as 1h, not "0h 60m".
  if (minutes === 60) return `${hours + 1}h`;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/** The same figure split so the unit can be set smaller than the number. */
export function splitDuration(seconds: number): { value: string; unit: string }[] {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.round((safe % 3600) / 60);

  if (minutes === 60) return [{ value: String(hours + 1), unit: 'h' }];
  if (hours === 0) return [{ value: String(minutes), unit: 'm' }];
  if (minutes === 0) return [{ value: String(hours), unit: 'h' }];
  return [
    { value: String(hours), unit: 'h' },
    { value: String(minutes), unit: 'm' },
  ];
}

/** Weekday initials for the chart, oldest first, ending today. */
export function dayLabels(days: number, today: Date = new Date()): string[] {
  const letters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const out: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - offset);
    out.push(letters[date.getDay()]);
  }
  return out;
}
