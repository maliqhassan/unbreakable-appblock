import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  type PressableProps,
  type ViewStyle,
} from 'react-native';

import { motion } from '../constants/theme';

/**
 * Motion primitives.
 *
 * Three of them, deliberately. A design system with a dozen animation helpers
 * ends up with a dozen slightly different animations; these cover press
 * feedback, entrance and value changes, and everything in the app uses them.
 *
 * All of them collapse to "no animation, final state" when the system reports
 * reduce-motion. That is an accessibility setting people turn on because motion
 * makes them ill, so it is honoured rather than softened.
 */

/** True when the user has asked the system to reduce motion. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (!cancelled) setReduced(value);
      })
      .catch(() => {
        // Unknown means animate: the common case is that motion is fine.
      });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (value) => setReduced(value)
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduced;
}

interface FadeInProps {
  children: React.ReactNode;
  /** Stagger a list by passing the row index. */
  index?: number;
  /** Milliseconds between staggered children. */
  stagger?: number;
  style?: ViewStyle;
}

/**
 * Content arriving: a short rise and fade.
 *
 * Staggering by index is what makes a list feel composed rather than dumped on
 * screen, but the total is capped — the eighth row should not wait half a
 * second for its turn.
 */
export function FadeIn({ children, index = 0, stagger = 40, style }: FadeInProps) {
  const reduced = useReducedMotion();
  const progress = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }

    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: motion.slow,
      delay: Math.min(index * stagger, 240),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });

    animation.start();
    return () => animation.stop();
  }, [index, progress, reduced, stagger]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [motion.enterOffset, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

interface PressableScaleProps extends PressableProps {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** Set false for rows where a scale would look wrong, e.g. a full-width list item. */
  scale?: boolean;
}

/**
 * A pressable that acknowledges the touch.
 *
 * The scale is deliberately slight. A card that visibly shrinks reads as a
 * gimmick; one that gives a few percent reads as a physical surface. Opacity
 * carries the rest, and does the whole job when motion is reduced.
 */
export function PressableScale({
  children,
  style,
  scale = true,
  ...rest
}: PressableScaleProps) {
  const reduced = useReducedMotion();
  const pressed = useRef(new Animated.Value(0)).current;

  const animate = (toValue: number) => {
    if (reduced || !scale) return;
    Animated.timing(pressed, {
      toValue,
      duration: motion.fast,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable
      {...rest}
      onPressIn={(event) => {
        animate(1);
        rest.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animate(0);
        rest.onPressOut?.(event);
      }}
    >
      {({ pressed: isPressed }) => (
        <Animated.View
          style={[
            style,
            {
              opacity: isPressed ? 0.9 : 1,
              transform: [
                {
                  scale: pressed.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, motion.pressScale],
                  }),
                },
              ],
            },
          ]}
        >
          {typeof children === 'function' ? null : children}
        </Animated.View>
      )}
    </Pressable>
  );
}

/**
 * Animates a 0..1 value, for progress bars and status changes.
 *
 * Returns an `Animated.Value` that eases to `target` whenever it changes, so a
 * progress bar grows into place instead of jumping.
 */
export function useAnimatedProgress(target: number, duration = motion.base) {
  const reduced = useReducedMotion();
  // `target` seeds the value once; later changes are animated in the effect
  // below rather than recreating the Animated.Value.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(() => new Animated.Value(target), []);

  useEffect(() => {
    if (reduced) {
      value.setValue(target);
      return;
    }

    const animation = Animated.timing(value, {
      toValue: target,
      duration,
      easing: Easing.out(Easing.cubic),
      // Width and colour cannot run on the native driver.
      useNativeDriver: false,
    });

    animation.start();
    return () => animation.stop();
  }, [duration, reduced, target, value]);

  return value;
}
