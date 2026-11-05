import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import type { TimePreference } from '@/services/tripMatching';

/** Texts in timePreference.<value>. */
const OPTIONS: TimePreference[] = ['any', 'soon', 'today', 'tomorrow'];

/** When the passenger wants to leave; trips outside that window are not recommended. */
export function TimePreferenceChips({ value, onChange }: Readonly<{ value: TimePreference; onChange: (value: TimePreference) => void }>) {
  const { t } = useTranslation();
  return (
    <ScrollView
      accessibilityLabel={t('timePreference.label')}
      accessibilityRole="radiogroup"
      contentContainerStyle={styles.row}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
    >
      {OPTIONS.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            key={option}
            onPress={() => onChange(option)}
            style={[styles.chip, selected ? styles.chipSelected : null]}
          >
            <Text style={[styles.text, selected ? styles.textSelected : null]}>{t(`timePreference.${option}`)}</Text>
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
