import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
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
    if (!origin) found.origin = t('routeEditor.errors.origin');
    if (!destination) found.destination = t('routeEditor.errors.destination');
    else if (origin && locationService.distanceKm(origin, destination) < 0.3) found.destination = t('routeEditor.errors.samePlace');
    if ((timeFrom === null) !== (timeTo === null) || (timeFrom && timeTo && timeFrom >= timeTo)) found.time = t('routeEditor.errors.time');
    setFieldErrors(found);
    if (Object.values(found).some(Boolean) || !origin || !destination) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await personalizationService.saveRoute({ name, origin, destination, days, timeFrom, timeTo, alert }, existing?.id);
      setSavedRoutes(existing ? routes.map((route) => (route.id === saved.id ? saved : route)) : [...routes, saved]);
      toast.success(alert ? t('routeEditor.savedWithAlert') : t('routeEditor.saved'));
      router.back();
    } catch (saveError) {
      const limit = planLimitFromError(rawErrorMessage(saveError));
      if (limit?.key === 'saved_routes') requirePlus({ limit: 'saved_routes' });
      setError(errorMessage(saveError, t('routeEditor.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ScreenHeader kicker={t('routeEditor.kicker')} title={existing ? t('routeEditor.editTitle') : t('routeEditor.newTitle')} />
        <Text style={styles.subtitle}>{t('routeEditor.subtitle')}</Text>
        {error ? <Notice tone="error">{error}</Notice> : null}

        <TextField label={t('routeEditor.name')} maxLength={40} onChangeText={setName} placeholder={t('routeEditor.namePlaceholder')} value={name} />
        <PlaceSearchField
          allowCurrentLocation
          error={fieldErrors.origin}
          label={t('routeEditor.from')}
          mapTitle={t('routeEditor.fromMap')}
          onChange={(place) => { setOrigin(place); setFieldErrors((current) => ({ ...current, origin: undefined })); }}
          placeholder={t('routeEditor.fromPlaceholder')}
          quickPlaces={savedPlaces}
          value={origin}
        />
        <PlaceSearchField
          error={fieldErrors.destination}
          label={t('routeEditor.to')}
          mapTitle={t('routeEditor.toMap')}
          near={origin}
          onChange={(place) => { setDestination(place); setFieldErrors((current) => ({ ...current, destination: undefined })); }}
          placeholder={t('routeEditor.toPlaceholder')}
          quickPlaces={savedPlaces.filter((place) => !origin || locationService.distanceKm(place, origin) >= 0.3)}
          value={destination}
        />

        <Text style={styles.label}>{t('routeEditor.days')}</Text>
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
        <Text style={styles.hint}>{days.length ? t('routeEditor.onlyThoseDays') : t('routeEditor.anyDay')}</Text>

        <Text style={styles.label}>{t('routeEditor.departure')}</Text>
        <View style={styles.timeRow}>
          <Pressable accessibilityLabel={t('routeEditor.fromTime')} onPress={() => setPicker('from')} style={styles.timeButton}>
            <Ionicons color={colors.primary} name="time-outline" size={18} />
            <Text style={styles.timeText}>{timeFrom ? t('routeEditor.fromClock', { time: formatClock(timeFrom) }) : t('routeEditor.anyTime')}</Text>
          </Pressable>
          {timeFrom ? (
            <Pressable accessibilityLabel={t('routeEditor.toTime')} onPress={() => setPicker('to')} style={styles.timeButton}>
              <Text style={styles.timeText}>{timeTo ? t('routeEditor.toClock', { time: formatClock(timeTo) }) : t('routeEditor.toOpen')}</Text>
            </Pressable>
          ) : null}
        </View>
        {timeFrom ? (
          <Pressable hitSlop={8} onPress={() => { setTimeFrom(null); setTimeTo(null); }}>
            <Text style={styles.clear}>{t('routeEditor.anyTime')}</Text>
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
              positiveButton={{ label: t('routeEditor.ok') }}
              value={fromClock((picker === 'from' ? timeFrom : timeTo) ?? '07:00')}
            />
            {Platform.OS === 'ios' ? <ButtonSecondary onPress={() => setPicker(null)} title={t('routeEditor.done')} /> : null}
          </View>
        ) : null}

        <View style={styles.alertRow}>
          <Ionicons color={colors.primary} name="notifications-outline" size={20} />
          <View style={styles.flex}>
            <View style={styles.alertTitleRow}>
              <Text style={styles.alertTitle}>{t('routeEditor.alert')}</Text>
              {!can('smart_match_alerts') || isBetaPerk('smart_match_alerts') ? <PlusBadge compact /> : null}
            </View>
            <Text style={styles.hint}>{t('routeEditor.alertHint')}</Text>
          </View>
          <Switch
            accessibilityLabel={t('routeEditor.alert')}
            onValueChange={toggleAlert}
            thumbColor={alert ? colors.primary : undefined}
            trackColor={{ true: colors.primaryLight }}
            value={alert}
          />
        </View>

        <ButtonPrimary loading={saving} onPress={() => void save()} title={existing ? t('routeEditor.saveChanges') : t('routeEditor.save')} />
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
  dayTextSelected: { color: colors.onPrimary },
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
