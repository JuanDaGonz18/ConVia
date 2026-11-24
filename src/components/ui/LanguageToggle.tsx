import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { setLanguagePreference } from '@/i18n';
import type { Language } from '@/i18n/languages';

const OPTIONS: { value: Language; label: string; name: string }[] = [
  { value: 'es', label: 'ES', name: 'Español' },
  { value: 'en', label: 'EN', name: 'English' },
];

/** ES | EN switch for the screens before signing in (the full selector lives in Appearance and language). */
export function LanguageToggle({ style }: Readonly<{ style?: StyleProp<ViewStyle> }>) {
  const { i18n } = useTranslation();
  const current: Language = i18n.language?.startsWith('en') ? 'en' : 'es';
  return (
    <View accessibilityRole="radiogroup" style={[styles.group, style]}>
      {OPTIONS.map((option) => {
        const selected = option.value === current;
        return (
          <Pressable
            accessibilityLabel={option.name}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            hitSlop={6}
            key={option.value}
            onPress={() => { if (!selected) void setLanguagePreference(option.value); }}
            style={[styles.option, selected && styles.selected]}
          >
            <Text style={[styles.label, selected && styles.selectedLabel]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.radiusFull,
    borderWidth: 1,
    flexDirection: 'row',
    padding: 2,
  },
  option: { borderRadius: radius.radiusFull, paddingHorizontal: spacing[12], paddingVertical: spacing[4] },
  selected: { backgroundColor: colors.primary },
  label: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  selectedLabel: { color: colors.onPrimary },
});
