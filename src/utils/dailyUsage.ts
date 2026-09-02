import type { DailyUsageLimit, DailyUsageStatus } from '../types';

/**
 * Daily-limit maths.
 *
 * Every function is pure and takes its reference time explicitly, so the whole
 * model is testable without a device or a clock. The Kotlin engine mirrors
 * these rules — see DAILY_LIMITS.md.
 *
 * The central idea: an allowance is **measured, not counted down**. It reflects
 * real foreground time reported by Android, so closing the app, killing the
 * process or rebooting changes nothing — the answer is recomputed from the
 * platform's own record every time.
 */

/** Android usage events, reduced to what the calculation needs. */
export interface ForegroundEvent {
  packageName: string;
  /** Epoch ms. */
  timestamp: number;
  /** True for RESUMED, false for PAUSED/STOPPED. */
  foreground: boolean;
}

export const SECONDS_PER_MINUTE = 60;

/** Sensible ceiling for a custom limit: a full waking day. */
export const MAX_LIMIT_SECONDS = 16 * 60 * 60;
export const MIN_LIMIT_SECONDS = 60;

/** The presets offered when creating a limit. */
export const LIMIT_PRESETS_SECONDS = [
  5 * 60,
  10 * 60,
  15 * 60,
  20 * 60,
  30 * 60,
  45 * 60,
  60 * 60,
  120 * 60,
] as const;

/** Local midnight at the start of the day containing `date`. */
export function startOfLocalDay(date: Date): number {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

/**
 * The next local midnight after `date` — when the allowance resets.
 *
 * Built by incrementing the calendar day rather than adding 24 hours, so
 * daylight-saving transitions still land on midnight.
 */
export function nextLocalMidnight(date: Date): number {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return next.getTime();
}

/**
 * Total foreground seconds for one package, from raw usage events.
 *
 * Pairs each RESUMED with the next PAUSED/STOPPED. Two cases need care:
 *
 *   - **Still open.** An unmatched RESUMED means the app is in the foreground
 *     right now, so it accrues up to `now`. Ignoring it would let someone sit
 *     in an app forever without spending any allowance.
 *   - **Open across midnight.** Events before the window are clipped to its
 *     start, so yesterday evening's session does not spend today's budget.
 *
 * @param events any order; sorted internally.
 * @param windowStart epoch ms, usually local midnight.
 * @param now epoch ms.
 */
export function usageSecondsFromEvents(
  events: ForegroundEvent[],
  packageName: string,
  windowStart: number,
  now: number
): number {
  const relevant = events
    .filter((event) => event.packageName === packageName)
    .sort((a, b) => a.timestamp - b.timestamp);

  let totalMs = 0;
  let openedAt: number | null = null;

  for (const event of relevant) {
    if (event.foreground) {
      // Consecutive RESUMEDs without a PAUSE happen on real devices; keep the
      // earliest so the interval is not silently truncated.
      if (openedAt == null) openedAt = event.timestamp;
      continue;
    }

    if (openedAt != null) {
      const from = Math.max(openedAt, windowStart);
      const to = Math.min(event.timestamp, now);
      if (to > from) totalMs += to - from;
      openedAt = null;
    }
  }

  // Unmatched RESUMED: still in the foreground as of `now`.
  if (openedAt != null) {
    const from = Math.max(openedAt, windowStart);
    if (now > from) totalMs += now - from;
  }

  return Math.floor(totalMs / 1000);
}

/**
 * Where a limit stands right now.
 *
 * @param usageSeconds null when the platform could not be queried. That
 *   propagates rather than becoming zero, because "we do not know" and "you
 *   have used nothing" lead to opposite UI.
 */
export function statusFor(
  limit: DailyUsageLimit,
  usageSeconds: number | null,
  now: Date
): DailyUsageStatus {
  const resetsAt = nextLocalMidnight(now);

  if (usageSeconds == null) {
    return {
      packageName: limit.appPackageName,
      limitSeconds: limit.dailyLimitSeconds,
      usageSeconds: null,
      remainingSeconds: limit.dailyLimitSeconds,
      // Unknown usage must never lock an app: enforcing on a failed read would
      // punish the user for a platform problem.
      exhausted: false,
      resetsAt,
    };
  }

  const remaining = Math.max(0, limit.dailyLimitSeconds - usageSeconds);

  return {
    packageName: limit.appPackageName,
    limitSeconds: limit.dailyLimitSeconds,
    usageSeconds,
    remainingSeconds: remaining,
    // Exactly at the limit counts as exhausted: a 15-minute budget means 15
    // minutes, not 15 minutes and one more second.
    exhausted: limit.enabled && usageSeconds >= limit.dailyLimitSeconds,
    resetsAt,
  };
}

/** Fraction of the allowance consumed, 0–1, for the progress bar. */
export function usageFraction(status: DailyUsageStatus): number {
  if (status.usageSeconds == null || status.limitSeconds <= 0) return 0;
  return Math.min(1, status.usageSeconds / status.limitSeconds);
}

/** The packages whose allowance is spent, and so should be blocked. */
export function exhaustedPackages(statuses: DailyUsageStatus[]): string[] {
  return statuses.filter((status) => status.exhausted).map((status) => status.packageName);
}

/** "15 min", "1 hour", "1h 30m". */
export function formatLimit(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return hours === 1 ? '1 hour' : `${hours} hours`;
  return `${hours}h ${rest}m`;
}

/** "11m remaining", "under a minute", "none left". */
export function formatRemaining(seconds: number): string {
  if (seconds <= 0) return 'none left';
  if (seconds < 60) return 'under a minute';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m remaining`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h remaining` : `${hours}h ${rest}m remaining`;
}

/** "11m / 15m used". */
export function formatUsageSummary(status: DailyUsageStatus): string {
  if (status.usageSeconds == null) return 'Usage unavailable';
  const used = Math.floor(status.usageSeconds / 60);
  const total = Math.round(status.limitSeconds / 60);
  return `${used}m / ${total}m used`;
}

export interface LimitValidation {
  valid: boolean;
  reason?: string;
}

/**
 * Shared by the create screen and the service.
 *
 * @param existing every limit already configured, so a second limit for the
 *   same app is refused rather than creating two competing allowances.
 */
export function validateLimit(
  candidate: Pick<DailyUsageLimit, 'appPackageName' | 'dailyLimitSeconds'>,
  existing: DailyUsageLimit[],
  editingId?: string
): LimitValidation {
  if (!candidate.appPackageName) {
    return { valid: false, reason: 'Choose an app to limit.' };
  }
  if (candidate.dailyLimitSeconds < MIN_LIMIT_SECONDS) {
    return { valid: false, reason: 'The shortest daily limit is 1 minute.' };
  }
  if (candidate.dailyLimitSeconds > MAX_LIMIT_SECONDS) {
    return { valid: false, reason: 'The longest daily limit is 16 hours.' };
  }

  const clash = existing.find(
    (limit) => limit.appPackageName === candidate.appPackageName && limit.id !== editingId
  );
  if (clash) {
    return { valid: false, reason: 'This app already has a daily limit. Edit that one instead.' };
  }

  return { valid: true };
}
