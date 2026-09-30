import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import MapView, { Marker, Polyline, Region } from 'react-native-maps';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Notice } from '@/components/ui/Notice';
import { PlaceSearchField } from '@/components/forms/PlaceSearchField';
import { TripCard } from '@/components/trip/TripCard';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { locationService } from '@/services/locationService';
import { DriverTripRecord, tripService } from '@/services/tripService';
import { useAppStore } from '@/store/appStore';
import { Location, Trip } from '@/types';
import { errorMessage, formatDateTime, formatPrice } from '@/utils/format';
import { hasCoordinates, RankedTrip, rankTrips, tripsForDestination } from '@/utils/tripRanking';

const BOGOTA: Region = { latitude: 4.711, longitude: -74.0721, latitudeDelta: 0.25, longitudeDelta: 0.25 };
const EDGE_PADDING = { top: 220, right: 50, bottom: 320, left: 50 };
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
  const setSelectedTrip = useAppStore((state) => state.setSelectedTrip);
  const mapRef = useRef<MapView>(null);
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
        mapRef.current?.animateToRegion({ ...pick(location), latitudeDelta: 0.08, longitudeDelta: 0.08 }, 600);
      }).catch(() => undefined);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const focusOn = (points: Point[]) => {
    if (points.length === 1) mapRef.current?.animateToRegion({ ...points[0], latitudeDelta: 0.03, longitudeDelta: 0.03 }, 500);
    else if (points.length > 1) mapRef.current?.fitToCoordinates(points, { edgePadding: EDGE_PADDING, animated: true });
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

  // Passenger results for the chosen destination (arriving first, then passing near),
  // ordered so those the user can catch near them come first.
  const { arriving, passing } = selected && !isDriver ? tripsForDestination(trips, selected) : { arriving: [], passing: [] };
  const rankedArriving = rankTrips(arriving, savedPlaces, favoriteDriverIds, me);
  const rankedPassing = rankTrips(passing, savedPlaces, favoriteDriverIds, me);
  const passingIds = new Set(passing.map((trip) => trip.id));
  // Without a destination: only trips that suit the user (near them, to their places, favorite drivers).
  const suggestions = !selected && !isDriver ? rankTrips(trips, savedPlaces, favoriteDriverIds, me).filter((item) => item.relevant) : [];
  const shownTrips = selected ? [...rankedArriving, ...rankedPassing] : suggestions;
  const highlighted = new Set(shownTrips.map((item) => item.trip.id));
  const focusedTrip = driverTrips.find((trip) => trip.id === focusedTripId) ?? null;
  const distanceFromMe = selected && me ? locationService.distanceKm(me, selected) : null;

  return (
    <View style={styles.root}>
      <MapView
        initialRegion={BOGOTA}
        // Keeps Google's own controls (my-location button, logo) clear of the search bar and the sheet.
        mapPadding={{ top: 170, right: 0, bottom: Math.round(windowHeight * 0.45), left: 0 }}
        onPoiClick={(event) => {
          const { coordinate, name } = event.nativeEvent;
          void chooseAt({ ...coordinate, name: name.split('\n')[0].trim() });
        }}
        onPress={(event) => {
          if (event.nativeEvent.action === 'marker-press') return;
          void chooseAt(event.nativeEvent.coordinate);
        }}
        ref={mapRef}
        showsMyLocationButton
        showsUserLocation
        style={StyleSheet.absoluteFill}
        toolbarEnabled={false}
      >
        {/* Driver: each upcoming trip with its departure, destination and route. */}
        {isDriver ? driverTrips.map((trip, index) => {
          if (!trip.origin || !trip.destination) return null;
          const color = TRIP_COLORS[index % TRIP_COLORS.length];
          const faded = focusedTripId !== null && focusedTripId !== trip.id;
          const path = trip.route?.coordinates ?? [trip.origin, trip.destination];
          return (
            <Fragment key={trip.id}>
              <Polyline
                coordinates={path}
                lineDashPattern={trip.route ? undefined : [8, 6]}
                strokeColor={faded ? '#B8C2CC' : color}
                strokeWidth={faded ? 3 : 5}
                tappable
                onPress={() => {
                  setSelected(null);
                  setFocusedTripId(trip.id);
                }}
              />
              <Marker coordinate={trip.origin} onPress={() => { setSelected(null); setFocusedTripId(trip.id); }} title={trip.originName}>
                <View style={[styles.pin, { backgroundColor: '#10B981' }]}><Ionicons color={colors.white} name="navigate" size={12} /></View>
              </Marker>
              <Marker coordinate={trip.destination} onPress={() => { setSelected(null); setFocusedTripId(trip.id); }} title={trip.destinationName}>
                <View style={[styles.pin, { backgroundColor: color }]}><Ionicons color={colors.white} name="flag" size={12} /></View>
              </Marker>
            </Fragment>
          );
        }) : null}

        {/* Passenger: departure points of available trips; the ones that suit the destination stand out. */}
        {!isDriver ? trips.filter((trip) => hasCoordinates(trip.origin)).map((trip) => {
          const match = highlighted.has(trip.id);
          return (
            <Marker coordinate={trip.origin} key={trip.id} onPress={() => openTrip(trip)} title={trip.driver.name}>
              <View style={[styles.pin, match ? styles.tripPinMatch : styles.tripPin]}>
                <Ionicons color={colors.white} name="car" size={12} />
              </View>
            </Marker>
          );
        }) : null}
        {!isDriver ? shownTrips.filter((item) => item.trip.route).map(({ trip }) => (
          <Polyline coordinates={trip.route!.coordinates} key={`route-${trip.id}`} strokeColor="rgba(0,111,253,0.45)" strokeWidth={4} />
        )) : null}

        {selected ? (
          <Marker
            coordinate={selected}
            draggable
            onDragEnd={(event) => void chooseAt(event.nativeEvent.coordinate)}
            title={selected.label}
          >
            <View style={[styles.pin, styles.selectedPin]}><Ionicons color={colors.white} name="location" size={16} /></View>
          </Marker>
        ) : null}
      </MapView>

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
                <Text style={styles.muted}>Ningún conductor va hacia allá ni pasa cerca por ahora.</Text>
              ) : (
                <>
                  <Text style={styles.listTitle}>
                    {rankedArriving.length ? `${rankedArriving.length} llega${rankedArriving.length === 1 ? '' : 'n'} cerca` : ''}
                    {rankedArriving.length && rankedPassing.length ? ' · ' : ''}
                    {rankedPassing.length ? `${rankedPassing.length} pasa${rankedPassing.length === 1 ? '' : 'n'} cerca en su ruta` : ''}
                  </Text>
                  <TripCarousel items={shownTrips} onOpen={openTrip} passingIds={passingIds} />
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
              {me ? 'Salen o pasan cerca de ti, van a tus lugares o son de tus conductores favoritos.' : 'Van a tus lugares o son de tus conductores favoritos.'}
            </Text>
            <TripCarousel items={suggestions} onOpen={openTrip} />
          </>
        ) : (
          <>
            <Text style={styles.sheetTitle}>Nada cerca de ti por ahora</Text>
            <Text style={styles.muted}>
              Ningún viaje sale ni pasa cerca de ti ni va a tus lugares guardados. Busca tu destino o toca el mapa para ver quién va hacia allá.
            </Text>
          </>
        )}
      </SafeAreaView>
    </View>
  );
}

/** Relevant trips as swipeable cards, each with why it suits the user. */
function TripCarousel({ items, onOpen, passingIds }: Readonly<{
  items: RankedTrip[];
  onOpen: (trip: Trip) => void;
  passingIds?: Set<string>;
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
      {items.map((item) => (
        <View key={item.trip.id} style={[styles.carouselItem, { width: cardWidth }]}>
          {passingIds?.has(item.trip.id) ? (
            <View style={styles.passingTag}>
              <Ionicons color={colors.primary} name="git-branch-outline" size={14} />
              <Text style={styles.passingText}>Pasa cerca de tu destino en su ruta</Text>
            </View>
          ) : null}
          <TripCard
            favoriteDriver={item.favoriteDriver}
            nearPlace={item.nearPlace}
            onTripPress={() => onOpen(item.trip)}
            pickup={item.pickup}
            trip={item.trip}
          />
        </View>
      ))}
    </ScrollView>
  );
}

function pick(location: Location): Point {
  return { latitude: location.latitude, longitude: location.longitude };
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
  passingTag: { alignItems: 'center', flexDirection: 'row', gap: 4, paddingHorizontal: spacing[4] },
  passingText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
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
