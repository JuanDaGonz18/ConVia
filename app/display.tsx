import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { LanguageSwitcher } from '@/components/settings/LanguageSwitcher';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import {
  readThemePreference,
  saveThemePreference,
  startupPreference,
  THEME_PREFERENCES,
  type ThemePreference,
} from '@/theme/themePreference';

const THEME_KEYS = { system: 'appearance.themeSystem', light: 'appearance.themeLight', dark: 'appearance.themeDark' } as const;
const THEME_ICONS = { system: 'phone-portrait-outline', light: 'sunny-outline', dark: 'moon-outline' } as const;

/**
 * Profile → Apariencia e idioma: language, and the light, dark or system theme.
 * Every StyleSheet is built once from `colors`, so a new theme needs a reload: the web
 * reloads right away; on a phone it applies the next time the app opens.
 */
export default function DisplayScreen() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<ThemePreference>(readThemePreference);

  function choose(next: ThemePreference) {
    if (next === theme) return;
    try {
      saveThemePreference(next);
    } catch {
      return;
    }
    setTheme(next);
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.reload();
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader kicker={t('appearance.kicker')} title={t('appearance.title')} />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('appearance.languageSection')}</Text>
          <LanguageSwitcher />
          <Text style={styles.hint}>{t('language.systemHint')} {t('appearance.languageHint')}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('appearance.themeSection')}</Text>
          <View accessibilityLabel={t('appearance.themeSection')} accessibilityRole="radiogroup" style={styles.themeRow}>
            {THEME_PREFERENCES.map((option) => {
              const selected = option === theme;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, selected }}
                  key={option}
                  onPress={() => choose(option)}
                  style={({ pressed }) => [styles.themeOption, selected && styles.themeSelected, pressed && !selected && styles.pressed]}
                >
                  <Ionicons color={selected ? colors.primary : colors.textSecondary} name={THEME_ICONS[option]} size={18} />
                  <Text numberOfLines={1} style={[styles.themeLabel, selected && styles.themeLabelSelected]}>{t(THEME_KEYS[option])}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.hint}>{t('appearance.themeHint')}</Text>
          {Platform.OS !== 'web' && theme !== startupPreference ? (
            <View style={styles.restart}>
              <Ionicons color={colors.primary} name="refresh-outline" size={16} />
              <Text style={styles.hint}>{t('appearance.themeRestart')}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[24], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  section: { gap: spacing[8] },
  sectionTitle: { ...typography.label, color: colors.text },
  hint: { ...typography.caption, color: colors.textSecondary, flexShrink: 1 },
  themeRow: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radius.radiusMedium,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing[4],
    padding: spacing[4],
  },
  themeOption: {
    alignItems: 'center',
    borderRadius: radius.radiusSmall,
    flexBasis: 0,
    flexDirection: 'row',
    flexGrow: 1,
    gap: spacing[4],
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing[8],
  },
  themeSelected: { backgroundColor: colors.white },
  pressed: { opacity: 0.7 },
  themeLabel: { ...typography.bodySmall, color: colors.textSecondary, fontWeight: '600' },
  themeLabelSelected: { color: colors.primary },
  restart: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
});
