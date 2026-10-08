import { useCallback, useEffect, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { DateTimePicker } from '@expo/ui/community/datetime-picker';

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
import { tripService, TripTemplate } from '@/services/tripService';
import { MAX_SEATS, vehicleService } from '@/services/vehicleService';
import { useAppStore } from '@/store/appStore';
import { usePlan } from '@/subscription/usePlan';
import { Location, TripRoute, Vehicle } from '@/types';
import { errorMessage, rawErrorMessage } from '@/utils/format';

type PickerMode = 'date' | 'time' | null;

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
type FieldErrors = Partial<Record<'vehicle' | 'origin' | 'destination' | 'departure' | 'price' | 'seats', string>>;

export default function CreateTripScreen() {
  // ?repeatFrom=<id> copies a previous trip; ?edit=<id> edits a published one.
  const { repeatFrom, edit, destLat, destLng, destLabel } = useLocalSearchParams<{
    repeatFrom?: string;
    edit?: string;
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
  const { isPlus, atLimit } = usePlan();
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
      }).catch(() => setError('No se pudieron cargar tus vehículos.'))
        .finally(() => setVehicleLoaded(true));
    }, []),
  );

  // A destination chosen on the map or in the driver home search.
  useEffect(() => {
    const latitude = Number(destLat);
    const longitude = Number(destLng);
    if (sourceId || !destLat || !destLng || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const label = destLabel || 'Destino elegido en el mapa';
    const timer = setTimeout(() => setDestination({
      id: `${latitude.toFixed(6)},${longitude.toFixed(6)}`,
      label,
      address: label,
      latitude,
      longitude,
    }), 0);
    return () => clearTimeout(timer);
  }, [destLabel, destLat, destLng, sourceId]);

  // Prefill from an existing trip. Repeating moves the date forward; editing keeps it.
  useEffect(() => {
    if (!sourceId) return;
    let active = true;
    void tripService.getTripTemplate(sourceId).then((template) => {
      if (!active) return;
      if (!template) {
        setError('No se encontró el viaje.');
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
          setError('Este viaje ya empezó o terminó, así que no se puede editar.');
        }
      } else {
        setDeparture(nextOccurrence(template.departureAt));
      }
      setRepeated(true);
    }).catch((loadError) => active && setError(errorMessage(loadError, 'No se pudo cargar el viaje.')));
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

  const validate = () => {
    const parsedPrice = Number(price);
    const parsedSeats = Number(seats);
    const found: FieldErrors = {};
    if (!vehicle) found.vehicle = vehicles.length ? 'Elige el vehículo del viaje.' : 'Registra un vehículo antes de publicar un viaje.';
    else if (!vehicle.photoUrl && !edit) found.vehicle = 'Agrega una foto de este vehículo: los pasajeros la ven antes de pedir un cupo.';
    if (!origin) found.origin = 'Elige el punto de salida.';
    if (!destination) found.destination = 'Elige el destino.';
    else if (origin && locationService.distanceKm(origin, destination) < 0.3) found.destination = 'El destino debe ser distinto al punto de salida.';
    if (departure <= new Date()) found.departure = 'La salida debe ser en el futuro.';
    if (!price.trim()) found.price = 'Escribe el precio por cupo.';
    else if (!Number.isInteger(parsedPrice) || parsedPrice < 0) found.price = 'Escribe solo números, sin puntos ni decimales.';
    if (!Number.isInteger(parsedSeats) || parsedSeats < 1 || parsedSeats > MAX_SEATS) found.seats = `Elige entre 1 y ${MAX_SEATS} cupos.`;
    else if (vehicle && parsedSeats > (vehicle.seats ?? MAX_SEATS)) {
      found.seats = `Tu vehículo tiene ${vehicle.seats} puesto${vehicle.seats === 1 ? '' : 's'} para pasajeros. Actualízalo para ofrecer ${parsedSeats} cupos.`;
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
      if (edit) {
        const { changes, notified } = await tripService.updateTrip(edit, input);
        if (!changes.length) {
          setNotice('No hiciste cambios.');
          return;
        }
        setNotice(notified
          ? `Viaje actualizado. Avisamos a ${notified} pasajero${notified === 1 ? '' : 's'}: ${changes.join('; ')}.`
          : 'Viaje actualizado.');
        setTimeout(() => router.back(), 1800);
        return;
      }
      await tripService.createTrip(input);
      toast.success('¡Viaje publicado! Te avisaremos cuando alguien pida un cupo');
      router.replace('/(tabs)/trips');
    } catch (publishError) {
      setError(rawErrorMessage(publishError).includes('row-level security')
        ? 'Solo conductores con identidad verificada pueden publicar viajes. Verifícate desde tu perfil.'
        : errorMessage(publishError, 'No se pudo publicar el viaje.'));
    } finally {
      setLoading(false);
    }
  };

  const dateLabel = departure.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const timeLabel = departure.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ScreenHeader kicker={edit ? 'VIAJE PUBLICADO' : repeatFrom ? 'REPETIR VIAJE' : 'NUEVO VIAJE'} title={edit ? 'Editar viaje' : 'Publicar viaje'} />
        {repeated && !edit ? (
          <View style={styles.repeatBanner}>
            <Ionicons color={colors.primary} name="repeat" size={20} />
            <Text style={styles.repeatText}>Copiamos tu viaje anterior. Revisa la fecha y la hora, cambia lo que necesites y publícalo.</Text>
          </View>
        ) : null}
        {edit && acceptedCount > 0 ? (
          <View style={styles.repeatBanner}>
            <Ionicons color={colors.warning} name="notifications-outline" size={20} />
            <Text style={styles.repeatText}>
              Tienes {acceptedCount} pasajero{acceptedCount === 1 ? '' : 's'} aceptado{acceptedCount === 1 ? '' : 's'}. Les avisaremos qué cambiaste.
            </Text>
          </View>
        ) : null}
        {notice ? <Notice tone="success">{notice}</Notice> : null}
        {driverStatus !== 'aprobado' ? <DriverApprovalNotice status={driverStatus} /> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}

        <Text style={styles.label}>Vehículo</Text>
        {!vehicleLoaded ? <Text style={styles.subtitle}>Cargando tus vehículos…</Text> : null}
        {vehicleLoaded && !vehicles.length ? (
          <ButtonSecondary onPress={() => router.push('/vehicle')} title="Registrar un vehículo" />
        ) : null}
        {vehicles.length ? (
          <ScrollView contentContainerStyle={styles.vehicleRow} horizontal showsHorizontalScrollIndicator={false} style={styles.vehicleScroll}>
            {vehicles.map((item) => {
              const selected = item.id === vehicleId;
              return (
                <Pressable
                  accessibilityLabel={`Vehículo ${item.brand} ${item.plate}`}
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
                  <Text style={styles.vehicleMeta}>{item.plate} · {item.seats} puestos</Text>
                </Pressable>
              );
            })}
            {!vehiclesFull || !isPlus ? (
              <Pressable
                accessibilityLabel="Agregar vehículo"
                onPress={() => (vehiclesFull ? requirePlus({ limit: 'vehicles' }) : router.push('/vehicle'))}
                style={[styles.vehicleCard, styles.vehicleAdd]}
              >
                <Ionicons color={colors.primary} name="add-circle-outline" size={28} />
                <Text style={styles.vehicleMeta}>Agregar</Text>
                {vehiclesFull ? <PlusBadge /> : null}
              </Pressable>
            ) : null}
          </ScrollView>
        ) : null}
        <FieldError message={fieldErrors.vehicle} />
        {vehicle && !vehicle.photoUrl ? (
          <Pressable onPress={() => router.push({ pathname: '/vehicle', params: { id: vehicle.id } })} style={styles.seatWarning}>
            <Ionicons color={colors.error} name="camera-outline" size={18} />
            <Text style={styles.seatWarningText}>Este vehículo no tiene foto. Toca aquí para agregarla antes de publicar.</Text>
          </Pressable>
        ) : null}

        <PlaceSearchField
          allowCurrentLocation
          error={fieldErrors.origin}
          label="Salida"
          mapTitle="Punto de salida"
          onChange={(place) => {
            setOrigin(place);
            clearFieldError('origin');
          }}
          placeholder="Busca el punto de salida"
          quickPlaces={savedPlaces}
          value={origin}
        />
        <PlaceSearchField
          error={fieldErrors.destination}
          label="Destino"
          mapTitle="Destino del viaje"
          near={origin}
          onChange={(place) => {
            setDestination(place);
            clearFieldError('destination');
          }}
          placeholder="Busca el destino del viaje"
          // Don't offer the place already chosen as the departure.
          quickPlaces={savedPlaces.filter((place) => !origin || locationService.distanceKm(place, origin) >= 0.3)}
          value={destination}
        />

        {origin && destination ? (
          <>
            <Text style={styles.label}>Ruta</Text>
            <Text style={styles.subtitle}>Elige por dónde vas. Los pasajeros verán esta ruta antes de pedir un cupo.</Text>
            <RoutePicker
              destination={destination}
              initialRoute={templateRoute?.key === `${origin.id}>${destination.id}` ? templateRoute.route : undefined}
              key={`${origin.id}>${destination.id}`}
              onChange={setRoute}
              origin={origin}
            />
          </>
        ) : null}

        <Text style={styles.label}>Fecha y hora de salida</Text>
        <View style={styles.dateRow}>
          <Pressable accessibilityLabel="Elegir fecha" onPress={() => setPicker('date')} style={[styles.dateButton, fieldErrors.departure ? fieldErrorBox : null]}>
            <Ionicons color={colors.primary} name="calendar-outline" size={20} />
            <Text style={styles.dateText}>{dateLabel}</Text>
          </Pressable>
          <Pressable accessibilityLabel="Elegir hora" onPress={() => setPicker('time')} style={[styles.dateButton, fieldErrors.departure ? fieldErrorBox : null]}>
            <Ionicons color={colors.primary} name="time-outline" size={20} />
            <Text style={styles.dateText}>{timeLabel}</Text>
          </Pressable>
        </View>
        <FieldError message={fieldErrors.departure} />
        {picker ? (
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
              positiveButton={{ label: 'Aceptar' }}
              value={departure}
            />
            {Platform.OS === 'ios' ? <ButtonSecondary onPress={() => setPicker(null)} title="Listo" /> : null}
          </View>
        ) : null}

        <TextField
          error={fieldErrors.price}
          hint="En pesos colombianos, solo números."
          keyboardType="number-pad"
          label="Precio por cupo (COP)"
          onChangeText={(text) => {
            setPrice(text);
            clearFieldError('price');
          }}
          placeholder="Valor por cupo"
          value={price}
        />
        <Text style={styles.label}>Cupos para pasajeros</Text>
        <View accessibilityRole="radiogroup" style={styles.seatRow}>
          {Array.from({ length: MAX_SEATS }, (_, index) => String(index + 1)).map((value) => {
            const selected = seats === value;
            return (
              <Pressable
                accessibilityLabel={`${value} cupo${value === '1' ? '' : 's'}`}
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
              Tu vehículo tiene {vehicle.seats} puesto{vehicle.seats === 1 ? '' : 's'} registrados. Toca aquí para actualizarlo.
            </Text>
          </Pressable>
        ) : null}
        <TextField label="Descripción (opcional)" onChangeText={setDescription} placeholder="Punto de encuentro y detalles" value={description} />
        <ButtonPrimary
          disabled={driverStatus !== 'aprobado' || !editable}
          loading={loading}
          onPress={publishTrip}
          title={edit ? 'Guardar cambios' : 'Publicar viaje'}
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
  vehiclePhotoMissing: { alignItems: 'center', backgroundColor: '#FFEAEA', justifyContent: 'center' },
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
  seatTextSelected: { color: colors.white },
  seatWarning: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusMedium,
    flexDirection: 'row',
    gap: spacing[8],
    padding: spacing[12],
  },
  seatWarningText: { ...typography.bodySmall, color: colors.text, flex: 1 },
  error: { ...typography.bodySmall, backgroundColor: '#FFEAEA', color: colors.error, padding: spacing[12] },
  success: { ...typography.bodySmall, backgroundColor: colors.primaryLight, color: colors.primary, padding: spacing[12] },
});
