import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

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
import { DEFAULT_PREFERENCES, PLACE_KIND_LABELS, personalizationService } from '@/services/personalizationService';
import { useAppStore } from '@/store/appStore';
import { usePlan } from '@/subscription/usePlan';
import { UserPreferences } from '@/types';
import { errorMessage } from '@/utils/format';

type Option<T> = { value: T; label: string };

const TIMES: Option<UserPreferences['time']>[] = [
  { value: 'any', label: 'Cualquier momento' },
  { value: 'soon', label: 'Lo antes posible' },
  { value: 'today', label: 'Hoy' },
  { value: 'tomorrow', label: 'Mañana' },
];
const SORTS: Option<UserPreferences['sort']>[] = [
  { value: 'match', label: 'Más compatibles' },
  { value: 'departure', label: 'Salen primero' },
  { value: 'price', label: 'Más económicos' },
];
const DISTANCES: Option<number | null>[] = [null, 0.5, 1, 2].map((value) => ({
  value,
  label: value === null ? 'Sin límite' : value < 1 ? `${value * 1000} m` : `${value} km`,
}));

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
      toast.success('Preferencias guardadas');
      router.back();
    } catch (saveError) {
      setError(errorMessage(saveError, 'No se pudieron guardar tus preferencias.'));
    } finally {
      setSaving(false);
    }
  };

  const pickupOptions: Option<string | null>[] = [
    { value: null, label: 'Mi ubicación actual' },
    ...savedPlaces.map((place) => ({ value: place.id, label: place.kind === 'other' ? place.label : PLACE_KIND_LABELS[place.kind] })),
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader kicker="TU CUENTA" title="Preferencias" />
        <View style={styles.introRow}>
          <Text style={styles.subtitle}>
            Así empieza cada búsqueda. Siempre ves primero los viajes más compatibles; esto solo ajusta el resto.
          </Text>
          {!allowed || isBetaPerk('advanced_preferences') ? <PlusBadge compact /> : null}
        </View>
        {error ? <Notice tone="error">{error}</Notice> : null}

        <Chips
          hint={savedPlaces.length ? undefined : 'Guarda tu casa o tu trabajo en Mis lugares para elegirlos aquí.'}
          label="Dónde te recogen normalmente"
          onChange={(pickupPlaceId) => set({ pickupPlaceId })}
          options={pickupOptions}
          value={draft.pickupPlaceId}
        />
        <Chips label="Cuándo sueles salir" onChange={(time) => set({ time })} options={TIMES} value={draft.time} />
        <Chips
          hint="Viajes que te recojan más lejos no se muestran."
          label="Caminar máximo para subir"
          onChange={(maxPickupKm) => set({ maxPickupKm })}
          options={DISTANCES}
          value={draft.maxPickupKm}
        />
        <Chips
          hint="Desde donde te bajas hasta tu destino."
          label="Caminar máximo al bajarte"
          onChange={(maxDropoffKm) => set({ maxDropoffKm })}
          options={DISTANCES}
          value={draft.maxDropoffKm}
        />
        <Chips
          hint="Dentro de cada nivel de compatibilidad."
          label="Ordenar viajes"
          onChange={(sort) => set({ sort })}
          options={SORTS}
          value={draft.sort}
        />

        <Text style={styles.label}>Avisos</Text>
        <View style={styles.switchCard}>
          <SwitchRow
            label="Viajes nuevos de tus rutas"
            onChange={(notifyAlerts) => set({ notifyAlerts })}
            subtitle="Cuando una alerta encuentra un viaje compatible (máximo 3 al día)."
            value={draft.notifyAlerts}
          />
          <View style={styles.divider} />
          <SwitchRow
            label="Viajes recurrentes publicados"
            onChange={(notifyRecurring) => set({ notifyRecurring })}
            subtitle="Un resumen cuando publicamos los viajes de tu horario semanal."
            value={draft.notifyRecurring}
          />
        </View>
        <Text style={styles.hint}>Las solicitudes, respuestas, mensajes y cambios de tus viajes siguen el interruptor de Notificaciones de tu perfil.</Text>

        <ButtonPrimary disabled={!allowed} loading={saving} onPress={() => void save()} title="Guardar preferencias" />
      </ScrollView>
    </SafeAreaView>
  );
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
  chipTextSelected: { color: colors.white },
  switchCard: { borderColor: colors.lightGray, borderRadius: radius.radiusLarge, borderWidth: 1 },
  switchRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[12], padding: spacing[12] },
  switchTitle: { ...typography.bodyMedium, color: colors.text, fontWeight: '600' },
  divider: { backgroundColor: colors.lightGray, height: 1 },
});
