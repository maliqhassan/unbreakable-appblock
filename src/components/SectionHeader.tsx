import { StyleSheet, Text, View } from 'react-native';

import { spacing, typography, useTheme } from '../constants/theme';

interface Props {
  title: string;
  /** One quiet line under the title. Omit rather than pad with filler. */
  subtitle?: string;
  /** A count, a status, or an action label rendered on the right. */
  trailing?: React.ReactNode;
}

/**
 * The one way a section is introduced.
 *
 * Every screen used to invent its own section label — some an eyebrow, some a
 * heading, some a card title — which is most of why the app read as assembled
 * rather than designed. A section is a heading and, at most, one line saying
 * what it is for.
 */
export function SectionHeader({ title, subtitle, trailing }: Props) {
  const { colors } = useTheme();

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        {trailing}
      </View>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2, marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...typography.heading, fontSize: 18 },
  subtitle: { ...typography.caption, lineHeight: 19 },
});
