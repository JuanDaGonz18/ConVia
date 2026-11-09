import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { PlusBadge } from '@/components/subscription/PlusBadge';
import { requirePlus } from '@/components/subscription/PlusGate';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { toast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { notificationService } from '@/services/notificationService';
import { DEFAULT_PREFERENCES, personalizationService } from '@/services/personalizationService';
import { useAppStore } from '@/store/appStore';
import { usePlan } from '@/subscription/usePlan';
import { UserPreferences } from '@/types';
import { errorMessage } from '@/utils/format';

type Option<T> = { value: T; label: string };

const TIMES: UserPreferences['time'][] = ['any', 'soon', 'today', 'tomorrow'];
const SORTS: UserPreferences['sort'][] = ['match', 'departure', 'price'];
const DISTANCES: (number | null)[] = [null, 0.5, 1, 2];

function Chips<T>({ label, hint, options, value, onChange }: Readonly<{
  label: string; hint?: string; options: Option<T>[]; value: T; onChange: (value: T) => void;
}>) {
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View accessibilityLabel={label} accessibilityRole="radiogroup" style={styles.chips}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              key={option.label}
              onPress={() => onChange(option.value)}
              style={[styles.chip, selected ? styles.chipSelected : null]}
            >
              <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Personal defaults for searching and notifications. They start each search
 * and order trips inside a compatibility level; they never make an
 * incompatible trip appear.
 */
export default function PreferencesScreen() {
  const { t } = useTranslation();
  const stored = useAppStore((state) => state.preferences);
  const setPreferences = useAppStore((state) => state.setPreferences);
  const savedPlaces = useAppStore((state) => state.savedPlaces);
  const { can, isBetaPerk } = usePlan();
  const [draft, setDraft] = useState<UserPreferences>(stored ?? DEFAULT_PREFERENCES);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = can('advanced_preferences');
  const set = (changes: Partial<UserPreferences>) => {
    if (!allowed) {
      requirePlus({ capability: 'advanced_preferences' });
      return;
    }
    setDraft((current) => ({ ...current, ...changes }));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await personalizationService.savePreferences(draft);
      setPreferences(draft);
      toast.success(t('preferences.saved'));
      router.back();
    } catch (saveError) {
      setError(errorMessage(saveError, t('preferences.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const pickupOptions: Option<string | null>[] = [
    { value: null, label: t('preferences.currentLocation') },
    ...savedPlaces.map((place) => ({ value: place.id, label: place.kind === 'other' ? place.label : t(`placeKinds.${place.kind}`) })),
  ];
  const times = TIMES.map((value) => ({ value, label: t(`preferences.times.${value}`) }));
  const sorts = SORTS.map((value) => ({ value, label: t(`preferences.sorts.${value}`) }));
  const distances = DISTANCES.map((value) => ({
    value,
    label: value === null ? t('preferences.noLimit') : value < 1 ? `${value * 1000} m` : `${value} km`,
  }));

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader kicker={t('preferences.kicker')} title={t('preferences.title')} />
        <View style={styles.introRow}>
          <Text style={styles.subtitle}>{t('preferences.subtitle')}</Text>
          {!allowed || isBetaPerk('advanced_preferences') ? <PlusBadge compact /> : null}
        </View>
        {error ? <Notice tone="error">{error}</Notice> : null}

        <Chips
          hint={savedPlaces.length ? undefined : t('preferences.pickupHint')}
          label={t('preferences.pickup')}
          onChange={(pickupPlaceId) => set({ pickupPlaceId })}
          options={pickupOptions}
          value={draft.pickupPlaceId}
        />
        <Chips label={t('preferences.time')} onChange={(time) => set({ time })} options={times} value={draft.time} />
        <Chips
          hint={t('preferences.maxPickupHint')}
          label={t('preferences.maxPickup')}
          onChange={(maxPickupKm) => set({ maxPickupKm })}
          options={distances}
          value={draft.maxPickupKm}
        />
        <Chips
          hint={t('preferences.maxDropoffHint')}
          label={t('preferences.maxDropoff')}
          onChange={(maxDropoffKm) => set({ maxDropoffKm })}
          options={distances}
          value={draft.maxDropoffKm}
        />
        <Chips
          hint={t('preferences.sortHint')}
          label={t('preferences.sort')}
          onChange={(sort) => set({ sort })}
          options={sorts}
          value={draft.sort}
        />

        <Text style={styles.label}>{t('preferences.notices')}</Text>
        <View style={styles.switchCard}>
          <SwitchRow
            label={t('preferences.notifyAlerts')}
            onChange={(notifyAlerts) => set({ notifyAlerts })}
            subtitle={t('preferences.notifyAlertsHint')}
            value={draft.notifyAlerts}
          />
          <View style={styles.divider} />
          <SwitchRow
            label={t('preferences.notifyRecurring')}
            onChange={(notifyRecurring) => set({ notifyRecurring })}
            subtitle={t('preferences.notifyRecurringHint')}
            value={draft.notifyRecurring}
          />
        </View>
        {/* The profile's Notifications switch only exists where push works (same check as the profile). */}
        <Text style={styles.hint}>{t(pushHintKey())}</Text>

        <ButtonPrimary disabled={!allowed} loading={saving} onPress={() => void save()} title={t('preferences.save')} />
      </ScrollView>
    </SafeAreaView>
  );
}

function pushHintKey() {
  if (notificationService.isAvailable()) return 'preferences.pushHint';
  return Platform.OS === 'web' ? 'preferences.pushWebHint' : 'preferences.pushUnavailableHint';
}

function SwitchRow({ label, subtitle, value, onChange }: Readonly<{ label: string; subtitle: string; value: boolean; onChange: (value: boolean) => void }>) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.flex}>
        <Text style={styles.switchTitle}>{label}</Text>
        <Text style={styles.hint}>{subtitle}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        onValueChange={onChange}
        thumbColor={value ? colors.primary : undefined}
        trackColor={{ true: colors.primaryLight }}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  flex: { flex: 1 },
  introRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing[8] },
  subtitle: { ...typography.body, color: colors.textSecondary, flex: 1 },
  group: { gap: spacing[8] },
  label: { ...typography.label, color: colors.text },
  hint: { ...typography.caption, color: colors.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8] },
  chip: {
    borderColor: colors.border,
    borderRadius: radius.radiusFull,
    borderWidth: 1,
    paddingHorizontal: spacing[12],
    paddingVertical: 6,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.text, fontWeight: '600' },
  chipTextSelected: { color: colors.onPrimary },
  switchCard: { borderColor: colors.lightGray, borderRadius: radius.radiusLarge, borderWidth: 1 },
  switchRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[12], padding: spacing[12] },
  switchTitle: { ...typography.bodyMedium, color: colors.text, fontWeight: '600' },
  divider: { backgroundColor: colors.lightGray, height: 1 },
});
