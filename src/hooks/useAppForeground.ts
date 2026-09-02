import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/**
 * Runs a callback each time the app returns to the foreground.
 *
 * Permissions are granted in system Settings, which means the app is
 * backgrounded while it happens — coming back is the only moment we can
 * re-check them.
 */
export function useAppForeground(onForeground: () => void): void {
  const callbackRef = useRef(onForeground);
  useEffect(() => {
    callbackRef.current = onForeground;
  }, [onForeground]);

  useEffect(() => {
    const previous = { state: AppState.currentState };

    const handler = (next: AppStateStatus) => {
      if (previous.state.match(/inactive|background/) && next === 'active') {
        callbackRef.current();
      }
      previous.state = next;
    };

    const subscription = AppState.addEventListener('change', handler);
    return () => subscription.remove();
  }, []);
}
