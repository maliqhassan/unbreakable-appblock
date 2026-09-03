import { Image, StyleSheet, Text, View } from 'react-native';

import { categoryFor } from '../constants/categories';
import { radius, spacing, typography, useTheme } from '../constants/theme';
import { formatDuration, type AppUsage } from '../utils/screenTime';

interface Props {
  apps: AppUsage[];
  /** Icons, keyed by package. Absent packages fall back to a coloured initial. */
  icons?: Record<string, string | null>;
  limit?: number;
}

/**
 * Today's apps, two to a row.
 *
 * A two-column grid rather than a list: these rows carry a name and a duration
 * and nothing else, so a full-width row would be mostly empty space, and eight
 * of them would push everything below off the screen.
 *
 * Ordered by time spent, which is the only order anyone wants — the question is
 * always "what took the most?".
 */
export function AppUsageGrid({ apps, icons, limit = 8 }: Props) {
  const ordered = [...apps].sort((a, b) => b.seconds - a.seconds).slice(0, limit);

  if (ordered.length === 0) return null;

  return (
    <View style={styles.grid}>
      {ordered.map((app) => (
        <AppCell key={app.packageName} app={app} icon={icons?.[app.packageName] ?? null} />
      ))}
    </View>
  );
}

function AppCell({ app, icon }: { app: AppUsage; icon: string | null }) {
  const { colors } = useTheme();
  const category = categoryFor(app.category);

  return (
    <View style={styles.cell}>
      <View style={[styles.icon, { backgroundColor: colors.surfaceMuted }]}>
        {icon ? (
          <Image
            source={{ uri: `data:image/png;base64,${icon}` }}
            style={styles.iconImage}
            accessibilityIgnoresInvertColors
          />
        ) : (
          // No icon from the OS: a tinted initial in the app's own category
          // colour, which at least keeps the row scannable by colour.
          <Text style={[styles.initial, { color: category.color }]}>
            {app.appName.slice(0, 1).toUpperCase()}
          </Text>
        )}
      </View>

      <View style={styles.text}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {app.appName}
        </Text>
        <Text style={[styles.value, { color: colors.textMuted }]}>
          {formatDuration(app.seconds)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.lg,
  },
  // Half-width, minus nothing: the gap is carried by the cells' own padding so
  // the two columns stay aligned when a name wraps.
  cell: {
    width: '50%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingRight: spacing.md,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  iconImage: { width: 40, height: 40 },
  initial: { ...typography.body, fontWeight: '700', fontSize: 18 },
  text: { flex: 1, gap: 1 },
  name: { ...typography.body, fontSize: 15, fontWeight: '600' },
  value: { ...typography.caption, fontSize: 13 },
});
