import {
  busiestHour,
  formatHour,
  hourlyAxis,
  hourlyCeiling,
  toHourBuckets,
} from '../src/utils/screenTime';

/**
 * The arithmetic behind the hourly chart.
 *
 * The chart itself is drawn from these four functions, so pinning them pins the
 * chart without needing a device to render it.
 */

const MIN = 60;

describe('building hour buckets', () => {
  it('always returns a full day, however little native sent', () => {
    // A short array would make every consumer reason about missing hours.
    expect(toHourBuckets([]).length).toBe(24);
    expect(toHourBuckets(undefined).length).toBe(24);
  });

  it('numbers the hours from midnight', () => {
    const buckets = toHourBuckets([]);
    expect(buckets[0].hour).toBe(0);
    expect(buckets[23].hour).toBe(23);
  });

  it('totals the segments in an hour', () => {
    const raw = [[{ category: 'social', seconds: 10 * MIN }, { category: 'news', seconds: 5 * MIN }]];
    expect(toHourBuckets(raw)[0].total).toBe(15 * MIN);
  });

  it('orders segments largest first, so a stack reads big-to-small', () => {
    const raw = [
      [
        { category: 'news', seconds: 2 * MIN },
        { category: 'social', seconds: 9 * MIN },
        { category: 'games', seconds: 5 * MIN },
      ],
    ];
    expect(toHourBuckets(raw)[0].segments.map((s) => s.category)).toEqual([
      'social',
      'games',
      'news',
    ]);
  });

  it('files an unrecognised category under Other rather than dropping the time', () => {
    // Losing the minutes would make the chart disagree with the day's total.
    const buckets = toHourBuckets([[{ category: 'astrology', seconds: 3 * MIN }]]);
    expect(buckets[0].segments[0].category).toBe('other');
    expect(buckets[0].total).toBe(3 * MIN);
  });

  it('drops empty and negative segments', () => {
    const raw = [
      [
        { category: 'social', seconds: 0 },
        { category: 'news', seconds: -60 },
        { category: 'games', seconds: 4 * MIN },
      ],
    ];
    const bucket = toHourBuckets(raw)[0];
    expect(bucket.segments).toHaveLength(1);
    expect(bucket.total).toBe(4 * MIN);
  });

  it('gives an untouched hour a zero total rather than a gap', () => {
    // An hour you did not use your phone, and an hour that has not happened
    // yet, are both genuinely zero. "Could not measure" is a different fact and
    // is carried by the report's `available` flag.
    const buckets = toHourBuckets([[{ category: 'social', seconds: 60 }]]);
    expect(buckets[5].total).toBe(0);
    expect(buckets[5].segments).toEqual([]);
  });
});

describe('the y-axis ceiling', () => {
  const hours = (...totals: number[]) =>
    toHourBuckets(totals.map((seconds) => [{ category: 'social', seconds }]));

  it('rounds up to a figure a person would choose', () => {
    // Not the exact peak: a bar flush with the top of the chart reads as
    // clipped, and "37m" is not a gridline anyone wants.
    expect(hourlyCeiling(hours(10 * MIN))).toBe(15 * MIN);
    expect(hourlyCeiling(hours(22 * MIN))).toBe(30 * MIN);
    expect(hourlyCeiling(hours(37 * MIN))).toBe(45 * MIN);
    expect(hourlyCeiling(hours(50 * MIN))).toBe(60 * MIN);
  });

  it('steps up in whole hours past an hour', () => {
    expect(hourlyCeiling(hours(90 * MIN))).toBe(2 * 3600);
  });

  it('gives an empty day a sane scale instead of zero', () => {
    // A zero ceiling would divide by zero when sizing the bars.
    expect(hourlyCeiling(toHourBuckets([]))).toBe(15 * MIN);
  });

  it('labels the axis from the ceiling down to zero', () => {
    expect(hourlyAxis(30 * MIN)).toEqual(['30m', '15m', '0']);
    expect(hourlyAxis(3600)).toEqual(['1h', '30m', '0']);
  });
});

describe('the busiest hour', () => {
  it('finds the peak', () => {
    const buckets = toHourBuckets([
      [{ category: 'social', seconds: 5 * MIN }],
      [{ category: 'social', seconds: 20 * MIN }],
      [{ category: 'social', seconds: 8 * MIN }],
    ]);
    expect(busiestHour(buckets)?.hour).toBe(1);
  });

  it('reports none for a day with no usage, rather than hour zero', () => {
    // "Your busiest hour was 12 AM — 0m" is worse than saying nothing.
    expect(busiestHour(toHourBuckets([]))).toBeNull();
  });
});

describe('clock labels', () => {
  it('uses the same vocabulary as the axis', () => {
    expect(formatHour(0)).toBe('12 AM');
    expect(formatHour(9)).toBe('9 AM');
    expect(formatHour(12)).toBe('12 PM');
    expect(formatHour(23)).toBe('11 PM');
  });

  it('wraps rather than producing nonsense', () => {
    expect(formatHour(24)).toBe('12 AM');
    expect(formatHour(-1)).toBe('11 PM');
  });
});
