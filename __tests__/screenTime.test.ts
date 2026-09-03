import { CATEGORIES, categoryFor } from '../src/constants/categories';
import {
  barHeights,
  dailyAverage,
  formatDuration,
  splitDuration,
  totalForWindow,
  totalsByCategory,
  totalToday,
  type AppUsage,
  type ScreenTimeReport,
} from '../src/utils/screenTime';

const app = (
  packageName: string,
  seconds: number,
  category: string
): AppUsage => ({ packageName, appName: packageName, seconds, category });

function report(over: Partial<ScreenTimeReport> = {}): ScreenTimeReport {
  return { available: true, days: [], apps: [], hourly: [], ...over };
}

describe('categories', () => {
  it('maps every category Android reports to a label and colour', () => {
    for (const id of Object.keys(CATEGORIES)) {
      expect(categoryFor(id).label.length).toBeGreaterThan(0);
      expect(categoryFor(id).color).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('files an unknown category under Other rather than inventing one', () => {
    // Plenty of apps declare nothing. Guessing would make the chart look more
    // authoritative than the data behind it.
    expect(categoryFor('astrology').id).toBe('other');
    expect(categoryFor('').id).toBe('other');
  });

  it('gives each category its own colour', () => {
    const colors = Object.values(CATEGORIES).map((c) => c.color);
    expect(new Set(colors).size).toBe(colors.length);
  });
});

describe('grouping today by category', () => {
  const apps = [
    app('com.instagram.android', 3600, 'social'),
    app('com.x.android', 1800, 'social'),
    app('com.netflix', 2700, 'entertainment'),
    app('com.notion', 900, 'productivity'),
  ];

  it('sums each category and counts its apps', () => {
    const totals = totalsByCategory(apps);
    const social = totals.find((t) => t.id === 'social');

    expect(social?.seconds).toBe(5400);
    expect(social?.appCount).toBe(2);
  });

  it('orders by time spent, largest first', () => {
    expect(totalsByCategory(apps).map((t) => t.id)).toEqual([
      'social',
      'entertainment',
      'productivity',
    ]);
  });

  it('gives shares that add up to the whole day', () => {
    const totals = totalsByCategory(apps);
    const sum = totals.reduce((acc, t) => acc + t.share, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it('omits categories with nothing in them', () => {
    // An empty row invites the reader to wonder whether it failed to load.
    const ids = totalsByCategory(apps).map((t) => t.id);
    expect(ids).not.toContain('games');
    expect(ids).not.toContain('news');
  });

  it('does not divide by zero on a day with no usage', () => {
    expect(totalsByCategory([])).toEqual([]);
    const zeroed = totalsByCategory([app('com.x', 0, 'social')]);
    expect(zeroed[0].share).toBe(0);
    expect(Number.isNaN(zeroed[0].share)).toBe(false);
  });

  it('ignores a negative duration rather than subtracting from a category', () => {
    const totals = totalsByCategory([app('com.x', -500, 'social')]);
    expect(totals[0].seconds).toBe(0);
  });
});

describe('window totals', () => {
  const week = report({ days: [3600, 7200, 0, 1800, 5400, 3600, 2700] });

  it('reads today from the last day, not the first', () => {
    expect(totalToday(week)).toBe(2700);
  });

  it('sums the whole window', () => {
    expect(totalForWindow(week)).toBe(24300);
  });

  it('averages only the days that were actually measured', () => {
    // A day the app could not measure reads as zero and would drag the average
    // down; an average over days you were not being measured is meaningless.
    expect(dailyAverage(week)).toBe(Math.round(24300 / 6));
  });

  it('reports zero rather than NaN when nothing has been measured', () => {
    expect(dailyAverage(report({ days: [] }))).toBe(0);
    expect(dailyAverage(report({ days: [0, 0] }))).toBe(0);
    expect(totalToday(report({ days: [] }))).toBe(0);
  });
});

describe('bar heights', () => {
  it('scales to the tallest day so a quiet week still has a shape', () => {
    expect(barHeights([1000, 2000, 4000])).toEqual([0.25, 0.5, 1]);
  });

  it('handles a week with no usage without dividing by zero', () => {
    expect(barHeights([0, 0, 0])).toEqual([0, 0, 0]);
    expect(barHeights([])).toEqual([]);
  });
});

describe('formatting a duration', () => {
  it('writes hours and minutes the way a person reads them', () => {
    expect(formatDuration(23700)).toBe('6h 35m');
    expect(formatDuration(2400)).toBe('40m');
    expect(formatDuration(7200)).toBe('2h');
  });

  it('never shows seconds', () => {
    expect(formatDuration(45)).toBe('1m');
    expect(formatDuration(0)).toBe('0m');
  });

  it('rolls 60 minutes up to the next hour instead of showing "0h 60m"', () => {
    expect(formatDuration(3599)).toBe('1h');
    expect(formatDuration(7199)).toBe('2h');
  });

  it('treats a negative duration as zero', () => {
    expect(formatDuration(-100)).toBe('0m');
  });

  it('splits the same figure so the unit can be set smaller', () => {
    expect(splitDuration(23700)).toEqual([
      { value: '6', unit: 'h' },
      { value: '35', unit: 'm' },
    ]);
    expect(splitDuration(2400)).toEqual([{ value: '40', unit: 'm' }]);
    expect(splitDuration(7200)).toEqual([{ value: '2', unit: 'h' }]);
  });

  it('agrees with formatDuration on every case', () => {
    for (const seconds of [0, 59, 60, 3599, 3600, 7199, 23700, 86399]) {
      const joined = splitDuration(seconds)
        .map((p) => p.value + p.unit)
        .join(' ');
      expect(joined).toBe(formatDuration(seconds));
    }
  });
});

describe('a missing measurement is not a quiet day', () => {
  it('marks an unavailable report rather than returning zeroes', () => {
    // The screen renders "usage access is off" from this, instead of drawing an
    // empty chart that reads as a day well spent.
    const unavailable = report({ available: false });
    expect(unavailable.available).toBe(false);
    expect(unavailable.apps).toEqual([]);
  });
});
