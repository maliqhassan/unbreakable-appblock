import { StyleSheet, TextInput, View } from 'react-native';

import { radius, spacing, typography, useTheme } from '../constants/theme';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChange, placeholder = 'Search apps' }: Props) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.wrapper,
        { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
      ]}
    >
      <TextInput
        testID="app-search"
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        style={[styles.input, { color: colors.text }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
  },
  input: {
    ...typography.body,
    // minHeight, not height: at large Android font scales a hard height
    // clips the text instead of letting the field grow.
    minHeight: 50,
    paddingVertical: 0,
  },
});
