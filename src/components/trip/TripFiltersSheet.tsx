import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppModal } from '@/components/ui/AppModal';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { DEFAULT_FILTERS, type TripFilters } from '@/services/tripFilters';
import { formatDistance, formatPrice } from '@/utils/format';
import i18n from '@/i18n';

type Option<T> = { value: T; label: string };

// Options are built when the sheet renders, so they follow the current language.
const levels = (): Option<TripFilters['minLevel']>[] => (['fair', 'good', 'excellent'] as const)
  .map((value) => ({ value, label: i18n.t(`filters.level.${value}`) }));

/** Departure windows in minutes after midnight ("from-to"; "" = any time). */
const windows = (): Option<string>[] => ([
  ['', 'any'],
  ['300-540', 'early'],
  ['540-720', 'morning'],
  ['720-960', 'afternoon'],
  ['960-1200', 'evening'],
  ['1200-1439', 'night'],
] as const).map(([value, key]) => ({ value, label: i18n.t(`filters.window.${key}`) }));

const seats = (): Option<number>[] => [1, 2, 3, 4].map((value) => ({ value, label: i18n.t('filters.seats', { count: value }) }));
const prices = (): Option<number | null>[] => [null, 5000, 10000, 15000, 20000].map((value) => ({
  value,
  label: value === null ? i18n.t('filters.noLimit') : i18n.t('filters.upTo', { price: formatPrice(value) }),
}));
const distances = (): Option<number | null>[] => [null, 0.5, 1, 2].map((value) => ({
  value,
  label: value === null ? i18n.t('filters.noLimit') : formatDistance(value),
}));
const sorts = (): Option<TripFilters['sort']>[] => (['match', 'departure', 'price'] as const)
  .map((value) => ({ value, label: i18n.t(`filters.sort.${value}`) }));

function Chips<T>({ options, value, onChange, label }: Readonly<{ options: Option<T>[]; value: T; onChange: (value: T) => void; label: string }>) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
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
 * Advanced filters for compatible trips. They narrow the results the matching
 * already chose; the order keeps the compatibility level first.
 */
export function TripFiltersSheet({ visible, value, onApply, onClose }: Readonly<{
  visible: boolean;
  value: TripFilters;
  onApply: (filters: TripFilters) => void;
  onClose: () => void;
}>) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  // Start from the applied filters every time the sheet opens.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setDraft(value);
  }
  const set = (changes: Partial<TripFilters>) => setDraft((current) => ({ ...current, ...changes }));
  const window = draft.departFrom === null ? '' : `${draft.departFrom}-${draft.departTo}`;

  return (
    <AppModal onRequestClose={onClose} visible={visible}>
      <View style={styles.sheet}>
        <Text style={styles.title}>{t('filters.title')}</Text>
        <Text style={styles.subtitle}>{t('filters.subtitle')}</Text>
        <ScrollView contentContainerStyle={styles.body} style={styles.scroll}>
          <Chips label={t('filters.compatibility')} onChange={(minLevel) => set({ minLevel })} options={levels()} value={draft.minLevel} />
          <Chips
            label={t('filters.departure')}
            onChange={(next) => {
              const [from, to] = next ? next.split('-').map(Number) : [null, null];
              set({ departFrom: from, departTo: to });
            }}
            options={windows()}
            value={window}
          />
          <Chips label={t('filters.seatsLabel')} onChange={(minSeats) => set({ minSeats })} options={seats()} value={draft.minSeats} />
          <Chips label={t('filters.price')} onChange={(maxPrice) => set({ maxPrice })} options={prices()} value={draft.maxPrice} />
          <Chips label={t('filters.pickup')} onChange={(maxPickupKm) => set({ maxPickupKm })} options={distances()} value={draft.maxPickupKm} />
          <Chips label={t('filters.dropoff')} onChange={(maxDropoffKm) => set({ maxDropoffKm })} options={distances()} value={draft.maxDropoffKm} />
          <View style={styles.switchRow}>
            <Text style={styles.groupLabel}>{t('filters.favoritesOnly')}</Text>
            <Switch
              accessibilityLabel={t('filters.favoritesOnly')}
              onValueChange={(favoritesOnly) => set({ favoritesOnly })}
              thumbColor={draft.favoritesOnly ? colors.primary : undefined}
              trackColor={{ true: colors.primaryLight }}
              value={draft.favoritesOnly}
            />
          </View>
          <Chips label={t('filters.sortLabel')} onChange={(sort) => set({ sort })} options={sorts()} value={draft.sort} />
        </ScrollView>
        <View style={styles.actions}>
          <ButtonPrimary onPress={() => onApply(draft)} title={t('filters.apply')} />
          <ButtonSecondary onPress={() => onApply(DEFAULT_FILTERS)} title={t('filters.clear')} />
        </View>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: spacing[8], maxHeight: '85%' },
  title: { ...typography.headingM, color: colors.text },
  subtitle: { ...typography.bodySmall, color: colors.textSecondary },
  scroll: { flexGrow: 0 },
  body: { gap: spacing[16], paddingVertical: spacing[8] },
  group: { gap: spacing[8] },
  groupLabel: { ...typography.label, color: colors.text },
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
  chipTextSelected: { color: colors.white },
  switchRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  actions: { gap: spacing[8], paddingTop: spacing[8] },
});
