import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, spacing, typography, useTheme } from '../constants/theme';
import type { TargetApp } from '../types';

interface Props {
  app: TargetApp;
  selected: boolean;
  onPress: (app: TargetApp) => void;
  /** Renders a PRO hint when selecting this would exceed the free tier. */
  locked?: boolean;
}

/**
 * One selectable app.
 *
 * The whole row is the target — 64pt tall, no separate checkbox to aim at. The
 * selected state is carried by a tinted surface and an accent ring rather than
 * a tick alone, so it is legible in a fast scroll.
 */
export function AppRow({ app, selected, onPress, locked = false }: Props) {
  const { colors } = useTheme();

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={app.name}
      accessibilityHint={locked ? 'Blocking more than one app requires Pro' : undefined}
      testID={`app-row-${app.id}`}
      onPress={() => onPress(app)}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: selected ? colors.accentSoft : colors.surface,
          borderColor: selected ? colors.accent : colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <AppIcon app={app} />

      <View style={styles.labels}>
        <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
          {app.name}
        </Text>
        {app.opaque ? (
          <Text style={[styles.meta, { color: colors.textFaint }]}>
            Chosen in Apple&apos;s Screen Time picker
          </Text>
        ) : null}
      </View>

      {locked && !selected ? (
        <View style={[styles.proTag, { backgroundColor: colors.accentSoft }]}>
          <Text style={[styles.proLabel, { color: colors.accentOnSurface }]}>PRO</Text>
        </View>
      ) : null}

      <View
        style={[
          styles.check,
          {
            backgroundColor: selected ? colors.accent : 'transparent',
            borderColor: selected ? colors.accent : colors.borderStrong,
          },
        ]}
      >
        {selected ? (
          <Text style={[styles.tick, { color: colors.accentText }]}>✓</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function AppIcon({ app }: { app: TargetApp }) {
  const { colors } = useTheme();

  if (app.iconBase64) {
    return (
      <Image
        source={{ uri: `data:image/png;base64,${app.iconBase64}` }}
        style={styles.icon}
        accessibilityIgnoresInvertColors
      />
    );
  }

  // No icon available. A monogram beats a broken-image placeholder.
  return (
    <View style={[styles.icon, styles.iconFallback, { backgroundColor: colors.surfaceMuted }]}>
      <Text style={[styles.iconLetter, { color: colors.textMuted }]}>
        {app.name.charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    minHeight: 64,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
  },
  iconFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconLetter: {
    fontSize: 17,
    fontWeight: '700',
  },
  labels: { flex: 1 },
  name: {
    ...typography.body,
    fontWeight: '600',
  },
  meta: {
    ...typography.caption,
    fontSize: 12,
    marginTop: 1,
  },
  proTag: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  proLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: radius.md,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: {
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 17,
  },
});
