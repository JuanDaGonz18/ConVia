import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { AppModal } from '@/components/ui/AppModal';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { DEFAULT_FILTERS, type TripFilters } from '@/services/tripFilters';

type Option<T> = { value: T; label: string };

const LEVELS: Option<TripFilters['minLevel']>[] = [
  { value: 'fair', label: 'Todos los compatibles' },
  { value: 'good', label: 'Compatibles' },
  { value: 'excellent', label: 'Muy compatibles' },
];

/** Departure windows in minutes after midnight ("from-to"; "" = any time). */
const WINDOWS: Option<string>[] = [
  { value: '', label: 'Cualquier hora' },
  { value: '300-540', label: '5 a 9 a. m.' },
  { value: '540-720', label: '9 a. m. a 12 m.' },
  { value: '720-960', label: '12 a 4 p. m.' },
  { value: '960-1200', label: '4 a 8 p. m.' },
  { value: '1200-1439', label: 'Después de las 8 p. m.' },
];

const SEATS: Option<number>[] = [1, 2, 3, 4].map((value) => ({ value, label: value === 1 ? '1 cupo' : `${value} cupos` }));
const PRICES: Option<number | null>[] = [null, 5000, 10000, 15000, 20000].map((value) => ({
  value,
  label: value === null ? 'Sin límite' : `Hasta $${value.toLocaleString('es-CO')}`,
}));
const DISTANCES: Option<number | null>[] = [null, 0.5, 1, 2].map((value) => ({
  value,
  label: value === null ? 'Sin límite' : value < 1 ? `${value * 1000} m` : `${value} km`,
}));
const SORTS: Option<TripFilters['sort']>[] = [
  { value: 'match', label: 'Más compatibles' },
  { value: 'departure', label: 'Salen primero' },
  { value: 'price', label: 'Más económicos' },
];

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
        <Text style={styles.title}>Filtros</Text>
        <Text style={styles.subtitle}>Solo ves viajes compatibles con tu trayecto; los filtros los acotan.</Text>
        <ScrollView contentContainerStyle={styles.body} style={styles.scroll}>
          <Chips label="Compatibilidad" onChange={(minLevel) => set({ minLevel })} options={LEVELS} value={draft.minLevel} />
          <Chips
            label="Hora de salida"
            onChange={(next) => {
              const [from, to] = next ? next.split('-').map(Number) : [null, null];
              set({ departFrom: from, departTo: to });
            }}
            options={WINDOWS}
            value={window}
          />
          <Chips label="Cupos que necesitas" onChange={(minSeats) => set({ minSeats })} options={SEATS} value={draft.minSeats} />
          <Chips label="Precio por cupo" onChange={(maxPrice) => set({ maxPrice })} options={PRICES} value={draft.maxPrice} />
          <Chips label="Te recogen a máximo" onChange={(maxPickupKm) => set({ maxPickupKm })} options={DISTANCES} value={draft.maxPickupKm} />
          <Chips label="Te dejan a máximo de tu destino" onChange={(maxDropoffKm) => set({ maxDropoffKm })} options={DISTANCES} value={draft.maxDropoffKm} />
          <View style={styles.switchRow}>
            <Text style={styles.groupLabel}>Solo conductores favoritos</Text>
            <Switch
              accessibilityLabel="Solo conductores favoritos"
              onValueChange={(favoritesOnly) => set({ favoritesOnly })}
              thumbColor={draft.favoritesOnly ? colors.primary : undefined}
              trackColor={{ true: colors.primaryLight }}
              value={draft.favoritesOnly}
            />
          </View>
          <Chips label="Ordenar dentro de cada nivel" onChange={(sort) => set({ sort })} options={SORTS} value={draft.sort} />
        </ScrollView>
        <View style={styles.actions}>
          <ButtonPrimary onPress={() => onApply(draft)} title="Ver viajes" />
          <ButtonSecondary onPress={() => onApply(DEFAULT_FILTERS)} title="Quitar filtros" />
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
