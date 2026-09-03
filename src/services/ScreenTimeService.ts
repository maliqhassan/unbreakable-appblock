import UnbreakableLock from '../../modules/unbreakable-lock';
import { EMPTY_REPORT, toHourBuckets, type ScreenTimeReport } from '../utils/screenTime';
import { log } from '../utils/logger';

/**
 * Screen time, read from the OS.
 *
 * Reporting only — nothing here enforces anything, and nothing here is written
 * anywhere. The figures are read from Android on demand and thrown away when
 * the screen closes; there is no store, no cache and no upload, which is what
 * lets the privacy policy say usage data never leaves the device.
 */

interface NativeApi {
  getScreenTimeReport: (days: number) => Promise<string>;
}

function api(): NativeApi | null {
  const native = UnbreakableLock as unknown as Partial<NativeApi>;
  if (typeof native?.getScreenTimeReport !== 'function') return null;
  return native as NativeApi;
}

export const ScreenTimeService = {
  /** True when this build can report screen time at all. */
  isSupported(): boolean {
    return api() !== null;
  },

  /**
   * @param days how far back to read, including today.
   * @returns a report whose `available` flag is false when usage access is
   *   missing. That is deliberately not an exception: a missing permission is
   *   a state the screen renders, not an error it has to catch.
   */
  async getReport(days = 7): Promise<ScreenTimeReport> {
    const native = api();
    if (!native) return EMPTY_REPORT;

    try {
      const parsed = JSON.parse(await native.getScreenTimeReport(days)) as ScreenTimeReport;
      return {
        available: parsed.available === true,
        days: Array.isArray(parsed.days) ? parsed.days : [],
        apps: Array.isArray(parsed.apps) ? parsed.apps : [],
        // Always 24 buckets, whatever native sent — the chart should never have
        // to reason about a short array.
        hourly: toHourBuckets(
          (parsed as unknown as { hourly?: { category: string; seconds: number }[][] }).hourly
        ),
      };
    } catch (err) {
      log.warn('ScreenTime', 'Could not read the usage report', err);
      return EMPTY_REPORT;
    }
  },
};
