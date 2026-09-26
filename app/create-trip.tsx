import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { DateTimePicker } from '@expo/ui/community/datetime-picker';

import { PlaceSearchField } from '@/components/forms/PlaceSearchField';
import { DriverApprovalNotice } from '@/components/profile/DriverApprovalNotice';
import { TextField } from '@/components/forms/TextField';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { tripService } from '@/services/tripService';
import { vehicleService } from '@/services/vehicleService';
import { useAppStore } from '@/store/appStore';
import { Location, Vehicle } from '@/types';
import { errorMessage } from '@/utils/format';

type PickerMode = 'date' | 'time' | null;

/** Next full half hour, at least 30 minutes from now. */
function defaultDeparture() {
  const date = new Date(Date.now() + 30 * 60_000);
  date.setMinutes(date.getMinutes() < 30 ? 30 : 60, 0, 0);
  return date;
}

export default function CreateTripScreen() {
  const driverStatus = useAppStore((state) => state.currentUser?.driverStatus);
  const [vehicle, setVehicle] = useState<Vehicle>();
  const [vehicleLoaded, setVehicleLoaded] = useState(false);
  const [origin, setOrigin] = useState<Location | null>(null);
  const [destination, setDestination] = useState<Location | null>(null);
  const [departure, setDeparture] = useState(defaultDeparture);
  const [picker, setPicker] = useState<PickerMode>(null);
  const [price, setPrice] = useState('');
  const [seats, setSeats] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void vehicleService.getMyVehicle().then((saved) => {
      setVehicle(saved);
      if (saved) setSeats(String(saved.seats ?? 1));
    }).catch(() => setError('No se pudo cargar tu vehículo.'))
      .finally(() => setVehicleLoaded(true));
  }, []);

  const applyPicked = (picked: Date) => {
    setPicker(null);
    setDeparture((current) => {
      const next = new Date(current);
      if (picker === 'date') next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
      else next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
      return next;
    });
  };

  const publishTrip = async () => {
    const parsedPrice = Number(price);
    const parsedSeats = Number(seats);
    if (!vehicle) {
      setError('Registra un vehículo antes de publicar un viaje.');
      return;
    }
    if (!origin || !destination) {
      setError('Selecciona el punto de salida y el destino.');
      return;
    }
    if (departure <= new Date()) {
      setError('La salida debe ser en el futuro.');
      return;
    }
    if (!price.trim() || !Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setError('Ingresa un precio válido.');
      return;
    }
    if (!Number.isInteger(parsedSeats) || parsedSeats < 1 || parsedSeats > (vehicle.seats ?? 8)) {
      setError(`Los puestos deben estar entre 1 y ${vehicle.seats ?? 8}.`);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await tripService.createTrip({
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
      });
      router.replace('/(tabs)/trips');
    } catch (publishError) {
      const message = errorMessage(publishError, 'No se pudo publicar el viaje.');
      setError(message.includes('row-level security')
        ? 'Solo conductores con identidad verificada pueden publicar viajes. Verifícate desde tu perfil.'
        : message);
    } finally {
      setLoading(false);
    }
  };

  const dateLabel = departure.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const timeLabel = departure.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityLabel="Volver" onPress={() => router.back()} style={styles.back}>
          <Ionicons color={colors.text} name="arrow-back" size={24} />
        </Pressable>
        <Text style={styles.kicker}>NUEVO VIAJE</Text>
        <Text style={styles.title}>Publicar viaje</Text>
        <Text style={styles.subtitle}>
          {!vehicleLoaded ? 'Cargando tu vehículo...' : vehicle ? `Vehículo: ${vehicle.plate}` : 'Primero registra tu vehículo.'}
        </Text>
        {driverStatus !== 'aprobado' ? <DriverApprovalNotice status={driverStatus} /> : null}
        {vehicleLoaded && !vehicle ? <ButtonSecondary onPress={() => router.push('/vehicle')} title="Registrar vehículo" /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <PlaceSearchField allowCurrentLocation label="Salida" mapTitle="Punto de salida" onChange={setOrigin} value={origin} />
        <PlaceSearchField label="Destino" mapTitle="Destino del viaje" near={origin} onChange={setDestination} placeholder="Ej. Universidad de La Sabana" value={destination} />

        <Text style={styles.label}>Fecha y hora de salida</Text>
        <View style={styles.dateRow}>
          <Pressable accessibilityLabel="Elegir fecha" onPress={() => setPicker('date')} style={styles.dateButton}>
            <Ionicons color={colors.primary} name="calendar-outline" size={20} />
            <Text style={styles.dateText}>{dateLabel}</Text>
          </Pressable>
          <Pressable accessibilityLabel="Elegir hora" onPress={() => setPicker('time')} style={styles.dateButton}>
            <Ionicons color={colors.primary} name="time-outline" size={20} />
            <Text style={styles.dateText}>{timeLabel}</Text>
          </Pressable>
        </View>
        {picker ? (
          <View style={Platform.OS === 'ios' ? styles.iosPicker : undefined}>
            <DateTimePicker
              accentColor={colors.primary}
              is24Hour={false}
              minimumDate={picker === 'date' ? new Date() : undefined}
              mode={picker}
              onDismiss={() => setPicker(null)}
              onValueChange={(_event, picked) => {
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

        <TextField label="Precio por cupo (COP)" keyboardType="number-pad" onChangeText={setPrice} placeholder="12000" value={price} />
        <TextField label="Puestos" keyboardType="number-pad" onChangeText={setSeats} placeholder="4" value={seats} />
        <TextField label="Descripción (opcional)" onChangeText={setDescription} placeholder="Punto de encuentro y detalles" value={description} />
        <ButtonPrimary disabled={driverStatus !== 'aprobado'} loading={loading} onPress={publishTrip} title="Publicar viaje" />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  back: { alignSelf: 'flex-start', padding: spacing[4] },
  kicker: { ...typography.label, color: colors.primary },
  title: { ...typography.headingXL, color: colors.text },
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
  error: { ...typography.bodySmall, backgroundColor: '#FFEAEA', color: colors.error, padding: spacing[12] },
});
