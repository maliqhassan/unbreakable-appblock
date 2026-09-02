import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { remainingFrom, type RemainingParts } from '../utils/time';

/**
 * Countdown to an absolute timestamp.
 *
 * The interval only decides *when to re-render*. Every value is recomputed from
 * `endTimestamp - Date.now()`, so a throttled or suspended timer shows a jump,
 * never a wrong total. Returning from the background recalculates immediately
 * rather than resuming from a stale count.
 *
 * @param endTimestamp epoch ms, or null to stop.
 * @param onExpire fired once, when the remaining time first reaches zero.
 */
export function useCountdown(
  endTimestamp: number | null,
  onExpire?: () => void
): RemainingParts {
  const [remaining, setRemaining] = useState<RemainingParts>(() =>
    remainingFrom(endTimestamp ?? 0)
  );

  // Kept in a ref so a caller passing an inline arrow doesn't restart the timer
  // on every render. Assigned in an effect, never during render.
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
    if (endTimestamp == null) return;

    const evaluate = () => {
      const next = remainingFrom(endTimestamp);
      setRemaining(next);
      if (next.expired && !firedRef.current) {
        firedRef.current = true;
        onExpireRef.current?.();
      }
    };

    evaluate();
    const interval = setInterval(evaluate, 1000);

    const onAppStateChange = (state: AppStateStatus) => {
      if (state === 'active') evaluate();
    };
    const subscription = AppState.addEventListener('change', onAppStateChange);

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [endTimestamp]);

  return remaining;
}
