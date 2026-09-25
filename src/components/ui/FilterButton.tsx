import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

type FilterButtonProps = {
  title: string;
  selected?: boolean;
  onPress: () => void;
};

export function FilterButton({ title, selected = false, onPress }: FilterButtonProps) {
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.button, selected ? styles.selected : null]}
    >
      <Ionicons
        color={selected ? colors.white : colors.primary}
        name="options-outline"
        size={16}
      />
      <Text style={[styles.title, selected ? styles.selectedTitle : null]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderColor: colors.border,
    borderRadius: radius.radiusFull,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing[8],
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[8],
  },
  selected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  title: {
    ...typography.bodySmall,
    color: colors.text,
  },
  selectedTitle: {
    color: colors.white,
  },
});
