import { Image, StyleSheet, Text, View } from 'react-native';

import { radius, spacing, typography, useTheme } from '../constants/theme';
import { PressableScale } from './motion';

interface Props {
  /** Null when nothing has been chosen yet. */
  appName: string | null;
  iconBase64?: string | null;
  onPress: () => void;
  testID?: string;
}

/**
 * The chosen app, and a way to change it.
 *
 * Replaces a label plus a separate "Change app" button. Those read as two
 * unrelated things; a single row that shows the app and is itself the control
 * matches how every other picker on the platform behaves.
 *
 * The empty state is the same row rather than a different layout, so choosing
 * an app does not make the form jump.
 */
export function AppSelector({ appName, iconBase64, onPress, testID }: Props) {
  const { colors } = useTheme();
  const chosen = appName != null && appName.length > 0;

  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={chosen ? `${appName}. Change app` : 'Choose an app'}
      onPress={onPress}
      style={[
        styles.row,
        {
          backgroundColor: colors.surfaceMuted,
          borderColor: chosen ? colors.border : colors.borderStrong,
        },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: colors.surface }]}>
        {iconBase64 ? (
          <Image
            source={{ uri: `data:image/png;base64,${iconBase64}` }}
            style={styles.iconImage}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Text style={styles.iconGlyph}>{chosen ? '📱' : '＋'}</Text>
        )}
      </View>

      <View style={styles.text}>
        <Text
          style={[styles.name, { color: chosen ? colors.text : colors.textMuted }]}
          numberOfLines={1}
        >
          {chosen ? appName : 'Choose an app'}
        </Text>
        <Text style={[styles.action, { color: colors.accent }]}>
          {chosen ? 'Change app' : 'Pick from your installed apps'}
        </Text>
      </View>

      <Text style={[styles.chevron, { color: colors.textFaint }]}>›</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  iconImage: { width: 32, height: 32, borderRadius: 8 },
  iconGlyph: { fontSize: 20 },
  text: { flex: 1, gap: 2 },
  name: { ...typography.body, fontWeight: '700' },
  action: { ...typography.caption, fontSize: 12, fontWeight: '600' },
  chevron: { fontSize: 26, fontWeight: '300', marginRight: spacing.xs },
});
