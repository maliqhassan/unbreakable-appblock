import { useEffect, useMemo } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';

import { useTheme } from '../constants/theme';
import { Logo } from './Logo';

interface Props {
  size?: number;
  color?: string;
  /** Read by screen readers while the spinner is on screen. */
  label?: string;
}

/**
 * The app mark, turning, used wherever a full-screen wait needs filling.
 *
 * Two interlocking rings are a good spinner precisely because they are not
 * radially symmetric: the break in each ring gives the eye something to follow,
 * so the rotation is legible rather than a smooth blur.
 *
 * Kept out of buttons on purpose — inline waits use a plain `ActivityIndicator`,
 * which is the platform-native size and weight for that job. This is for the
 * moments the app has nothing else to show.
 */
export function LogoLoader({ size = 56, color, label = 'Loading' }: Props) {
  const { colors } = useTheme();
  const spin = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    let cancelled = false;
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1600,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    // Someone who has asked the system to reduce motion should not be handed a
    // perpetually spinning graphic; they get the mark, still.
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (!cancelled && !reduced) loop.start();
      })
      .catch(() => {
        if (!cancelled) loop.start();
      });

    return () => {
      cancelled = true;
      loop.stop();
    };
  }, [spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
    >
      <Animated.View style={{ transform: [{ rotate }] }}>
        <Logo size={size} color={color ?? colors.accent} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});
