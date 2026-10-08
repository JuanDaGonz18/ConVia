import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { PlusBadge } from '@/components/subscription/PlusBadge';
import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { FaceVerificationModal } from '@/components/face/FaceVerificationModal';
import { PlaceSearchField } from '@/components/forms/PlaceSearchField';
import { MatchSummary } from '@/components/trip/MatchSummary';
import { TripRoutePreview } from '@/components/map/TripRoutePreview';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { Avatar } from '@/components/ui/Avatar';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { Rating } from '@/components/ui/Rating';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { personalizationService } from '@/services/personalizationService';
import { matchTrip, suggestTrips } from '@/services/tripMatching';
import { tripService } from '@/services/tripService';
import { useAppStore } from '@/store/appStore';
import { Location } from '@/types';
import { errorMessage, formatDateTime, formatPrice, rawErrorMessage } from '@/utils/format';

function requestErrorMessage(error: unknown) {
  const raw = rawErrorMessage(error);
  if (raw.includes('row-level security')) {
    return 'No puedes solicitar este viaje. Confirma que sigue disponible y que no eres su conductor.';
  }
  if (raw.includes('trip_requests_one_active') || raw.includes('duplicate key')) {
    return 'Ya tienes una solicitud activa para este viaje.';
  }
  return errorMessage(error, 'No se pudo enviar la solicitud.');
}

export default function TripDetailsScreen() {
  const trip = useAppStore((state) => state.selectedTrip);
  const isVerified = useAppStore((state) => state.currentUser?.faceVerified === true);
  const userId = useAppStore((state) => state.currentUser?.id);
  const markFaceVerified = useAppStore((state) => state.markFaceVerified);
  const [showFaceCheck, setShowFaceCheck] = useState(false);
  // Users who skipped the selfie at sign-up register it here.
  const [showEnrollment, setShowEnrollment] = useState(false);
  const [pickup, setPickup] = useState<Location | null>(null);
  const [pickupError, setPickupError] = useState<string | null>(null);
  // Where the passenger gets off; prefilled with the destination they searched for.
  const searchDestination = useAppStore((state) => state.tripSearch.destination);
  const [dropoff, setDropoff] = useState<Location | null>(searchDestination);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState(false);
  const savedPlaces = useAppStore((state) => state.savedPlaces);
  const favoriteDriverIds = useAppStore((state) => state.favoriteDriverIds);
  const setFavoriteDriverIds = useAppStore((state) => state.setFavoriteDriverIds);
  const [favoriteBusy, setFavoriteBusy] = useState(false);

  if (!trip) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Text style={styles.empty}>Selecciona un viaje para ver sus detalles.</Text>
        <ButtonSecondary onPress={() => router.back()} title="Volver" />
      </SafeAreaView>
    );
  }

  const isFavorite = favoriteDriverIds.includes(trip.driver.id);
  // Why this trip suits the passenger: their current search, else their saved places.
  const match = searchDestination
    ? matchTrip(trip, { destination: searchDestination, favoriteDriverIds: new Set(favoriteDriverIds) })
    : suggestTrips([trip], { places: savedPlaces, favoriteDriverIds: new Set(favoriteDriverIds) })[0]?.match ?? null;

  const toggleFavorite = async (driverId: string) => {
    setFavoriteBusy(true);
    setError(null);
    try {
      if (isFavorite) {
        await personalizationService.removeFavoriteDriver(driverId);
        setFavoriteDriverIds(favoriteDriverIds.filter((id) => id !== driverId));
      } else {
        await personalizationService.addFavoriteDriver(driverId);
        setFavoriteDriverIds([...favoriteDriverIds, driverId]);
      }
    } catch (favoriteError) {
      setError(errorMessage(favoriteError, 'No se pudo actualizar tus favoritos.'));
    } finally {
      setFavoriteBusy(false);
    }
  };

  // Step 1: validate, then ask for a fresh face check (required by the database).
  const request = () => {
    if (!pickup) {
      setPickupError('Elige dónde quieres que te recojan.');
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
      await tripService.requestPickup(trip.id, pickup.address, pickup.latitude, pickup.longitude, dropoff);
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
      {userId && !isVerified ? (
        <FaceVerificationModal
          onClose={() => setShowEnrollment(false)}
          onFailure={() => undefined}
          onSuccess={() => {
            setShowEnrollment(false);
            markFaceVerified();
          }}
          trigger="register"
          userId={userId}
          visible={showEnrollment}
        />
      ) : null}
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader kicker="DETALLE DEL VIAJE" title={`${trip.origin.label} a ${trip.destination.label}`} />
        <Text style={styles.subtitle}>{formatDateTime(trip.departureTime)}</Text>
        <Text style={styles.info}>{formatPrice(trip.price)} · {trip.seatsAvailable} cupos disponibles</Text>
        {match?.compatible ? <MatchSummary match={match} /> : null}

        <TripRoutePreview chosenRoute={trip.route} destination={trip.destination} origin={trip.origin} />

        <View style={styles.driverCard}>
          <Avatar imageUrl={trip.driver.avatarUrl} name={trip.driver.name} size={48} />
          <View style={styles.driverText}>
            <View style={styles.nameRow}>
              <Text numberOfLines={1} style={styles.driverName}>{trip.driver.name}</Text>
              {trip.driver.isPlus ? <PlusBadge /> : null}
            </View>
            <Rating score={trip.driver.rating.score} />
          </View>
          {trip.driver.id !== userId ? (
            <Pressable
              accessibilityLabel={isFavorite ? `Quitar a ${trip.driver.name} de favoritos` : `Agregar a ${trip.driver.name} a favoritos`}
              accessibilityState={{ selected: isFavorite, busy: favoriteBusy }}
              disabled={favoriteBusy}
              hitSlop={8}
              onPress={() => void toggleFavorite(trip.driver.id)}
              style={styles.favoriteButton}
            >
              <Ionicons color={isFavorite ? colors.warning : colors.textSecondary} name={isFavorite ? 'star' : 'star-outline'} size={26} />
              <Text style={styles.favoriteLabel}>{isFavorite ? 'Favorito' : 'Marcar'}</Text>
            </Pressable>
          ) : null}
        </View>
        {trip.vehicle ? (
          <View style={styles.vehicleCard}>
            {trip.vehicle.photoUrl ? (
              <Image accessibilityLabel={`Foto del vehículo ${trip.vehicle.brand}`} source={{ uri: trip.vehicle.photoUrl }} style={styles.vehiclePhoto} />
            ) : null}
            <View style={styles.vehicleInfo}>
              <Ionicons color={colors.primary} name="car-outline" size={20} />
              <Text style={styles.vehicleText}>
                {trip.vehicle.brand}{trip.vehicle.color ? ` · ${trip.vehicle.color}` : ''}
              </Text>
              <Text style={styles.plate}>{trip.vehicle.plate}</Text>
            </View>
          </View>
        ) : null}
        {trip.description ? <Text style={styles.description}>{trip.description}</Text> : null}
        {requested ? (
          <>
            <Notice title="¡Solicitud enviada!" tone="success">
              Le avisamos al conductor. Cuando acepte tu punto de recogida recibirás una notificación y se habilitará el chat del viaje.
            </Notice>
            <ButtonSecondary onPress={() => router.replace('/requests')} title="Ver mis solicitudes" />
          </>
        ) : trip.seatsAvailable <= 0 ? (
          <Notice tone="warning">Este viaje ya llenó sus cupos. Busca otro en la lista de viajes.</Notice>
        ) : (
          <>
            <PlaceSearchField
              allowCurrentLocation
              label="Punto de recogida"
              near={trip.origin.latitude || trip.origin.longitude ? trip.origin : null}
              error={pickupError}
              onChange={(place) => {
                setPickup(place);
                setPickupError(null);
              }}
              placeholder="Dirección o lugar de recogida"
              value={pickup}
            />
            <PlaceSearchField
              label="Dónde te bajas (opcional)"
              mapLink="afterSelection"
              mapTitle="Dónde te bajas"
              near={trip.destination.latitude || trip.destination.longitude ? trip.destination : null}
              onChange={setDropoff}
              placeholder="Lugar donde te bajas"
              value={dropoff}
            />
            <Text style={styles.hint}>Así el conductor sabe si su ruta te sirve. Si lo dejas vacío, te bajas en el destino del viaje.</Text>
            {error ? <Notice tone="error">{error}</Notice> : null}
            {isVerified ? (
              <ButtonPrimary loading={loading} onPress={request} title="Solicitar este viaje" />
            ) : (
              <View style={styles.notice}>
                <Text style={styles.noticeText}>
                  Para pedir un cupo primero registramos tu rostro. Solo toma unos segundos y la foto no se guarda.
                </Text>
                <ButtonPrimary onPress={() => setShowEnrollment(true)} title="Verificar mi identidad" />
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  subtitle: { ...typography.body, color: colors.textSecondary },
  info: { ...typography.headingM, color: colors.primary },
  description: { ...typography.body, color: colors.text },
  notice: { backgroundColor: colors.primaryLight, borderRadius: radius.radiusLarge, gap: spacing[12], padding: spacing[16] },
  noticeText: { ...typography.bodySmall, color: colors.text },
  empty: { ...typography.body, color: colors.textSecondary, padding: dimensions.screenPadding },
  vehicleCard: { backgroundColor: colors.white, borderColor: colors.lightGray, borderRadius: radius.radiusLarge, borderWidth: 1, overflow: 'hidden' },
  vehiclePhoto: { aspectRatio: 16 / 9, backgroundColor: colors.lightGray, width: '100%' },
  vehicleInfo: { alignItems: 'center', flexDirection: 'row', gap: spacing[8], padding: spacing[16] },
  vehicleText: { ...typography.bodyMedium, color: colors.text, flex: 1 },
  plate: {
    ...typography.bodyMedium,
    backgroundColor: '#FFD500',
    borderColor: colors.text,
    borderRadius: 4,
    borderWidth: 1,
    color: colors.text,
    fontWeight: '800',
    letterSpacing: 1,
    overflow: 'hidden',
    paddingHorizontal: spacing[8],
    paddingVertical: 2,
  },
  hint: { ...typography.caption, color: colors.textSecondary, marginTop: -spacing[8] },
  driverCard: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing[12],
    padding: spacing[16],
  },
  driverText: { flex: 1, gap: 2 },
  driverName: { ...typography.bodyMedium, color: colors.text, flexShrink: 1, fontWeight: '600' },
  nameRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  favoriteButton: { alignItems: 'center', gap: 2, padding: spacing[4] },
  favoriteLabel: { ...typography.caption, color: colors.textSecondary, fontSize: 11 },
});
