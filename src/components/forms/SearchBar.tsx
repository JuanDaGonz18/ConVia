import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, TextInput, TextInputProps, View } from 'react-native';

import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

type SearchBarProps = TextInputProps;

export function SearchBar(props: SearchBarProps) {
  return (
    <View style={styles.container}>
      <Ionicons
        accessibilityLabel="Buscar"
        color={colors.textSecondary}
        name="search-outline"
        size={20}
      />
      <TextInput
        accessibilityLabel={props.placeholder ?? 'Buscar'}
        placeholderTextColor={colors.textSecondary}
        style={styles.input}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.radiusMedium,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing[8],
    height: dimensions.controlHeight,
    paddingHorizontal: spacing[16],
  },
  input: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    height: '100%',
  },
});
