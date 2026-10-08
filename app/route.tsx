import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { DateTimePicker } from '@expo/ui/community/datetime-picker';

import { FieldError } from '@/components/forms/FieldError';
import { PlaceSearchField } from '@/components/forms/PlaceSearchField';
import { TextField } from '@/components/forms/TextField';
import { PlusBadge } from '@/components/subscription/PlusBadge';
import { requirePlus } from '@/components/subscription/PlusGate';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { toast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { locationService } from '@/services/locationService';
import { personalizationService } from '@/services/personalizationService';
import { formatClock, WEEKDAYS } from '@/services/recurringTripService';
import { useAppStore } from '@/store/appStore';
import { planLimitFromError } from '@/subscription/plans';
import { usePlan } from '@/subscription/usePlan';
import { Location } from '@/types';
import { errorMessage, rawErrorMessage } from '@/utils/format';

type FieldErrors = Partial<Record<'origin' | 'destination' | 'time', string>>;

const pad = (value: number) => String(value).padStart(2, '0');
const toClock = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
function fromClock(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function paramPlace(label?: string, lat?: string, lng?: string): Location | null {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!label || !lat || !lng || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { id: `${latitude.toFixed(6)},${longitude.toFixed(6)}`, label, address: label, latitude, longitude };
}

/** Create or edit a saved route (a search shortcut) and its alert. */
export default function RouteScreen() {
  const params = useLocalSearchParams<{
    id?: string;
    originLabel?: string; originLat?: string; originLng?: string;
    destLabel?: string; destLat?: string; destLng?: string;
  }>();
  const routes = useAppStore((state) => state.savedRoutes);
  const setSavedRoutes = useAppStore((state) => state.setSavedRoutes);
  const savedPlaces = useAppStore((state) => state.savedPlaces);
  const { can, isBetaPerk } = usePlan();
  const existing = routes.find((route) => route.id === params.id);
  const [name, setName] = useState(existing?.name ?? '');
  const [origin, setOrigin] = useState<Location | null>(existing?.origin ?? paramPlace(params.originLabel, params.originLat, params.originLng));
  const [destination, setDestination] = useState<Location | null>(existing?.destination ?? paramPlace(params.destLabel, params.destLat, params.destLng));
  const [days, setDays] = useState<number[]>(existing?.days ?? []);
  const [timeFrom, setTimeFrom] = useState<string | null>(existing?.timeFrom ?? null);
  const [timeTo, setTimeTo] = useState<string | null>(existing?.timeTo ?? null);
  const [alert, setAlert] = useState(existing ? existing.alert : can('smart_match_alerts'));
  const [picker, setPicker] = useState<'from' | 'to' | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggleAlert = (value: boolean) => {
    if (value && !can('smart_match_alerts')) {
      requirePlus({ capability: 'smart_match_alerts' });
      return;
    }
    setAlert(value);
  };

  const pick = (picked: Date) => {
    const value = toClock(picked);
    if (picker === 'from') {
      setTimeFrom(value);
      // A one-hour window by default (until midnight at most).
      if (!timeTo || timeTo <= value) {
        const end = new Date(picked.getTime() + 60 * 60_000);
        setTimeTo(end.getDate() === picked.getDate() ? toClock(end) : '23:59');
      }
    } else if (picker === 'to') {
      setTimeTo(value);
    }
    setFieldErrors((current) => ({ ...current, time: undefined }));
    if (Platform.OS !== 'ios') setPicker(null);
  };

  const save = async () => {
    const found: FieldErrors = {};
    if (!origin) found.origin = 'Elige dónde te recogen.';
    if (!destination) found.destination = 'Elige a dónde vas.';
    else if (origin && locationService.distanceKm(origin, destination) < 0.3) found.destination = 'El destino debe ser distinto al punto de partida.';
    if ((timeFrom === null) !== (timeTo === null) || (timeFrom && timeTo && timeFrom >= timeTo)) found.time = 'La hora final debe ser después de la inicial.';
    setFieldErrors(found);
    if (Object.values(found).some(Boolean) || !origin || !destination) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await personalizationService.saveRoute({ name, origin, destination, days, timeFrom, timeTo, alert }, existing?.id);
      setSavedRoutes(existing ? routes.map((route) => (route.id === saved.id ? saved : route)) : [...routes, saved]);
      toast.success(alert ? 'Ruta guardada. Te avisaremos cuando aparezca un viaje compatible' : 'Ruta guardada');
      router.back();
    } catch (saveError) {
      const limit = planLimitFromError(rawErrorMessage(saveError));
      if (limit?.key === 'saved_routes') requirePlus({ limit: 'saved_routes' });
      setError(errorMessage(saveError, 'No se pudo guardar la ruta.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ScreenHeader kicker="TUS RUTAS" title={existing ? 'Editar ruta' : 'Nueva ruta'} />
        <Text style={styles.subtitle}>Úsala para buscar con un toque y, si quieres, te avisamos cuando se publique un viaje compatible.</Text>
        {error ? <Notice tone="error">{error}</Notice> : null}

        <TextField label="Nombre (opcional)" maxLength={40} onChangeText={setName} placeholder="Por ejemplo: Casa a la universidad" value={name} />
        <PlaceSearchField
          allowCurrentLocation
          error={fieldErrors.origin}
          label="Desde"
          mapTitle="Dónde te recogen"
          onChange={(place) => { setOrigin(place); setFieldErrors((current) => ({ ...current, origin: undefined })); }}
          placeholder="Busca dónde te recogen"
          quickPlaces={savedPlaces}
          value={origin}
        />
        <PlaceSearchField
          error={fieldErrors.destination}
          label="Hacia"
          mapTitle="A dónde vas"
          near={origin}
          onChange={(place) => { setDestination(place); setFieldErrors((current) => ({ ...current, destination: undefined })); }}
          placeholder="Busca a dónde vas"
          quickPlaces={savedPlaces.filter((place) => !origin || locationService.distanceKm(place, origin) >= 0.3)}
          value={destination}
        />

        <Text style={styles.label}>Días</Text>
        <View style={styles.dayRow}>
          {WEEKDAYS.map(({ day, short, long }) => {
            const selected = days.includes(day);
            return (
              <Pressable
                accessibilityLabel={long}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                key={day}
                onPress={() => setDays((current) => (selected ? current.filter((item) => item !== day) : [...current, day].sort((a, b) => a - b)))}
                style={[styles.day, selected ? styles.daySelected : null]}
              >
                <Text style={[styles.dayText, selected ? styles.dayTextSelected : null]}>{short}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.hint}>{days.length ? 'Solo esos días.' : 'Sin días elegidos: cualquier día.'}</Text>

        <Text style={styles.label}>Hora de salida</Text>
        <View style={styles.timeRow}>
          <Pressable accessibilityLabel="Desde qué hora" onPress={() => setPicker('from')} style={styles.timeButton}>
            <Ionicons color={colors.primary} name="time-outline" size={18} />
            <Text style={styles.timeText}>{timeFrom ? `Desde ${formatClock(timeFrom)}` : 'Cualquier hora'}</Text>
          </Pressable>
          {timeFrom ? (
            <Pressable accessibilityLabel="Hasta qué hora" onPress={() => setPicker('to')} style={styles.timeButton}>
              <Text style={styles.timeText}>{timeTo ? `Hasta ${formatClock(timeTo)}` : 'Hasta…'}</Text>
            </Pressable>
          ) : null}
        </View>
        {timeFrom ? (
          <Pressable hitSlop={8} onPress={() => { setTimeFrom(null); setTimeTo(null); }}>
            <Text style={styles.clear}>Cualquier hora</Text>
          </Pressable>
        ) : null}
        <FieldError message={fieldErrors.time} />
        {picker ? (
          <View style={Platform.OS === 'ios' ? styles.iosPicker : undefined}>
            <DateTimePicker
              accentColor={colors.primary}
              is24Hour={false}
              mode="time"
              onDismiss={() => setPicker(null)}
              onValueChange={(_event, picked) => pick(picked)}
              positiveButton={{ label: 'Aceptar' }}
              value={fromClock((picker === 'from' ? timeFrom : timeTo) ?? '07:00')}
            />
            {Platform.OS === 'ios' ? <ButtonSecondary onPress={() => setPicker(null)} title="Listo" /> : null}
          </View>
        ) : null}

        <View style={styles.alertRow}>
          <Ionicons color={colors.primary} name="notifications-outline" size={20} />
          <View style={styles.flex}>
            <View style={styles.alertTitleRow}>
              <Text style={styles.alertTitle}>Avisarme de viajes nuevos</Text>
              {!can('smart_match_alerts') || isBetaPerk('smart_match_alerts') ? <PlusBadge compact /> : null}
            </View>
            <Text style={styles.hint}>Solo viajes compatibles con esta ruta y horario. Como máximo 3 avisos al día.</Text>
          </View>
          <Switch
            accessibilityLabel="Avisarme de viajes nuevos"
            onValueChange={toggleAlert}
            thumbColor={alert ? colors.primary : undefined}
            trackColor={{ true: colors.primaryLight }}
            value={alert}
          />
        </View>

        <ButtonPrimary loading={saving} onPress={() => void save()} title={existing ? 'Guardar cambios' : 'Guardar ruta'} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  flex: { flex: 1 },
  subtitle: { ...typography.body, color: colors.textSecondary },
  label: { ...typography.label, color: colors.text, marginBottom: -spacing[8] },
  hint: { ...typography.caption, color: colors.textSecondary },
  dayRow: { flexDirection: 'row', gap: spacing[4], justifyContent: 'space-between' },
  day: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.radiusFull,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  daySelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayText: { ...typography.bodySmall, color: colors.text, fontWeight: '700' },
  dayTextSelected: { color: colors.white },
  timeRow: { flexDirection: 'row', gap: spacing[8] },
  timeButton: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.radiusMedium,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing[8],
    height: 48,
    paddingHorizontal: spacing[12],
  },
  timeText: { ...typography.bodyMedium, color: colors.text },
  clear: { ...typography.bodySmall, color: colors.primary, fontWeight: '700' },
  iosPicker: { gap: spacing[8] },
  alertRow: {
    alignItems: 'center',
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing[12],
    padding: spacing[12],
  },
  alertTitleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  alertTitle: { ...typography.bodyMedium, color: colors.text, fontWeight: '700' },
});
