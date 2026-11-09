import { useRef, useState } from 'react';
import { Pressable, ScrollView, type ScrollViewInstance, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { LEGAL_COMPANY, LEGAL_UPDATED_AT, LEGAL_VERSION, LegalBlock, PRIVACY, TERMS } from '@/content/legal';

type Tab = 'terms' | 'privacy';

const TABS: Tab[] = ['terms', 'privacy'];

/** Terms and Conditions + Privacy Policy. Reachable signed in or out (registration, profile). */
export default function LegalScreen() {
  const { t, i18n } = useTranslation();
  const params = useLocalSearchParams<{ doc?: string }>();
  const [tab, setTab] = useState<Tab>(params.doc === 'privacy' ? 'privacy' : 'terms');
  const scrollRef = useRef<ScrollViewInstance>(null);
  // The legal documents exist only in Spanish, the version that applies.
  const document = tab === 'terms' ? TERMS : PRIVACY;

  const changeTab = (next: Tab) => {
    setTab(next);
    scrollRef.current?.scrollTo({ animated: false, y: 0 });
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} ref={scrollRef}>
        <ScreenHeader
          kicker={t('legal.kicker')}
          subtitle={t('legal.version', { version: LEGAL_VERSION, date: LEGAL_UPDATED_AT })}
          title={document.title}
        />

        {i18n.language !== 'es' ? <Text style={styles.summaryNote}>{t('legal.spanishOnly')}</Text> : null}

        <View accessibilityRole="tablist" style={styles.tabs}>
          {TABS.map((item) => {
            const active = item === tab;
            return (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                key={item}
                onPress={() => changeTab(item)}
                style={[styles.tab, active ? styles.tabActive : null]}
              >
                <Text style={[styles.tabText, active ? styles.tabTextActive : null]}>{t(`legal.tabs.${item}`)}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.summary}>
          <View style={styles.summaryHeader}>
            <Ionicons color={colors.primary} name="information-circle" size={20} />
            <Text style={styles.summaryTitle}>{t('legal.summary')}</Text>
          </View>
          {document.summary.map((point) => (
            <View key={point} style={styles.bulletRow}>
              <Text style={styles.summaryBullet}>•</Text>
              <Text style={styles.summaryText}>{point}</Text>
            </View>
          ))}
          <Text style={styles.summaryNote}>{t('legal.summaryNote')}</Text>
        </View>

        {document.sections.map((section) => (
          <View key={section.id} style={styles.section}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>{section.title}</Text>
            {section.body.map((block, index) => <Block block={block} key={index} />)}
          </View>
        ))}

        <View style={styles.contact}>
          <Ionicons color={colors.textSecondary} name="mail-outline" size={18} />
          <Text style={styles.contactText}>
            {t('legal.contact', { email: LEGAL_COMPANY.email })}
          </Text>
        </View>

        {tab === 'terms' ? (
          <Pressable onPress={() => changeTab('privacy')} style={styles.next}>
            <Text style={styles.nextText}>{t('legal.readPrivacy')}</Text>
            <Ionicons color={colors.primary} name="arrow-forward" size={18} />
          </Pressable>
        ) : null}

        <ButtonPrimary onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} title={t('legal.understood')} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Block({ block }: Readonly<{ block: LegalBlock }>) {
  if (typeof block === 'string') return <Text style={styles.paragraph}>{block}</Text>;
  return (
    <View style={styles.list}>
      {block.bullets.map((item) => (
        <View key={item} style={styles.bulletRow}>
          <Text style={styles.bullet}>•</Text>
          <Text style={styles.paragraph}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  tabs: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.radiusMedium,
    flexDirection: 'row',
    gap: spacing[4],
    padding: spacing[4],
  },
  tab: { alignItems: 'center', borderRadius: radius.radiusSmall, flex: 1, paddingVertical: spacing[8] },
  tabActive: {
    backgroundColor: colors.white,
    elevation: 2,
    shadowColor: colors.shadow,
    shadowOffset: { height: 1, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  tabText: { ...typography.bodyMedium, color: colors.textSecondary },
  tabTextActive: { color: colors.primary, fontWeight: '700' },
  summary: { backgroundColor: colors.primaryLight, borderRadius: radius.radiusLarge, gap: spacing[8], padding: spacing[16] },
  summaryHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  summaryTitle: { ...typography.headingM, color: colors.text },
  summaryBullet: { ...typography.bodySmall, color: colors.primary, fontWeight: '800' },
  summaryText: { ...typography.bodySmall, color: colors.text, flex: 1 },
  summaryNote: { ...typography.caption, color: colors.textSecondary, marginTop: spacing[4] },
  section: { gap: spacing[8] },
  sectionTitle: { ...typography.headingM, color: colors.text },
  paragraph: { ...typography.bodySmall, color: colors.text, flex: 1, lineHeight: 21 },
  list: { gap: spacing[8] },
  bulletRow: { flexDirection: 'row', gap: spacing[8] },
  bullet: { ...typography.bodySmall, color: colors.textSecondary, lineHeight: 21 },
  contact: {
    alignItems: 'flex-start',
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing[8],
    padding: spacing[16],
  },
  contactText: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },
  next: { alignItems: 'center', flexDirection: 'row', gap: spacing[8], justifyContent: 'center', paddingVertical: spacing[8] },
  nextText: { ...typography.bodyMedium, color: colors.primary, fontWeight: '600' },
});
