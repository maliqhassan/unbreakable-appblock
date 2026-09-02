/**
 * Time helpers.
 *
 * Everything derives from absolute epoch timestamps. There is deliberately no
 * "seconds elapsed" counter anywhere in this app: a JS interval that is paused,
 * throttled or killed would silently under-count and end a lock early.
 */

export interface RemainingParts {
  totalMs: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
}

export function remainingFrom(endTimestamp: number, now: number = Date.now()): RemainingParts {
  const totalMs = Math.max(0, endTimestamp - now);
  const totalSeconds = Math.floor(totalMs / 1000);
  return {
    totalMs,
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    expired: totalMs <= 0,
  };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "02:37:41" — always HH:MM:SS so the digits don't reflow every hour. */
export function formatCountdown(endTimestamp: number, now: number = Date.now()): string {
  const { hours, minutes, seconds } = remainingFrom(endTimestamp, now);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** "6:30 PM" in the device's locale. */
export function formatClockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "1h 30m", "45m". Used for duration labels, never for countdowns. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function minutesToMs(minutes: number): number {
  return minutes * 60 * 1000;
}

/** RN has no crypto.randomUUID on all platforms; this is unique enough for local ids. */
export function createId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
