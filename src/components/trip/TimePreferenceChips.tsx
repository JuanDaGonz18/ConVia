import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import type { TimePreference } from '@/services/tripMatching';

const OPTIONS: { value: TimePreference; label: string }[] = [
  { value: 'any', label: 'Cualquier momento' },
  { value: 'soon', label: 'Lo antes posible' },
  { value: 'today', label: 'Hoy' },
  { value: 'tomorrow', label: 'Mañana' },
];

/** When the passenger wants to leave; trips outside that window are not recommended. */
export function TimePreferenceChips({ value, onChange }: Readonly<{ value: TimePreference; onChange: (value: TimePreference) => void }>) {
  return (
    <ScrollView
      accessibilityLabel="¿Cuándo quieres salir?"
      accessibilityRole="radiogroup"
      contentContainerStyle={styles.row}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
    >
      {OPTIONS.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.chip, selected ? styles.chipSelected : null]}
          >
            <Text style={[styles.text, selected ? styles.textSelected : null]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { gap: spacing[8] },
  chip: {
    borderColor: colors.border,
    borderRadius: radius.radiusFull,
    borderWidth: 1,
    paddingHorizontal: spacing[12],
    paddingVertical: 6,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  text: { ...typography.caption, color: colors.text, fontWeight: '600' },
  textSelected: { color: colors.white },
});
