import { useCallback, useEffect, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { useTranslation } from 'react-i18next';

import { PlusBadge } from '@/components/subscription/PlusBadge';
import { requirePlus } from '@/components/subscription/PlusGate';
import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { toast } from '@/components/ui/Toast';
import { PlaceSearchField } from '@/components/forms/PlaceSearchField';
import { RoutePicker } from '@/components/map/RoutePicker';
import { DriverApprovalNotice } from '@/components/profile/DriverApprovalNotice';
import { FieldError, fieldErrorBox } from '@/components/forms/FieldError';
import { TextField } from '@/components/forms/TextField';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { locationService } from '@/services/locationService';
import { describeDays, recurringTripService, toLocalDate, WEEKDAYS } from '@/services/recurringTripService';
import { tripService, TripTemplate } from '@/services/tripService';
import { MAX_SEATS, vehicleService } from '@/services/vehicleService';
import { useAppStore } from '@/store/appStore';
import { usePlan } from '@/subscription/usePlan';
import { Location, TripRoute, Vehicle } from '@/types';
import { errorMessage, rawErrorMessage } from '@/utils/format';
import i18n, { localeTag } from '@/i18n';

type PickerMode = 'date' | 'time' | 'end' | null;

/** Next full half hour, at least 30 minutes from now. */
function defaultDeparture() {
  const date = new Date(Date.now() + 30 * 60_000);
  date.setMinutes(date.getMinutes() < 30 ? 30 : 60, 0, 0);
  return date;
}

/** Same time of day as `previous`, on the next day it is still at least 30 minutes away. */
function nextOccurrence(previous: string) {
  const old = new Date(previous);
  const next = new Date();
  next.setHours(old.getHours(), old.getMinutes(), 0, 0);
  while (next.getTime() < Date.now() + 30 * 60_000) next.setDate(next.getDate() + 1);
  return next;
}

function templatePlace(place: TripTemplate['origin']): Location | null {
  if (place.latitude === null || place.longitude === null) return null;
  return {
    id: `${place.latitude.toFixed(6)},${place.longitude.toFixed(6)}`,
    label: place.label,
    address: place.label,
    latitude: place.latitude,
    longitude: place.longitude,
  };
}

/** Problems found in the form, shown under each field. */
type FieldErrors = Partial<Record<'vehicle' | 'origin' | 'destination' | 'departure' | 'price' | 'seats' | 'days', string>>;

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** ISO weekday (1 = Monday … 7 = Sunday) of a date. */
function isoWeekday(date: Date) {
  return ((date.getDay() + 6) % 7) + 1;
}

/** "2026-10-07" → local Date at midnight. */
function fromLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export default function CreateTripScreen() {
  const { t } = useTranslation();
  // ?repeatFrom=<id> copies a previous trip; ?edit=<id> edits a published one;
  // ?recurring=<id> edits a weekly schedule.
  // ?weekly=1 starts a new weekly schedule.
  const { repeatFrom, edit, recurring, weekly: startWeekly, destLat, destLng, destLabel } = useLocalSearchParams<{
    repeatFrom?: string;
    edit?: string;
    recurring?: string;
    weekly?: string;
    // "Planear un viaje hacia aquí" from the map or the driver home.
    destLat?: string;
    destLng?: string;
    destLabel?: string;
  }>();
  const sourceId = edit ?? repeatFrom;
  const [acceptedCount, setAcceptedCount] = useState(0);
  const [editable, setEditable] = useState(true);
  const driverStatus = useAppStore((state) => state.currentUser?.driverStatus);
  const savedPlaces = useAppStore((state) => state.savedPlaces);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const { isPlus, atLimit, can, isBetaPerk } = usePlan();
  // Weekly schedule: the server publishes each trip up to 7 days ahead.
  const [weekly, setWeekly] = useState(!!recurring || startWeekly === '1');
  const [days, setDays] = useState<number[]>(() => (startWeekly === '1' && !recurring ? [isoWeekday(defaultDeparture())] : []));
  const [endDate, setEndDate] = useState<Date | null>(null);
  const vehiclesFull = atLimit('vehicles', vehicles.length);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [vehicleLoaded, setVehicleLoaded] = useState(false);
  const [origin, setOrigin] = useState<Location | null>(null);
  const [destination, setDestination] = useState<Location | null>(null);
  const [departure, setDeparture] = useState(defaultDeparture);
  const [picker, setPicker] = useState<PickerMode>(null);
  const [price, setPrice] = useState('');
  const [seats, setSeats] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);
  const [repeated, setRepeated] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [route, setRoute] = useState<TripRoute | null>(null);
  // Route of the trip being repeated or edited, used as the starting choice.
  // Only applies while the trip keeps the same endpoints (`key`).
  const [templateRoute, setTemplateRoute] = useState<{ key: string; route: TripRoute } | null>(null);

  const vehicle = vehicles.find((item) => item.id === vehicleId);

  // Reload on focus: the driver may come back from adding or editing a vehicle.
  useFocusEffect(
    useCallback(() => {
      void vehicleService.getMyVehicles().then((saved) => {
        setVehicles(saved);
        // Keep the driver's choice while it still exists; otherwise the newest vehicle.
        setVehicleId((current) => (current && saved.some((item) => item.id === current) ? current : saved[0]?.id ?? null));
        if (saved[0]) setSeats((current) => current || String(Math.min(saved[0].seats ?? 1, MAX_SEATS)));
      }).catch(() => setError(i18n.t('createTrip.vehiclesFailed')))
        .finally(() => setVehicleLoaded(true));
    }, []),
  );

  // A destination chosen on the map or in the driver home search.
  useEffect(() => {
    const latitude = Number(destLat);
    const longitude = Number(destLng);
    if (sourceId || recurring || !destLat || !destLng || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const label = destLabel || i18n.t('createTrip.mapDestination');
    const timer = setTimeout(() => setDestination({
      id: `${latitude.toFixed(6)},${longitude.toFixed(6)}`,
      label,
      address: label,
      latitude,
      longitude,
    }), 0);
    return () => clearTimeout(timer);
  }, [destLabel, destLat, destLng, recurring, sourceId]);

  // Prefill from a weekly schedule being edited.
  useEffect(() => {
    if (!recurring) return;
    let active = true;
    void recurringTripService.getMine().then((schedules) => {
      if (!active) return;
      const schedule = schedules.find((item) => item.id === recurring);
      if (!schedule) {
        setError(i18n.t('createTrip.recurringNotFound'));
        return;
      }
      setOrigin(schedule.origin);
      setDestination(schedule.destination);
      if (schedule.route) setTemplateRoute({ key: `${schedule.origin.id}>${schedule.destination.id}`, route: schedule.route });
      setVehicleId(schedule.vehicleId);
      setSeats(String(Math.min(schedule.totalSeats, MAX_SEATS)));
      setPrice(String(schedule.price));
      setDescription(schedule.description ?? '');
      const [hours, minutes] = schedule.time.split(':').map(Number);
      const start = fromLocalDate(schedule.startDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const first = start < today ? today : start;
      first.setHours(hours, minutes, 0, 0);
      setDeparture(first);
      setDays(schedule.days);
      setEndDate(schedule.endDate ? fromLocalDate(schedule.endDate) : null);
    }).catch((loadError) => active && setError(errorMessage(loadError, i18n.t('createTrip.recurringLoadFailed'))));
    return () => { active = false; };
  }, [recurring]);

  const toggleWeekly = (value: boolean) => {
    if (value && !can('recurring_trips')) {
      requirePlus({ capability: 'recurring_trips' });
      return;
    }
    setWeekly(value);
    // Start with the weekday of the chosen date.
    if (value && !days.length) setDays([isoWeekday(departure)]);
    clearFieldError('days');
  };

  // Prefill from an existing trip. Repeating moves the date forward; editing keeps it.
  useEffect(() => {
    if (!sourceId) return;
    let active = true;
    void tripService.getTripTemplate(sourceId).then((template) => {
      if (!active) return;
      if (!template) {
        setError(i18n.t('createTrip.tripNotFound'));
        return;
      }
      const templateOrigin = templatePlace(template.origin);
      const templateDestination = templatePlace(template.destination);
      setOrigin(templateOrigin);
      setDestination(templateDestination);
      if (template.route && templateOrigin && templateDestination) {
        setTemplateRoute({ key: `${templateOrigin.id}>${templateDestination.id}`, route: template.route });
      }
      setVehicleId(template.vehicleId);
      setSeats(String(Math.min(template.totalSeats, MAX_SEATS)));
      setPrice(String(template.price));
      setDescription(template.description ?? '');
      if (edit) {
        setDeparture(new Date(template.departureAt));
        setAcceptedCount(template.acceptedCount);
        if (template.status !== 'por_empezar') {
          setEditable(false);
          setError(i18n.t('createTrip.notEditable'));
        }
      } else {
        setDeparture(nextOccurrence(template.departureAt));
      }
      setRepeated(true);
    }).catch((loadError) => active && setError(errorMessage(loadError, i18n.t('createTrip.tripLoadFailed'))));
    return () => { active = false; };
  }, [edit, sourceId]);

  const applyPicked = (picked: Date) => {
    setPicker(null);
    setDeparture((current) => {
      const next = new Date(current);
      if (picker === 'date') next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
      else next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
      return next;
    });
  };

  const applyEndDate = (picked: Date) => {
    setPicker(null);
    const end = new Date(picked);
    end.setHours(0, 0, 0, 0);
    setEndDate(end);
  };

  const validate = () => {
    const parsedPrice = Number(price);
    const parsedSeats = Number(seats);
    const found: FieldErrors = {};
    if (!vehicle) found.vehicle = vehicles.length ? t('createTrip.errors.pickVehicle') : t('createTrip.errors.noVehicle');
    else if (!vehicle.photoUrl && !edit) found.vehicle = t('createTrip.errors.vehiclePhoto');
    if (!origin) found.origin = t('createTrip.errors.origin');
    if (!destination) found.destination = t('createTrip.errors.destination');
    else if (origin && locationService.distanceKm(origin, destination) < 0.3) found.destination = t('createTrip.errors.sameEnds');
    if (weekly) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (departure < today) found.departure = t('createTrip.errors.startPast');
      if (!days.length) found.days = t('createTrip.errors.days');
      else if (endDate && endDate < new Date(departure.getFullYear(), departure.getMonth(), departure.getDate())) {
        found.days = t('createTrip.errors.endBeforeStart');
      }
    } else if (departure <= new Date()) found.departure = t('createTrip.errors.departurePast');
    if (!price.trim()) found.price = t('createTrip.errors.price');
    else if (!Number.isInteger(parsedPrice) || parsedPrice < 0) found.price = t('createTrip.errors.priceNumber');
    if (!Number.isInteger(parsedSeats) || parsedSeats < 1 || parsedSeats > MAX_SEATS) found.seats = t('createTrip.errors.seatsRange', { max: MAX_SEATS });
    else if (vehicle && parsedSeats > (vehicle.seats ?? MAX_SEATS)) {
      found.seats = t('createTrip.errors.seatsVehicle', { count: vehicle.seats, seats: parsedSeats });
    }
    return found;
  };

  const clearFieldError = (key: keyof FieldErrors) => {
    setFieldErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };

  const publishTrip = async () => {
    const parsedPrice = Number(price);
    const parsedSeats = Number(seats);
    const found = validate();
    setFieldErrors(found);
    if (Object.values(found).some(Boolean) || !vehicle || !origin || !destination) {
      setError(null);
      return;
    }
    setError(null);
    setNotice(null);
    setLoading(true);
    const input = {
      vehicleId: vehicle.id,
      originName: origin.label,
      originLat: origin.latitude,
      originLng: origin.longitude,
      destinationName: destination.label,
      destinationLat: destination.latitude,
      destinationLng: destination.longitude,
      departureAt: departure.toISOString(),
      price: parsedPrice,
      totalSeats: parsedSeats,
      description: description.trim() || undefined,
      route,
    };
    try {
      if (weekly) {
        const pad = (value: number) => String(value).padStart(2, '0');
        const result = await recurringTripService.save({
          vehicleId: vehicle.id,
          origin,
          destination,
          route,
          time: `${pad(departure.getHours())}:${pad(departure.getMinutes())}`,
          days,
          startDate: toLocalDate(departure),
          endDate: endDate ? toLocalDate(endDate) : null,
          price: parsedPrice,
          totalSeats: parsedSeats,
          description: description.trim() || undefined,
        }, recurring);
        toast.success(result.created
          ? t('createTrip.recurringCreated', { count: result.created })
          : t('createTrip.recurringSaved'));
        router.replace('/recurring-trips');
        return;
      }
      if (edit) {
        const { changes, notified } = await tripService.updateTrip(edit, input);
        if (!changes.length) {
          setNotice(t('createTrip.noChanges'));
          return;
        }
        setNotice(notified
          ? t('createTrip.updatedNotified', { count: notified, changes: changes.join('; ') })
          : t('createTrip.updated'));
        setTimeout(() => router.back(), 1800);
        return;
      }
      await tripService.createTrip(input);
      toast.success(t('createTrip.published'));
      router.replace('/(tabs)/trips');
    } catch (publishError) {
      setError(rawErrorMessage(publishError).includes('row-level security')
        ? t('createTrip.notVerified')
        : errorMessage(publishError, t('createTrip.publishFailed')));
    } finally {
      setLoading(false);
    }
  };

  const dateLabel = departure.toLocaleDateString(localeTag(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const timeLabel = departure.toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' });

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ScreenHeader
          kicker={t(`createTrip.kicker.${edit ? 'edit' : recurring ? 'recurring' : repeatFrom ? 'repeat' : 'new'}`)}
          title={t(`createTrip.title.${edit ? 'edit' : recurring ? 'recurring' : 'new'}`)}
        />
        {repeated && !edit ? (
          <View style={styles.repeatBanner}>
            <Ionicons color={colors.primary} name="repeat" size={20} />
            <Text style={styles.repeatText}>{t('createTrip.repeated')}</Text>
          </View>
        ) : null}
        {edit && acceptedCount > 0 ? (
          <View style={styles.repeatBanner}>
            <Ionicons color={colors.warning} name="notifications-outline" size={20} />
            <Text style={styles.repeatText}>
              {t('createTrip.accepted', { count: acceptedCount })}
            </Text>
          </View>
        ) : null}
        {notice ? <Notice tone="success">{notice}</Notice> : null}
        {driverStatus !== 'aprobado' ? <DriverApprovalNotice status={driverStatus} /> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}

        <Text style={styles.label}>{t('createTrip.vehicle')}</Text>
        {!vehicleLoaded ? <Text style={styles.subtitle}>{t('createTrip.loadingVehicles')}</Text> : null}
        {vehicleLoaded && !vehicles.length ? (
          <ButtonSecondary onPress={() => router.push('/vehicle')} title={t('createTrip.registerVehicle')} />
        ) : null}
        {vehicles.length ? (
          <ScrollView contentContainerStyle={styles.vehicleRow} horizontal showsHorizontalScrollIndicator={false} style={styles.vehicleScroll}>
            {vehicles.map((item) => {
              const selected = item.id === vehicleId;
              return (
                <Pressable
                  accessibilityLabel={t('createTrip.vehicleOption', { brand: item.brand, plate: item.plate })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  key={item.id}
                  onPress={() => {
                    setVehicleId(item.id);
                    clearFieldError('vehicle');
                  }}
                  style={[styles.vehicleCard, selected ? styles.vehicleCardSelected : null]}
                >
                  {item.photoUrl ? (
                    <Image source={{ uri: item.photoUrl }} style={styles.vehiclePhoto} />
                  ) : (
                    <View style={[styles.vehiclePhoto, styles.vehiclePhotoMissing]}>
                      <Ionicons color={colors.error} name="camera-outline" size={22} />
                    </View>
                  )}
                  <Text numberOfLines={1} style={styles.vehicleName}>{item.brand}</Text>
                  <Text style={styles.vehicleMeta}>{item.seats ? t('createTrip.vehicleSeats', { plate: item.plate, count: item.seats }) : item.plate}</Text>
                </Pressable>
              );
            })}
            {!vehiclesFull || !isPlus ? (
              <Pressable
                accessibilityLabel={t('createTrip.addVehicle')}
                onPress={() => (vehiclesFull ? requirePlus({ limit: 'vehicles' }) : router.push('/vehicle'))}
                style={[styles.vehicleCard, styles.vehicleAdd]}
              >
                <Ionicons color={colors.primary} name="add-circle-outline" size={28} />
                <Text style={styles.vehicleMeta}>{t('createTrip.add')}</Text>
                {vehiclesFull ? <PlusBadge /> : null}
              </Pressable>
            ) : null}
          </ScrollView>
        ) : null}
        <FieldError message={fieldErrors.vehicle} />
        {vehicle && !vehicle.photoUrl ? (
          <Pressable onPress={() => router.push({ pathname: '/vehicle', params: { id: vehicle.id } })} style={styles.seatWarning}>
            <Ionicons color={colors.error} name="camera-outline" size={18} />
            <Text style={styles.seatWarningText}>{t('createTrip.noPhoto')}</Text>
          </Pressable>
        ) : null}

        <PlaceSearchField
          allowCurrentLocation
          error={fieldErrors.origin}
          label={t('createTrip.originLabel')}
          mapTitle={t('createTrip.originMapTitle')}
          onChange={(place) => {
            setOrigin(place);
            clearFieldError('origin');
          }}
          placeholder={t('createTrip.originPlaceholder')}
          quickPlaces={savedPlaces}
          value={origin}
        />
        <PlaceSearchField
          error={fieldErrors.destination}
          label={t('createTrip.destinationLabel')}
          mapTitle={t('createTrip.destinationMapTitle')}
          near={origin}
          onChange={(place) => {
            setDestination(place);
            clearFieldError('destination');
          }}
          placeholder={t('createTrip.destinationPlaceholder')}
          // Don't offer the place already chosen as the departure.
          quickPlaces={savedPlaces.filter((place) => !origin || locationService.distanceKm(place, origin) >= 0.3)}
          value={destination}
        />

        {origin && destination ? (
          <>
            <Text style={styles.label}>{t('createTrip.route')}</Text>
            <Text style={styles.subtitle}>{t('createTrip.routeHint')}</Text>
            <RoutePicker
              destination={destination}
              initialRoute={templateRoute?.key === `${origin.id}>${destination.id}` ? templateRoute.route : undefined}
              key={`${origin.id}>${destination.id}`}
              onChange={setRoute}
              origin={origin}
            />
          </>
        ) : null}

        <Text style={styles.label}>{weekly ? t('createTrip.firstDeparture') : t('createTrip.departure')}</Text>
        <View style={styles.dateRow}>
          <Pressable accessibilityLabel={t('createTrip.pickDate')} onPress={() => setPicker('date')} style={[styles.dateButton, fieldErrors.departure ? fieldErrorBox : null]}>
            <Ionicons color={colors.primary} name="calendar-outline" size={20} />
            <Text style={styles.dateText}>{dateLabel}</Text>
          </Pressable>
          <Pressable accessibilityLabel={t('createTrip.pickTime')} onPress={() => setPicker('time')} style={[styles.dateButton, fieldErrors.departure ? fieldErrorBox : null]}>
            <Ionicons color={colors.primary} name="time-outline" size={20} />
            <Text style={styles.dateText}>{timeLabel}</Text>
          </Pressable>
        </View>
        <FieldError message={fieldErrors.departure} />

        {!edit ? (
          <View style={styles.weeklyBox}>
            <View style={styles.weeklyHeader}>
              <Ionicons color={colors.primary} name="sync-outline" size={20} />
              <View style={styles.flex}>
                <View style={styles.weeklyTitleRow}>
                  <Text style={styles.weeklyTitle}>{t('createTrip.weekly')}</Text>
                  {!can('recurring_trips') || isBetaPerk('recurring_trips') ? <PlusBadge compact /> : null}
                </View>
                <Text style={styles.weeklyText}>
                  {weekly
                    ? t('createTrip.weeklyOn', { when: days.length ? `${capitalize(describeDays(days))}, ${timeLabel}` : t('createTrip.weeklyPickDays') })
                    : t('createTrip.weeklyOff')}
                </Text>
              </View>
              <Switch
                accessibilityLabel={t('createTrip.weekly')}
                disabled={!!recurring}
                onValueChange={toggleWeekly}
                thumbColor={weekly ? colors.primary : undefined}
                trackColor={{ true: colors.primaryLight }}
                value={weekly}
              />
            </View>
            {weekly ? (
              <>
                <View accessibilityRole="radiogroup" style={styles.dayRow}>
                  {WEEKDAYS.map(({ day, short, long }) => {
                    const selected = days.includes(day);
                    return (
                      <Pressable
                        accessibilityLabel={long}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selected }}
                        key={day}
                        onPress={() => {
                          setDays((current) => (selected ? current.filter((item) => item !== day) : [...current, day].sort((a, b) => a - b)));
                          clearFieldError('days');
                        }}
                        style={[styles.day, selected ? styles.daySelected : null]}
                      >
                        <Text style={[styles.dayText, selected ? styles.dayTextSelected : null]}>{short}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <FieldError message={fieldErrors.days} />
                <View style={styles.endRow}>
                  <Pressable accessibilityLabel={t('createTrip.pickEndDate')} onPress={() => setPicker('end')} style={styles.endButton}>
                    <Ionicons color={colors.primary} name="flag-outline" size={16} />
                    <Text style={styles.endText}>
                      {endDate
                        ? t('createTrip.until', { date: endDate.toLocaleDateString(localeTag(), { day: 'numeric', month: 'short', year: 'numeric' }) })
                        : t('createTrip.noEndDate')}
                    </Text>
                  </Pressable>
                  {endDate ? (
                    <Pressable hitSlop={8} onPress={() => setEndDate(null)}>
                      <Text style={styles.endClear}>{t('common.remove')}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </>
            ) : null}
          </View>
        ) : null}

        {picker === 'end' ? (
          <View style={Platform.OS === 'ios' ? styles.iosPicker : undefined}>
            <DateTimePicker
              accentColor={colors.primary}
              minimumDate={departure}
              mode="date"
              onDismiss={() => setPicker(null)}
              onValueChange={(_event, picked) => (Platform.OS === 'ios' ? setEndDate(picked) : applyEndDate(picked))}
              positiveButton={{ label: t('common.accept') }}
              value={endDate ?? departure}
            />
            {Platform.OS === 'ios' ? <ButtonSecondary onPress={() => setPicker(null)} title={t('common.done')} /> : null}
          </View>
        ) : null}
        {picker && picker !== 'end' ? (
          <View style={Platform.OS === 'ios' ? styles.iosPicker : undefined}>
            <DateTimePicker
              accentColor={colors.primary}
              is24Hour={false}
              minimumDate={picker === 'date' ? new Date() : undefined}
              mode={picker}
              onDismiss={() => setPicker(null)}
              onValueChange={(_event, picked) => {
                clearFieldError('departure');
                // iOS pickers are inline and report every change; keep them open until "Listo".
                if (Platform.OS === 'ios') {
                  setDeparture((current) => {
                    const next = new Date(current);
                    if (picker === 'date') next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
                    else next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
                    return next;
                  });
                } else {
                  applyPicked(picked);
                }
              }}
              positiveButton={{ label: t('common.accept') }}
              value={departure}
            />
            {Platform.OS === 'ios' ? <ButtonSecondary onPress={() => setPicker(null)} title={t('common.done')} /> : null}
          </View>
        ) : null}

        <TextField
          error={fieldErrors.price}
          hint={t('createTrip.priceHint')}
          keyboardType="number-pad"
          label={t('createTrip.priceLabel')}
          onChangeText={(text) => {
            setPrice(text);
            clearFieldError('price');
          }}
          placeholder={t('createTrip.pricePlaceholder')}
          value={price}
        />
        <Text style={styles.label}>{t('createTrip.seatsLabel')}</Text>
        <View accessibilityRole="radiogroup" style={styles.seatRow}>
          {Array.from({ length: MAX_SEATS }, (_, index) => String(index + 1)).map((value) => {
            const selected = seats === value;
            return (
              <Pressable
                accessibilityLabel={t('createTrip.seats', { count: Number(value) })}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                key={value}
                onPress={() => {
                  setSeats(value);
                  clearFieldError('seats');
                }}
                style={[styles.seat, selected ? styles.seatSelected : null]}
              >
                <Text style={[styles.seatText, selected ? styles.seatTextSelected : null]}>{value}</Text>
              </Pressable>
            );
          })}
        </View>
        <FieldError message={fieldErrors.seats} />
        {vehicle && Number(seats) > (vehicle.seats ?? MAX_SEATS) ? (
          <Pressable onPress={() => router.push({ pathname: '/vehicle', params: { id: vehicle.id } })} style={styles.seatWarning}>
            <Ionicons color={colors.primary} name="car-outline" size={18} />
            <Text style={styles.seatWarningText}>
              {t('createTrip.vehicleSeatsWarning', { count: vehicle.seats })}
            </Text>
          </Pressable>
        ) : null}
        <TextField label={t('createTrip.descriptionLabel')} onChangeText={setDescription} placeholder={t('createTrip.descriptionPlaceholder')} value={description} />
        <ButtonPrimary
          disabled={driverStatus !== 'aprobado' || !editable}
          loading={loading}
          onPress={publishTrip}
          title={edit || recurring ? t('createTrip.saveChanges') : weekly ? t('createTrip.saveRecurring') : t('createTrip.publish')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  subtitle: { ...typography.body, color: colors.textSecondary },
  label: { ...typography.label, color: colors.text, marginBottom: -spacing[8] },
  dateRow: { flexDirection: 'row', gap: spacing[8] },
  dateButton: {
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
  dateText: { ...typography.bodyMedium, color: colors.text },
  iosPicker: { gap: spacing[8] },
  flex: { flex: 1 },
  weeklyBox: {
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    gap: spacing[12],
    padding: spacing[12],
  },
  weeklyHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing[12] },
  weeklyTitleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  weeklyTitle: { ...typography.bodyMedium, color: colors.text, fontWeight: '700' },
  weeklyText: { ...typography.caption, color: colors.textSecondary },
  dayRow: { flexDirection: 'row', gap: spacing[4], justifyContent: 'space-between' },
  day: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.radiusFull,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  daySelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayText: { ...typography.bodySmall, color: colors.text, fontWeight: '700' },
  dayTextSelected: { color: colors.onPrimary },
  endRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[12], justifyContent: 'space-between' },
  endButton: { alignItems: 'center', flexDirection: 'row', gap: spacing[4] },
  endText: { ...typography.bodySmall, color: colors.text, fontWeight: '600' },
  endClear: { ...typography.bodySmall, color: colors.primary, fontWeight: '700' },
  repeatBanner: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusLarge,
    flexDirection: 'row',
    gap: spacing[12],
    padding: spacing[16],
  },
  repeatText: { ...typography.bodySmall, color: colors.text, flex: 1 },
  vehicleScroll: { flexGrow: 0 },
  vehicleRow: { gap: spacing[8], paddingVertical: spacing[4] },
  vehicleCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.radiusMedium,
    borderWidth: 1.5,
    gap: 2,
    padding: spacing[8],
    width: 150,
  },
  vehicleCardSelected: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  vehiclePhoto: { aspectRatio: 4 / 3, backgroundColor: colors.lightGray, borderRadius: radius.radiusSmall, marginBottom: spacing[4], width: '100%' },
  vehiclePhotoMissing: { alignItems: 'center', backgroundColor: colors.errorLight, justifyContent: 'center' },
  vehicleName: { ...typography.bodySmall, color: colors.text, fontWeight: '700' },
  vehicleMeta: { ...typography.caption, color: colors.textSecondary },
  vehicleAdd: { alignItems: 'center', borderStyle: 'dashed', justifyContent: 'center', minHeight: 150 },
  seatRow: { flexDirection: 'row', gap: spacing[8] },
  seat: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.radiusMedium,
    borderWidth: 1,
    flex: 1,
    height: 48,
    justifyContent: 'center',
  },
  seatSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  seatText: { ...typography.bodyMedium, color: colors.text, fontWeight: '600' },
  seatTextSelected: { color: colors.onPrimary },
  seatWarning: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusMedium,
    flexDirection: 'row',
    gap: spacing[8],
    padding: spacing[12],
  },
  seatWarningText: { ...typography.bodySmall, color: colors.text, flex: 1 },
  error: { ...typography.bodySmall, backgroundColor: colors.errorLight, color: colors.error, padding: spacing[12] },
  success: { ...typography.bodySmall, backgroundColor: colors.primaryLight, color: colors.primary, padding: spacing[12] },
});
