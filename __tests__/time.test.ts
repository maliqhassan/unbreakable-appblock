import { formatCountdown, formatDuration, remainingFrom } from '../src/utils/time';

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

describe('countdown calculation', () => {
  const now = 1_700_000_000_000;

  it('breaks the remaining time into hours, minutes and seconds', () => {
    const end = now + 2 * HOUR + 37 * MINUTE + 41 * 1000;
    const remaining = remainingFrom(end, now);

    expect(remaining).toMatchObject({ hours: 2, minutes: 37, seconds: 41, expired: false });
  });

  it('formats as zero-padded HH:MM:SS so the digits never reflow', () => {
    expect(formatCountdown(now + 2 * HOUR + 37 * MINUTE + 41 * 1000, now)).toBe('02:37:41');
    expect(formatCountdown(now + 9 * 1000, now)).toBe('00:00:09');
  });

  it('clamps to zero and reports expiry once the end time has passed', () => {
    const remaining = remainingFrom(now - 5 * MINUTE, now);

    expect(remaining.expired).toBe(true);
    expect(remaining.totalMs).toBe(0);
    expect(formatCountdown(now - 5 * MINUTE, now)).toBe('00:00:00');
  });

  it('treats the exact end instant as expired', () => {
    expect(remainingFrom(now, now).expired).toBe(true);
  });

  it('derives the same value regardless of when it is asked', () => {
    // The point of timestamp arithmetic: a gap in polling cannot lose time.
    const end = now + HOUR;
    expect(remainingFrom(end, now).totalMs).toBe(HOUR);
    expect(remainingFrom(end, now + 30 * MINUTE).totalMs).toBe(30 * MINUTE);
  });

  it('formats durations for labels', () => {
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(90)).toBe('1h 30m');
  });
});
