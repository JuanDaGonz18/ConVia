import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { PlaceSearchField } from '@/components/forms/PlaceSearchField';
import { MapContainer } from '@/components/map/MapContainer';
import { DriverApprovalNotice } from '@/components/profile/DriverApprovalNotice';
import { TripCard } from '@/components/trip/TripCard';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { isSupabaseEnabled } from '@/lib/supabase';
import { dimensions } from '@/constants/dimensions';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { radius } from '@/constants/radius';
import { locationService } from '@/services/locationService';
import { tripService } from '@/services/tripService';
import { useAppStore } from '@/store/appStore';
import { Location, Trip } from '@/types';
import { errorMessage, formatDateTime } from '@/utils/format';
import { hasCoordinates, rankTrips } from '@/utils/tripRanking';

/** How far (km) a trip may end from the chosen destination to count as a match. */
const DESTINATION_RADIUS_KM = 5;

export default function HomeScreen() {
  const currentUser = useAppStore((state) => state.currentUser);
  const role = currentUser?.role ?? 'client';

  const [origin, setOrigin] = useState<Location | null>(null);
  const [originError, setOriginError] = useState<string | null>(null);
  const [destination, setDestination] = useState<Location | null>(null);
  const [isCardCollapsed, setIsCardCollapsed] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [availableTrips, setAvailableTrips] = useState<Trip[]>([]);
  const setSelectedTrip = useAppStore((state) => state.setSelectedTrip);
  const savedPlaces = useAppStore((state) => state.savedPlaces);
  const favoriteDriverIds = useAppStore((state) => state.favoriteDriverIds);

  const locate = useCallback(async () => {
    setOriginError(null);
    try {
      setOrigin(await locationService.getCurrentLocation());
    } catch (error) {
      setOriginError(errorMessage(error, 'No se pudo obtener tu ubicación.'));
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void locate(), 0);
    return () => clearTimeout(timer);
  }, [locate]);

  useFocusEffect(
    useCallback(() => {
      if (role !== 'client') return;
      void tripService.getAvailableTrips().then((trips) => {
        setAvailableTrips(trips);
        setLoadError(null);
      }).catch((error) => {
        setLoadError(errorMessage(error, 'No se pudieron cargar los viajes.'));
      });
    }, [role]),
  );

  // With a searched destination: only trips ending near it. Without one: every
  // trip, ordered by the user's saved places and favorite drivers.
  const candidates = destination
    ? availableTrips.filter((trip) =>
        hasCoordinates(trip.destination)
          ? locationService.distanceKm(trip.destination, destination) <= DESTINATION_RADIUS_KM
          : trip.destination.label.toLowerCase().includes(destination.label.toLowerCase()),
      )
    : availableTrips;
  const ranked = rankTrips(candidates, savedPlaces, favoriteDriverIds);
  const next = ranked[0] ?? null;
  const nextTrip = next?.trip ?? null;
  const suggestedCount = destination ? 0 : ranked.filter((item) => item.relevant).length;
  const tripPins = availableTrips.map((trip) => trip.origin).filter(hasCoordinates);

  // Tapping the map (or a named place on it) sets the destination there.
  const pickDestinationOnMap = async (point: { latitude: number; longitude: number; name?: string }) => {
    setDestination({
      id: `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`,
      label: point.name ?? 'Punto en el mapa',
      address: 'Buscando la dirección…',
      latitude: point.latitude,
      longitude: point.longitude,
    });
    const resolved = await locationService.fromCoordinate(point.latitude, point.longitude, point.name);
    // Keep it only if the user has not picked something else meanwhile.
    setDestination((current) => (current && current.id === resolved.id ? resolved : current));
  };

  const selectTripFromPin = (pin: Location) => {
    const trip = availableTrips.find((item) => item.origin.id === pin.id);
    if (!trip) return;
    setSelectedTrip(trip);
    router.push('/trip-details');
  };

  return (
    <SafeAreaView edges={['top']} style={styles.container}>
      {/* Top Header & Search Bar */}
      <View style={styles.header}>
        <View style={styles.userInfo}>
          <View style={styles.userText}>
            <Text style={styles.greeting}>
              Hola, {currentUser?.name || 'Usuario'}
            </Text>
            {originError ? (
              <Pressable onPress={() => void locate()}>
                <Text style={styles.originError}>{originError} Toca para reintentar.</Text>
              </Pressable>
            ) : (
              <View style={styles.originRow}>
                <Ionicons color={colors.textSecondary} name="location-outline" size={13} />
                <Text numberOfLines={1} style={styles.currentOrigin}>
                  {origin ? origin.label : 'Obteniendo tu ubicación…'}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.roleBadge}>
            <Ionicons
              color={colors.primary}
              name={role === 'driver' ? 'car-sport' : 'person'}
              size={14}
            />
            <Text style={styles.roleBadgeText}>
              {role === 'driver' ? 'Conductor' : 'Pasajero'}
            </Text>
          </View>
        </View>

        {role === 'client' ? (
          <PlaceSearchField
            mapTitle="¿A dónde vas?"
            near={origin}
            onChange={setDestination}
            placeholder="¿A dónde vas?"
            quickPlaces={savedPlaces}
            value={destination}
          />
        ) : null}
      </View>

      {/* Map with the user's real position, destination and trip departure points */}
      <View style={styles.mapWrapper}>
        <MapContainer
          destination={destination}
          locations={role === 'client' ? tripPins : []}
          onMapPress={role === 'client' ? (point) => void pickDestinationOnMap(point) : undefined}
          onSelectLocation={selectTripFromPin}
          origin={origin}
        />
      </View>

      {/* Bottom Floating Info Card */}
      <View
        style={[
          styles.bottomCard,
          isCardCollapsed ? styles.bottomCardCollapsed : null,
        ]}
      >
        {/* Toggle Collapse Bar */}
        <Pressable
          onPress={() => setIsCardCollapsed(!isCardCollapsed)}
          style={styles.collapseBar}
        >
          <View style={styles.dragHandle} />
          <View style={styles.collapseHeaderRow}>
            <Text style={styles.collapseTitle}>
              {role === 'driver'
                ? 'Panel de conductor'
                : destination
                  ? `Destino: ${destination.label}`
                  : suggestedCount ? `Para ti · ${suggestedCount} viaje${suggestedCount === 1 ? '' : 's'}` : 'Próximos viajes'}
            </Text>
            <Ionicons
              color={colors.textSecondary}
              name={isCardCollapsed ? 'chevron-up' : 'chevron-down'}
              size={20}
            />
          </View>
        </Pressable>

        {/* Card Body if expanded */}
        {!isCardCollapsed ? (
          role === 'driver' ? (
            <View style={styles.driverSection}>
              <View style={styles.driverStatusRow}>
                <View style={styles.onlineIndicator} />
                <Text style={styles.driverStatusText}>Modo conductor activo</Text>
              </View>
              <Text style={styles.driverSubtext}>
                Publica un viaje y gestiona las solicitudes de tus pasajeros.
              </Text>
              <View style={styles.buttonRow}>
                {currentUser?.driverStatus === 'aprobado' ? (
                  <ButtonPrimary
                    onPress={() => router.push('/create-trip')}
                    title="Publicar un viaje"
                  />
                ) : (
                  <DriverApprovalNotice status={currentUser?.driverStatus} />
                )}
                <ButtonSecondary
                  onPress={() => router.push('/requests')}
                  title="Ver solicitudes"
                />
                <ButtonSecondary
                  onPress={() => router.push('/(tabs)/chats')}
                  title="Chats con pasajeros"
                />
              </View>
            </View>
          ) : (
            <View style={styles.clientSection}>
              {nextTrip ? (
                <View style={styles.routeQuickInfo}>
                  <View style={styles.infoBadge}>
                    <Ionicons color={colors.primary} name="time-outline" size={14} />
                    <Text style={styles.infoBadgeText}>{formatDateTime(nextTrip.departureTime)}</Text>
                  </View>
                  <View style={styles.infoBadge}>
                    <Ionicons color={colors.primary} name="people-outline" size={14} />
                    <Text style={styles.infoBadgeText}>{nextTrip.seatsAvailable} cupos libres</Text>
                  </View>
                </View>
              ) : null}

              {next ? (
                <TripCard favoriteDriver={next.favoriteDriver} nearPlace={next.nearPlace} trip={next.trip} />
              ) : (
                <Text style={styles.noTripsText}>
                  {loadError ??
                    (!isSupabaseEnabled
                      ? 'Modo demostración: conecta el servidor para ver viajes reales.'
                      : destination
                        ? 'No hay viajes hacia ese destino por ahora.'
                        : 'No hay viajes disponibles por ahora.')}
                </Text>
              )}

              {nextTrip ? (
                <View style={styles.actionButtonsRow}>
                  <View style={styles.reserveBtnWrapper}>
                    <ButtonPrimary
                      onPress={() => {
                        setSelectedTrip(nextTrip);
                        router.push('/trip-details');
                      }}
                      title="Ver y reservar"
                    />
                  </View>
                  <Pressable
                    accessibilityLabel="Ver todos los viajes"
                    onPress={() => router.push('/(tabs)/trips')}
                    style={styles.chatIconButton}
                  >
                    <Ionicons color={colors.primary} name="list" size={22} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          )
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    backgroundColor: colors.white,
    borderBottomColor: colors.lightGray,
    borderBottomWidth: 1,
    gap: spacing[12],
    paddingHorizontal: dimensions.screenPadding,
    paddingVertical: spacing[12],
    zIndex: 10,
  },
  userInfo: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  greeting: {
    ...typography.headingM,
    color: colors.text,
  },
  userText: {
    flex: 1,
    marginRight: spacing[8],
  },
  originError: {
    ...typography.caption,
    color: colors.error,
    marginTop: 2,
  },
  originRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginTop: 2,
  },
  currentOrigin: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
  },
  roleBadge: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusFull,
    flexDirection: 'row',
    gap: spacing[4],
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[4],
  },
  roleBadgeText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
  noTripsText: {
    ...typography.body,
    color: colors.textSecondary,
    paddingVertical: spacing[16],
    textAlign: 'center',
  },
  mapWrapper: {
    flex: 1,
  },
  bottomCard: {
    backgroundColor: colors.white,
    borderTopColor: colors.lightGray,
    borderTopLeftRadius: radius.radiusXL,
    borderTopRightRadius: radius.radiusXL,
    borderTopWidth: 1,
    bottom: dimensions.bottomNavigationHeight,
    elevation: 8,
    left: 0,
    paddingHorizontal: spacing[16],
    paddingTop: spacing[8],
    paddingBottom: spacing[16],
    position: 'absolute',
    right: 0,
    shadowColor: colors.shadow,
    shadowOffset: { height: -4, width: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
  },
  bottomCardCollapsed: {
    paddingBottom: spacing[8],
  },
  collapseBar: {
    alignItems: 'center',
    gap: spacing[4],
    paddingBottom: spacing[8],
  },
  dragHandle: {
    backgroundColor: colors.border,
    borderRadius: 2,
    height: 4,
    width: 36,
  },
  collapseHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  collapseTitle: {
    ...typography.label,
    color: colors.text,
  },
  routeQuickInfo: {
    flexDirection: 'row',
    gap: spacing[8],
    marginBottom: spacing[8],
  },
  infoBadge: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusFull,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing[12],
    paddingVertical: 4,
  },
  infoBadgeText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
  clientSection: {
    gap: spacing[8],
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: spacing[12],
    marginTop: spacing[4],
  },
  reserveBtnWrapper: {
    flex: 1,
  },
  chatIconButton: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
    borderRadius: radius.radiusMedium,
    borderWidth: 1,
    height: dimensions.controlHeight,
    justifyContent: 'center',
    width: dimensions.controlHeight,
  },
  driverSection: {
    gap: spacing[12],
  },
  driverStatusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing[8],
  },
  onlineIndicator: {
    backgroundColor: '#22C55E',
    borderRadius: radius.radiusFull,
    height: 10,
    width: 10,
  },
  driverStatusText: {
    ...typography.label,
    color: colors.text,
  },
  driverSubtext: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  buttonRow: {
    gap: spacing[8],
  },
});
