import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { FaceVerificationModal } from '@/components/face/FaceVerificationModal';
import { PlaceSearchField } from '@/components/forms/PlaceSearchField';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { tripService } from '@/services/tripService';
import { useAppStore } from '@/store/appStore';
import { Location } from '@/types';
import { errorMessage, formatDateTime, formatPrice } from '@/utils/format';

function requestErrorMessage(error: unknown) {
  const message = errorMessage(error, 'No se pudo enviar la solicitud.');
  if (message.includes('row-level security')) {
    return 'No puedes solicitar este viaje. Verifica tu identidad desde tu perfil y confirma que el viaje siga disponible.';
  }
  if (message.includes('trip_requests_one_active') || message.includes('duplicate key')) {
    return 'Ya tienes una solicitud activa para este viaje.';
  }
  return message;
}

export default function TripDetailsScreen() {
  const trip = useAppStore((state) => state.selectedTrip);
  const isVerified = useAppStore((state) => state.currentUser?.faceVerified === true);
  const userId = useAppStore((state) => state.currentUser?.id);
  const [showFaceCheck, setShowFaceCheck] = useState(false);
  const [pickup, setPickup] = useState<Location | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState(false);

  if (!trip) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Text style={styles.empty}>Selecciona un viaje para ver sus detalles.</Text>
        <ButtonSecondary onPress={() => router.back()} title="Volver" />
      </SafeAreaView>
    );
  }

  // Step 1: validate, then ask for a fresh face check (required by the database).
  const request = () => {
    if (!pickup) {
      setError('Indica tu punto de recogida.');
      return;
    }
    setError(null);
    setShowFaceCheck(true);
  };

  // Step 2: runs only after the face matched the registered one.
  const sendRequest = async () => {
    if (!pickup) return;
    setShowFaceCheck(false);
    setLoading(true);
    try {
      await tripService.requestPickup(trip.id, pickup.address, pickup.latitude, pickup.longitude);
      setRequested(true);
    } catch (requestError) {
      setError(requestErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {userId ? (
        <FaceVerificationModal
          onClose={() => setShowFaceCheck(false)}
          onFailure={() => undefined}
          onSuccess={() => void sendRequest()}
          trigger="trip_request"
          userId={userId}
          visible={showFaceCheck}
        />
      ) : null}
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityLabel="Volver" onPress={() => router.back()} style={styles.back}>
          <Ionicons color={colors.text} name="arrow-back" size={24} />
        </Pressable>
        <Text style={styles.kicker}>DETALLE DEL VIAJE</Text>
        <Text style={styles.title}>{trip.origin.label} a {trip.destination.label}</Text>
        <Text style={styles.subtitle}>Conduce {trip.driver.name} · {formatDateTime(trip.departureTime)}</Text>
        <Text style={styles.info}>{formatPrice(trip.price)} · {trip.seatsAvailable} cupos disponibles</Text>
        {trip.description ? <Text style={styles.description}>{trip.description}</Text> : null}
        {requested ? (
          <>
            <Text style={styles.success}>Solicitud enviada. El conductor debe aceptar tu punto de recogida.</Text>
            <ButtonSecondary onPress={() => router.replace('/requests')} title="Ver mis solicitudes" />
          </>
        ) : trip.seatsAvailable <= 0 ? (
          <Text style={styles.error}>Este viaje ya no tiene cupos disponibles.</Text>
        ) : (
          <>
            <PlaceSearchField
              allowCurrentLocation
              label="Punto de recogida"
              near={trip.origin.latitude || trip.origin.longitude ? trip.origin : null}
              onChange={setPickup}
              placeholder="Calle 123 # 7-45, barrio"
              value={pickup}
            />
            {!isVerified ? <Text style={styles.error}>Debes verificar tu identidad (Perfil → Verificar identidad) antes de solicitar viajes.</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <ButtonPrimary disabled={!isVerified} loading={loading} onPress={request} title="Solicitar este viaje" />
          </>
        )}
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
  info: { ...typography.headingM, color: colors.primary },
  description: { ...typography.body, color: colors.text },
  success: { ...typography.body, backgroundColor: colors.primaryLight, color: colors.primary, padding: spacing[16] },
  error: { ...typography.bodySmall, color: colors.error },
  empty: { ...typography.body, color: colors.textSecondary, padding: dimensions.screenPadding },
});
