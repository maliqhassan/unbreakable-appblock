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
  /** Today, hour by hour. 24 entries, midnight first. */
  hourly: HourBucket[];
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

export const EMPTY_REPORT: ScreenTimeReport = {
  available: false,
  days: [],
  apps: [],
  hourly: [],
};

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

/** One category's slice of a single hour. */
export interface HourSegment {
  category: CategoryId;
  seconds: number;
}

/** One hour of the day, and what filled it. */
export interface HourBucket {
  /** 0..23, local time. */
  hour: number;
  /** Largest first, so a stacked bar reads big-to-small from the base. */
  segments: HourSegment[];
  total: number;
}

/**
 * Turns the raw hourly payload into buckets the chart can draw.
 *
 * Always returns 24 entries. An hour with nothing in it is a real answer —
 * either you were not on your phone, or it has not happened yet — so it is a
 * bucket with a zero total rather than a gap in the array.
 */
export function toHourBuckets(raw: RawHour[] | undefined): HourBucket[] {
  return Array.from({ length: 24 }, (_, hour) => {
    const segments = (raw?.[hour] ?? [])
      .map((segment) => ({
        category: categoryFor(segment.category).id,
        seconds: Math.max(0, segment.seconds),
      }))
      .filter((segment) => segment.seconds > 0)
      .sort((a, b) => b.seconds - a.seconds);

    return {
      hour,
      segments,
      total: segments.reduce((sum, segment) => sum + segment.seconds, 0),
    };
  });
}

type RawHour = { category: string; seconds: number }[];

/**
 * The y-axis ceiling, rounded up to a figure a person would choose.
 *
 * A chart scaled to the exact maximum puts the tallest bar flush against the
 * top and gives the axis labels arbitrary values like "37m". Rounding up to the
 * next familiar step keeps the gridlines meaningful and leaves the peak room to
 * read as a peak.
 */
export function hourlyCeiling(buckets: HourBucket[]): number {
  const peak = Math.max(0, ...buckets.map((bucket) => bucket.total));
  if (peak <= 0) return 15 * 60;

  const steps = [15, 30, 45, 60].map((m) => m * 60);
  for (const step of steps) if (peak <= step) return step;

  // Past an hour, round up to the next whole hour.
  return Math.ceil(peak / 3600) * 3600;
}

/**
 * The axis labels down the right of the chart: ceiling, half, zero.
 *
 * Three is the most a chart this small can carry without the labels becoming
 * the loudest thing in it.
 */
export function hourlyAxis(ceiling: number): string[] {
  return [formatDuration(ceiling), formatDuration(Math.round(ceiling / 2)), '0'];
}

/** Clock labels under the chart, at the quarter marks. */
export const HOUR_AXIS_LABELS = ['12 AM', '6 AM', '12 PM', '6 PM'] as const;

/** The hour with the most usage, for the "your peak was at…" line. */
export function busiestHour(buckets: HourBucket[]): HourBucket | null {
  let best: HourBucket | null = null;
  for (const bucket of buckets) {
    if (bucket.total > 0 && (best == null || bucket.total > best.total)) best = bucket;
  }
  return best;
}

/** "9 AM", "11 PM" — the same clock vocabulary as the axis. */
export function formatHour(hour: number): string {
  const normalised = ((hour % 24) + 24) % 24;
  const suffix = normalised < 12 ? 'AM' : 'PM';
  const twelve = normalised % 12 === 0 ? 12 : normalised % 12;
  return `${twelve} ${suffix}`;
}
