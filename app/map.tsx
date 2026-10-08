import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { PlusBadge } from '@/components/subscription/PlusBadge';
import { requirePlus } from '@/components/subscription/PlusGate';
import { Notice } from '@/components/ui/Notice';
import { PlaceSearchField } from '@/components/forms/PlaceSearchField';
import { TripCard } from '@/components/trip/TripCard';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { AppMap, MapHandle, MapLine, MapMarker, MapRegion, useMapCapabilities } from '@/maps';
import { locationService } from '@/services/locationService';
import { hasCoordinates, RankedMatch, rankTripsForJourney, suggestTrips } from '@/services/tripMatching';
import { DriverTripRecord, tripService } from '@/services/tripService';
import { useAppStore } from '@/store/appStore';
import { Location, Trip } from '@/types';
import { errorMessage, formatDateTime, formatPrice } from '@/utils/format';
import { usePlan } from '@/subscription/usePlan';

const BOGOTA: MapRegion = { latitude: 4.711, longitude: -74.0721, latitudeDelta: 0.25, longitudeDelta: 0.25 };
// Added to the space the search bar and the sheet already take.
const EDGE_PADDING = { top: 48, right: 48, bottom: 48, left: 48 };
const TRIP_COLORS = ['#006FFD', '#7C3AED', '#0891B2', '#DB2777', '#EA580C'];

type Point = { latitude: number; longitude: number };

/**
 * Full-screen map, opened on demand.
 * Everyone: search or tap a destination (drag its pin to fine-tune).
 * Passengers: trips arriving at or passing near that destination.
 * Drivers: their upcoming trips (departure, destination, route) and
 * "Planear un viaje hacia aquí" for any point.
 */
export default function MapScreen() {
  const role = useAppStore((state) => state.currentUser?.role ?? 'client');
  const isDriver = role === 'driver';
  const driverApproved = useAppStore((state) => state.currentUser?.driverStatus === 'aprobado');
  const savedPlaces = useAppStore((state) => state.savedPlaces);
  const favoriteDriverIds = useAppStore((state) => state.favoriteDriverIds);
  const searchTime = useAppStore((state) => state.tripSearch.time);
  const viewerId = useAppStore((state) => state.currentUser?.id ?? null);
  const setSelectedTrip = useAppStore((state) => state.setSelectedTrip);
  const mapRef = useRef<MapHandle>(null);
  const { can } = usePlan();
  const mapCapabilities = useMapCapabilities();
  const canShowTraffic = can('map_traffic') && mapCapabilities.traffic;
  const [traffic, setTraffic] = useState(false);
  // The bottom sheet can cover up to ~half the screen; keep the map's center above it.
  const { height: windowHeight } = useWindowDimensions();
  const [me, setMe] = useState<Location | null>(null);
  const [selected, setSelected] = useState<Location | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [driverTrips, setDriverTrips] = useState<DriverTripRecord[]>([]);
  const [focusedTripId, setFocusedTripId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      if (isDriver) {
        const mine = await tripService.getDriverTrips();
        setDriverTrips(mine
          .filter((trip) => (trip.status === 'por_empezar' || trip.status === 'en_curso') && trip.origin && trip.destination)
          .sort((a, b) => new Date(a.departureAt).getTime() - new Date(b.departureAt).getTime()));
      } else {
        setTrips(await tripService.getAvailableTrips());
      }
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError, 'No se pudieron cargar los viajes.'));
    }
  }, [isDriver]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useEffect(() => {
    const timer = setTimeout(() => {
      void locationService.getCurrentLocation().then((location) => {
        setMe(location);
        mapRef.current?.centerOn(location, { delta: 0.08, duration: 600 });
      }).catch(() => undefined);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const focusOn = (points: Point[]) => {
    if (points.length === 1) mapRef.current?.centerOn(points[0], { delta: 0.03 });
    else if (points.length > 1) mapRef.current?.fitTo(points, { padding: EDGE_PADDING });
  };

  const choose = (location: Location | null) => {
    setSelected(location);
    setFocusedTripId(null);
    if (location) focusOn([location]);
  };

  // A tapped point (or dragged pin): show it at once, then fill in its address.
  const chooseAt = async (point: Point & { name?: string }) => {
    const id = `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`;
    setFocusedTripId(null);
    setSelected({ id, label: point.name ?? 'Punto en el mapa', address: 'Buscando la dirección…', latitude: point.latitude, longitude: point.longitude });
    const resolved = await locationService.fromCoordinate(point.latitude, point.longitude, point.name);
    setSelected((current) => (current?.id === resolved.id ? resolved : current));
  };

  const openTrip = (trip: Trip) => {
    setSelectedTrip(trip);
    router.push('/trip-details');
  };

  const planTrip = (destination: Location) => {
    router.push({
      pathname: '/create-trip',
      params: { destLat: String(destination.latitude), destLng: String(destination.longitude), destLabel: destination.label },
    });
  };

  // Passenger: same matching as Inicio. With a chosen point, trips compatible with the
  // journey from here to there; without one, trips compatible with the saved places.
  const favorites = useMemo(() => new Set(favoriteDriverIds), [favoriteDriverIds]);
  const shownTrips = useMemo(() => {
    if (isDriver) return [];
    return selected
      ? rankTripsForJourney(trips, { origin: me, destination: selected, time: searchTime, favoriteDriverIds: favorites, viewerId })
      : suggestTrips(trips, { origin: me, places: savedPlaces, favoriteDriverIds: favorites, time: searchTime, viewerId });
  }, [favorites, isDriver, me, savedPlaces, searchTime, selected, trips, viewerId]);
  const suggestions = selected ? [] : shownTrips;
  const highlighted = new Set(shownTrips.map((entry) => entry.item.id));
  const focusedTrip = driverTrips.find((trip) => trip.id === focusedTripId) ?? null;
  const distanceFromMe = selected && me ? locationService.distanceKm(me, selected) : null;

  return (
    <View style={styles.root}>
      <AppMap
        initialRegion={BOGOTA}
        onPress={(event) => void chooseAt({ latitude: event.latitude, longitude: event.longitude, name: event.placeName })}
        // Map controls stay clear of the search bar and the sheet.
        overlayInsets={{ top: 170, bottom: Math.round(windowHeight * 0.45) }}
        ref={mapRef}
        showsTraffic={traffic}
        showsUserLocation
        style={StyleSheet.absoluteFill}
      >
        {/* Driver: each upcoming trip with its departure, destination and route. */}
        {isDriver ? driverTrips.map((trip, index) => {
          if (!trip.origin || !trip.destination) return null;
          const color = TRIP_COLORS[index % TRIP_COLORS.length];
          const faded = focusedTripId !== null && focusedTripId !== trip.id;
          const path = trip.route?.coordinates ?? [trip.origin, trip.destination];
          return (
            <Fragment key={trip.id}>
              <MapLine
                color={faded ? '#B8C2CC' : color}
                coordinates={path}
                dashed={!trip.route}
                onPress={() => {
                  setSelected(null);
                  setFocusedTripId(trip.id);
                }}
                width={faded ? 3 : 5}
              />
              <MapMarker coordinate={trip.origin} onPress={() => { setSelected(null); setFocusedTripId(trip.id); }} title={trip.originName}>
                <View style={[styles.pin, { backgroundColor: '#10B981' }]}><Ionicons color={colors.white} name="navigate" size={12} /></View>
              </MapMarker>
              <MapMarker coordinate={trip.destination} onPress={() => { setSelected(null); setFocusedTripId(trip.id); }} title={trip.destinationName}>
                <View style={[styles.pin, { backgroundColor: color }]}><Ionicons color={colors.white} name="flag" size={12} /></View>
              </MapMarker>
            </Fragment>
          );
        }) : null}

        {/* Passenger: departure points of available trips; the ones that suit the destination stand out. */}
        {!isDriver ? shownTrips.filter((entry) => entry.item.route).map(({ item: trip }) => (
          <MapLine color="rgba(0,111,253,0.45)" coordinates={trip.route!.coordinates} key={`route-${trip.id}`} width={4} />
        )) : null}
        {!isDriver ? trips.filter((trip) => hasCoordinates(trip.origin)).map((trip) => {
          const match = highlighted.has(trip.id);
          return (
            <MapMarker coordinate={trip.origin} key={trip.id} onPress={() => openTrip(trip)} title={trip.driver.name}>
              <View style={[styles.pin, match ? styles.tripPinMatch : styles.tripPin]}>
                <Ionicons color={colors.white} name="car" size={12} />
              </View>
            </MapMarker>
          );
        }) : null}

        {selected ? (
          <MapMarker
            coordinate={selected}
            draggable
            onDragEnd={(point) => void chooseAt(point)}
            title={selected.label}
          >
            <View style={[styles.pin, styles.selectedPin]}><Ionicons color={colors.white} name="location" size={16} /></View>
          </MapMarker>
        ) : null}
      </AppMap>

      {/* Traffic: ConVía+; FREE users get an explanation instead. */}
      <Pressable
        accessibilityLabel={traffic ? 'Ocultar el tráfico' : 'Mostrar el tráfico'}
        accessibilityRole="switch"
        accessibilityState={{ checked: traffic }}
        onPress={() => {
          if (!canShowTraffic) requirePlus({ capability: 'map_traffic' });
          else setTraffic(!traffic);
        }}
        style={[styles.mapButton, traffic ? styles.mapButtonActive : null]}
      >
        <Ionicons color={traffic ? colors.white : colors.primary} name="speedometer-outline" size={20} />
        {!canShowTraffic ? <View style={styles.mapButtonBadge}><PlusBadge compact /></View> : null}
      </Pressable>

      <SafeAreaView edges={['top']} pointerEvents="box-none" style={styles.top}>
        <View style={styles.searchCard}>
          <PlaceSearchField
            leading={(
              <Pressable accessibilityLabel="Cerrar el mapa" hitSlop={6} onPress={() => router.back()} style={styles.back}>
                <Ionicons color={colors.text} name="arrow-back" size={22} />
              </Pressable>
            )}
            mapLink="never"
            near={me}
            onChange={choose}
            placeholder={isDriver ? '¿A dónde llevas pasajeros?' : '¿A dónde vas?'}
            quickPlaces={savedPlaces}
            value={selected}
            variant="bar"
          />
        </View>
      </SafeAreaView>

      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        {error ? <Notice tone="error">{error}</Notice> : null}

        {selected ? (
          <>
            <View style={styles.sheetHeader}>
              <View style={styles.iconCircle}><Ionicons color={colors.error} name="location" size={18} /></View>
              <View style={styles.flex}>
                <Text numberOfLines={1} style={styles.sheetTitle}>{selected.label}</Text>
                <Text numberOfLines={1} style={styles.muted}>
                  {distanceFromMe !== null ? `A ${distanceFromMe.toFixed(1).replace('.', ',')} km de ti · ` : ''}
                  Arrastra el pin para ajustarlo
                </Text>
              </View>
              <Pressable accessibilityLabel="Quitar destino" hitSlop={8} onPress={() => setSelected(null)}>
                <Ionicons color={colors.textSecondary} name="close-circle" size={22} />
              </Pressable>
            </View>

            {isDriver ? (
              driverApproved ? (
                <ButtonPrimary onPress={() => planTrip(selected)} title="Planear un viaje hacia aquí" />
              ) : (
                <Text style={styles.muted}>Verifica tu licencia de conducción para publicar viajes.</Text>
              )
            ) : (
              shownTrips.length === 0 ? (
                <Text style={styles.muted}>No encontramos viajes compatibles: ninguno va hacia allá ni pasa cerca en su ruta desde donde estás.</Text>
              ) : (
                <>
                  <Text style={styles.listTitle}>
                    {`${shownTrips.length} viaje${shownTrips.length === 1 ? '' : 's'} compatible${shownTrips.length === 1 ? '' : 's'}, el más útil primero`}
                  </Text>
                  <TripCarousel items={shownTrips} onOpen={openTrip} />
                </>
              )
            )}
          </>
        ) : isDriver ? (
          focusedTrip ? (
            <>
              <View style={styles.sheetHeader}>
                <View style={styles.flex}>
                  <Text numberOfLines={2} style={styles.sheetTitle}>{focusedTrip.originName} → {focusedTrip.destinationName}</Text>
                  <Text style={styles.muted}>
                    {formatDateTime(focusedTrip.departureAt)} · {focusedTrip.totalSeats} cupos · {formatPrice(focusedTrip.price)}
                    {focusedTrip.route ? ` · ${focusedTrip.route.km.toFixed(1).replace('.', ',')} km` : ''}
                  </Text>
                </View>
                <Pressable accessibilityLabel="Cerrar" hitSlop={8} onPress={() => setFocusedTripId(null)}>
                  <Ionicons color={colors.textSecondary} name="close-circle" size={22} />
                </Pressable>
              </View>
              <View style={styles.actions}>
                <Chip icon="document-text-outline" label="Solicitudes" onPress={() => router.push('/requests')} />
                {focusedTrip.status === 'por_empezar' ? (
                  <Chip icon="create-outline" label="Editar" onPress={() => router.push({ pathname: '/create-trip', params: { edit: focusedTrip.id } })} />
                ) : null}
                <Chip icon="list-outline" label="Mis viajes" onPress={() => router.push('/(tabs)/trips')} />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.sheetTitle}>Tus viajes próximos</Text>
              {driverTrips.length === 0 ? (
                <Text style={styles.muted}>No tienes viajes próximos. Toca un punto del mapa o busca un destino para planear uno.</Text>
              ) : (
                <Text style={styles.muted}>Toca un viaje para verlo en el mapa, o toca cualquier punto para planear uno nuevo.</Text>
              )}
              <ScrollView contentContainerStyle={styles.list} style={styles.listScroll}>
                {driverTrips.map((trip, index) => (
                  <Pressable
                    key={trip.id}
                    onPress={() => {
                      setFocusedTripId(trip.id);
                      focusOn(trip.route?.coordinates ?? [trip.origin!, trip.destination!]);
                    }}
                    style={styles.tripRow}
                  >
                    <View style={[styles.colorDot, { backgroundColor: TRIP_COLORS[index % TRIP_COLORS.length] }]} />
                    <View style={styles.flex}>
                      <Text numberOfLines={1} style={styles.tripTitle}>{trip.originName} → {trip.destinationName}</Text>
                      <Text style={styles.muted}>{formatDateTime(trip.departureAt)}</Text>
                    </View>
                    <Ionicons color={colors.border} name="chevron-forward" size={18} />
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )
        ) : suggestions.length ? (
          <>
            <Text style={styles.sheetTitle}>Viajes para ti</Text>
            <Text style={styles.muted}>
              Van hacia tus lugares guardados y te recogen en el camino.
            </Text>
            <TripCarousel items={suggestions} onOpen={openTrip} />
          </>
        ) : (
          <>
            <Text style={styles.sheetTitle}>¿A dónde vas?</Text>
            <Text style={styles.muted}>
              Busca tu destino o toca el mapa y te mostraremos solo los viajes que realmente te sirven.
            </Text>
          </>
        )}
      </SafeAreaView>
    </View>
  );
}

/** Relevant trips as swipeable cards, each with why it suits the user. */
function TripCarousel({ items, onOpen }: Readonly<{
  items: RankedMatch<Trip>[];
  onOpen: (trip: Trip) => void;
}>) {
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - 56, 420);
  return (
    <ScrollView
      contentContainerStyle={styles.carousel}
      decelerationRate="fast"
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={cardWidth + spacing[12]}
      style={styles.carouselScroll}
    >
      {items.map(({ item, match }) => (
        <View key={item.id} style={[styles.carouselItem, { width: cardWidth }]}>
          <TripCard match={match} onTripPress={() => onOpen(item)} trip={item} />
        </View>
      ))}
    </ScrollView>
  );
}

function Chip({ icon, label, onPress }: Readonly<{ icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }>) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.chip}>
      <Ionicons color={colors.primary} name={icon} size={16} />
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#E5EEF8', flex: 1 },
  flex: { flex: 1 },
  top: { left: 0, paddingHorizontal: spacing[12], position: 'absolute', right: 0, top: 0 },
  back: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  searchCard: {
    backgroundColor: colors.white,
    borderRadius: radius.radiusXL,
    elevation: 6,
    marginTop: spacing[8],
    maxHeight: 440,
    padding: spacing[8],
    shadowColor: colors.shadow,
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
  },
  pin: {
    alignItems: 'center',
    borderColor: colors.white,
    borderRadius: radius.radiusFull,
    borderWidth: 2,
    elevation: 3,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  tripPin: { backgroundColor: '#8A97A6' },
  tripPinMatch: { backgroundColor: colors.primary },
  selectedPin: { backgroundColor: colors.error, height: 34, width: 34 },
  mapButton: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.radiusFull,
    elevation: 4,
    height: 44,
    justifyContent: 'center',
    position: 'absolute',
    right: 12,
    shadowColor: colors.shadow,
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    top: 236,
    width: 44,
  },
  mapButtonActive: { backgroundColor: colors.primary },
  mapButtonBadge: { position: 'absolute', right: -6, top: -6 },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.radiusXL,
    borderTopRightRadius: radius.radiusXL,
    bottom: 0,
    elevation: 8,
    gap: spacing[8],
    left: 0,
    maxHeight: '50%',
    padding: spacing[16],
    position: 'absolute',
    right: 0,
  },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing[12] },
  iconCircle: { alignItems: 'center', backgroundColor: '#FFEAEA', borderRadius: radius.radiusFull, height: 36, justifyContent: 'center', width: 36 },
  sheetTitle: { ...typography.headingM, color: colors.text },
  muted: { ...typography.bodySmall, color: colors.textSecondary },
  listScroll: { flexGrow: 0 },
  list: { gap: spacing[12], paddingBottom: spacing[8] },
  listTitle: { ...typography.label, color: colors.text, marginTop: spacing[4] },
  carouselScroll: { flexGrow: 0, marginHorizontal: -spacing[16] },
  carousel: { gap: spacing[12], paddingHorizontal: spacing[16], paddingVertical: spacing[4] },
  carouselItem: { gap: spacing[4] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8] },
  chip: {
    alignItems: 'center',
    borderColor: colors.primary,
    borderRadius: radius.radiusFull,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing[12],
    paddingVertical: 6,
  },
  chipText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  tripRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[12], paddingVertical: spacing[8] },
  colorDot: { borderRadius: radius.radiusFull, height: 12, width: 12 },
  tripTitle: { ...typography.bodyMedium, color: colors.text, fontWeight: '600' },
  error: { ...typography.bodySmall, backgroundColor: '#FFEAEA', color: colors.error, padding: spacing[12] },
});
