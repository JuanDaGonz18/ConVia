import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

type CheckboxProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

export function Checkbox({ label, checked, onChange }: CheckboxProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={styles.container}
    >
      <Ionicons
        color={checked ? colors.primary : colors.border}
        name={checked ? 'checkbox' : 'square-outline'}
        size={22}
      />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'flex-start',
    borderRadius: radius.radiusSmall,
    flexDirection: 'row',
    gap: spacing[8],
    minHeight: 44,
  },
  label: {
    ...typography.bodySmall,
    color: colors.text,
    flex: 1,
  },
});
