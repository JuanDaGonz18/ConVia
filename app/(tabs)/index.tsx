import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { RateDriverBanner } from '@/components/trip/RateDriverBanner';
import { Notice } from '@/components/ui/Notice';
import { PlaceSearchField } from '@/components/forms/PlaceSearchField';
import { DriverApprovalNotice } from '@/components/profile/DriverApprovalNotice';
import { ModeSwitch } from '@/components/profile/ModeSwitch';
import { TimePreferenceChips } from '@/components/trip/TimePreferenceChips';
import { TripCard } from '@/components/trip/TripCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { TripListSkeleton } from '@/components/ui/Skeleton';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { isSupabaseEnabled } from '@/lib/supabase';
import { locationService } from '@/services/locationService';
import { rankTripsForJourney, suggestTrips } from '@/services/tripMatching';
import { DriverTripRecord, DriverTripStatus, tripService } from '@/services/tripService';
import { useAppStore } from '@/store/appStore';
import { Location, Trip } from '@/types';
import { errorMessage, formatDateTime, formatPrice } from '@/utils/format';

/** Trips suggested on the passenger home before choosing a destination. */
/** Show the best few first; the rest behind "Ver más". */
const INITIAL_RESULTS = 5;
/** Past trips shown on the driver home. */
const RECENT_COUNT = 3;

const STATUS_LABELS: Record<DriverTripStatus, string> = {
  por_empezar: 'Por empezar',
  en_curso: 'En curso',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
  no_iniciado: 'No iniciado',
};

export default function HomeScreen() {
  const currentUser = useAppStore((state) => state.currentUser);
  const isDriver = currentUser?.role === 'driver';
  const firstName = (currentUser?.name || 'Usuario').split(' ')[0];

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.greeting}>Hola, {firstName}</Text>
          <Text style={styles.headerSubtitle}>{isDriver ? '¿Vas a llevar pasajeros hoy?' : '¿A dónde vas hoy?'}</Text>
        </View>
        <ModeSwitch compact />
      </View>
      {isDriver ? <DriverHome /> : <PassengerHome />}
    </SafeAreaView>
  );
}

/** Opens the full-screen map, only when the user asks for it. */
function MapCard({ subtitle }: Readonly<{ subtitle: string }>) {
  return (
    <Pressable
      accessibilityLabel="Ver mapa"
      accessibilityRole="button"
      onPress={() => router.push('/map')}
      style={({ pressed }) => [styles.mapCard, pressed ? styles.pressed : null]}
    >
      <View style={styles.mapIcon}>
        <Ionicons color={colors.primary} name="map" size={22} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.cardTitle}>Ver mapa</Text>
        <Text style={styles.cardSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons color={colors.textSecondary} name="chevron-forward" size={20} />
    </Pressable>
  );
}

// ─── Passenger ───────────────────────────────────────────────────────────────

function PassengerHome() {
  const savedPlaces = useAppStore((state) => state.savedPlaces);
  const favoriteDriverIds = useAppStore((state) => state.favoriteDriverIds);
  const setSelectedTrip = useAppStore((state) => state.setSelectedTrip);
  const { destination, time } = useAppStore((state) => state.tripSearch);
  const setTripSearch = useAppStore((state) => state.setTripSearch);
  const viewerId = useAppStore((state) => state.currentUser?.id ?? null);
  const [gpsOrigin, setGpsOrigin] = useState<Location | null>(null);
  // 'gps' = where the phone is; the passenger can pick another starting point.
  const [originChoice, setOriginChoice] = useState<Location | null | 'gps'>('gps');
  const origin = originChoice === 'gps' ? gpsOrigin : originChoice;
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      setTrips(await tripService.getAvailableTrips());
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError, 'No se pudieron cargar los viajes.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Where the passenger is: biases the search and is matched as the pickup point.
  useEffect(() => {
    const timer = setTimeout(() => void locationService.getCurrentLocation().then(setGpsOrigin).catch(() => undefined), 0);
    return () => clearTimeout(timer);
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const openTrip = (trip: Trip) => {
    setSelectedTrip(trip);
    router.push('/trip-details');
  };

  // With a destination: trips compatible with the whole journey (origin, destination,
  // route and time). Without one: trips compatible with the passenger's saved places.
  // Leaving near the passenger alone never makes a trip a recommendation.
  const favorites = useMemo(() => new Set(favoriteDriverIds), [favoriteDriverIds]);
  const results = useMemo(
    () => (destination
      ? rankTripsForJourney(trips, { origin, destination, time, favoriteDriverIds: favorites, viewerId })
      : suggestTrips(trips, { origin, places: savedPlaces, favoriteDriverIds: favorites, time, viewerId })),
    [destination, favorites, origin, savedPlaces, time, trips, viewerId],
  );
  const shown = expanded ? results : results.slice(0, INITIAL_RESULTS);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl colors={[colors.primary]} onRefresh={() => void refresh()} refreshing={refreshing} />}
    >
      <RateDriverBanner />
      <View style={styles.searchCard}>
        <PlaceSearchField
          label="¿A dónde vas?"
          mapLink="afterSelection"
          mapTitle="Ajusta tu destino"
          near={origin}
          onChange={(place) => {
            setTripSearch({ destination: place });
            setExpanded(false);
          }}
          placeholder="Busca un lugar o dirección"
          quickPlaces={savedPlaces}
          value={destination}
        />
        {destination ? (
          <PlaceSearchField
            allowCurrentLocation
            label="Desde"
            mapLink="afterSelection"
            mapTitle="Dónde te recogen"
            near={gpsOrigin}
            onChange={(place) => {
              setOriginChoice(place);
              setExpanded(false);
            }}
            placeholder="Busca dónde te recogen"
            quickPlaces={savedPlaces}
            value={origin}
          />
        ) : null}
        <TimePreferenceChips
          onChange={(value) => {
            setTripSearch({ time: value });
            setExpanded(false);
          }}
          value={time}
        />
        {savedPlaces.length === 0 ? (
          <Pressable onPress={() => router.push('/saved-places')} style={styles.inlineLink}>
            <Ionicons color={colors.primary} name="bookmark-outline" size={14} />
            <Text style={styles.inlineLinkText}>Guarda tu casa, trabajo o universidad para elegirlos con un toque</Text>
          </Pressable>
        ) : null}
      </View>

      <MapCard subtitle="Explora los viajes cerca de ti" />

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          {destination ? `Viajes hacia ${destination.label}` : 'Viajes para ti'}
        </Text>
        {!loading && results.length ? (
          <Text style={styles.sectionMeta}>
            {`${results.length} compatible${results.length === 1 ? '' : 's'}`}
          </Text>
        ) : null}
      </View>

      {loading ? <TripListSkeleton count={2} /> : null}
      {error ? <Notice action={{ label: 'Reintentar', onPress: () => void refresh() }} tone="error">{error}</Notice> : null}

      {!loading && !error && results.length === 0 ? (
        <EmptyState
          action={destination
            ? { label: 'Buscar otro destino', icon: 'search-outline', onPress: () => setTripSearch({ destination: null }) }
            : trips.length ? { label: `Ver todos los viajes (${trips.length})`, icon: 'list-outline', onPress: () => router.push('/(tabs)/trips') } : undefined}
          icon={destination ? 'navigate-outline' : 'car-outline'}
          message={!isSupabaseEnabled
            ? 'Conecta la app al servidor para ver viajes reales.'
            : destination
              ? time === 'any'
                ? 'Ningún viaje publicado va hacia allá ni pasa cerca en su ruta. Vuelve a mirar más tarde: los conductores publican durante el día.'
                : 'Ningún viaje compatible sale en ese horario. Prueba con "Cualquier momento" o vuelve más tarde.'
              : savedPlaces.length
                ? 'Ningún viaje va hacia tus lugares guardados por ahora. Busca tu destino arriba para ver otros viajes compatibles.'
                : 'Busca tu destino arriba y te mostraremos los viajes que realmente te sirven.'}
          title={!isSupabaseEnabled
            ? 'Modo demostración'
            : destination ? 'No encontramos viajes compatibles' : savedPlaces.length ? 'Nada hacia tus lugares por ahora' : '¿A dónde vas?'}
        />
      ) : null}

      {shown.map(({ item, match }) => (
        <TripCard key={item.id} match={match} onTripPress={() => openTrip(item)} trip={item} />
      ))}

      {!expanded && results.length > shown.length ? (
        <Pressable onPress={() => setExpanded(true)} style={styles.seeAll}>
          <Text style={styles.seeAllText}>Ver más viajes compatibles ({results.length - shown.length})</Text>
          <Ionicons color={colors.primary} name="chevron-down" size={16} />
        </Pressable>
      ) : null}
      {/* With no results, the empty state already offers this. */}
      {!destination && trips.length > 0 && results.length > 0 ? (
        <Pressable onPress={() => router.push('/(tabs)/trips')} style={styles.seeAll}>
          <Text style={styles.seeAllText}>Ver todos los viajes ({trips.length})</Text>
          <Ionicons color={colors.primary} name="arrow-forward" size={16} />
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

// ─── Driver ──────────────────────────────────────────────────────────────────

function DriverHome() {
  const driverStatus = useAppStore((state) => state.currentUser?.driverStatus);
  const savedPlaces = useAppStore((state) => state.savedPlaces);
  const approved = driverStatus === 'aprobado';
  const [plannedDestination, setPlannedDestination] = useState<Location | null>(null);
  const [trips, setTrips] = useState<DriverTripRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTrips(await tripService.getDriverTrips());
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError, 'No se pudieron cargar tus viajes.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const upcoming = trips
    .filter((trip) => trip.status === 'por_empezar' || trip.status === 'en_curso')
    .sort((a, b) => new Date(a.departureAt).getTime() - new Date(b.departureAt).getTime());
  const next = upcoming[0] ?? null;
  // getDriverTrips is newest first.
  const recent = trips.filter((trip) => trip.status !== 'por_empezar' && trip.status !== 'en_curso').slice(0, RECENT_COUNT);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl colors={[colors.primary]} onRefresh={() => void refresh()} refreshing={refreshing} />}
    >
      {approved ? (
        <View style={styles.searchCard}>
          <PlaceSearchField
            label="¿A dónde vas a llevar pasajeros?"
            mapLink="afterSelection"
            mapTitle="Ajusta el destino"
            onChange={setPlannedDestination}
            placeholder="Busca un lugar o dirección"
            quickPlaces={savedPlaces}
            value={plannedDestination}
          />
          {plannedDestination ? (
            <ButtonPrimary
              onPress={() => router.push({
                pathname: '/create-trip',
                params: {
                  destLat: String(plannedDestination.latitude),
                  destLng: String(plannedDestination.longitude),
                  destLabel: plannedDestination.label,
                },
              })}
              title="Planear un viaje hacia aquí"
            />
          ) : (
            <Pressable onPress={() => router.push('/create-trip')} style={styles.inlineLink}>
              <Ionicons color={colors.primary} name="add-circle-outline" size={14} />
              <Text style={styles.inlineLinkText}>O publica un viaje desde cero</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <DriverApprovalNotice status={driverStatus} />
      )}

      <View style={styles.quickGrid}>
        <QuickAction icon="document-text-outline" label="Solicitudes" onPress={() => router.push('/requests')} />
        <QuickAction icon="car-outline" label="Vehículos" onPress={() => router.push('/vehicles')} />
        <QuickAction icon="chatbubbles-outline" label="Chats" onPress={() => router.push('/(tabs)/chats')} />
        <QuickAction icon="qr-code-outline" label="Escanear QR" onPress={() => router.push('/qr-scanner')} />
      </View>

      <MapCard subtitle="Tu ubicación y tus viajes próximos" />

      {error ? <Notice action={{ label: 'Reintentar', onPress: () => void refresh() }} tone="error">{error}</Notice> : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Tu próximo viaje</Text>
        {upcoming.length > 1 ? <Text style={styles.sectionMeta}>{upcoming.length} programados</Text> : null}
      </View>
      {loading ? <TripListSkeleton count={1} /> : null}
      {!loading && !next ? (
        <View style={styles.emptySmall}>
          <Ionicons color={colors.primary} name="calendar-outline" size={20} />
          <Text style={styles.emptyText}>No tienes viajes programados. Publica uno o repite un viaje reciente con un toque.</Text>
        </View>
      ) : null}
      {next ? (
        <View style={[styles.tripCard, styles.nextCard]}>
          <View style={styles.tripHeader}>
            <Text numberOfLines={2} style={styles.tripRoute}>{next.originName} → {next.destinationName}</Text>
            <Text style={[styles.badge, next.status === 'en_curso' ? styles.badgeLive : null]}>{STATUS_LABELS[next.status]}</Text>
          </View>
          <View style={styles.tripMetaRow}>
            <Ionicons color={colors.textSecondary} name="time-outline" size={14} />
            <Text style={styles.tripMeta}>{formatDateTime(next.departureAt)}</Text>
          </View>
          <View style={styles.tripMetaRow}>
            <Ionicons color={colors.textSecondary} name="people-outline" size={14} />
            <Text style={styles.tripMeta}>{next.totalSeats} cupos · {formatPrice(next.price)}</Text>
          </View>
          <View style={styles.tripActions}>
            <SmallAction icon="document-text-outline" label="Solicitudes" onPress={() => router.push('/requests')} />
            {next.status === 'por_empezar' ? (
              <SmallAction icon="create-outline" label="Editar" onPress={() => router.push({ pathname: '/create-trip', params: { edit: next.id } })} />
            ) : (
              <SmallAction icon="qr-code-outline" label="Escanear QR" onPress={() => router.push('/qr-scanner')} />
            )}
            <SmallAction icon="list-outline" label="Mis viajes" onPress={() => router.push('/(tabs)/trips')} />
          </View>
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Viajes recientes</Text>
        {recent.length ? (
          <Pressable hitSlop={8} onPress={() => router.push('/(tabs)/trips')}>
            <Text style={styles.seeAllText}>Ver todos</Text>
          </Pressable>
        ) : null}
      </View>
      {!loading && recent.length === 0 ? (
        <View style={styles.emptySmall}>
          <Ionicons color={colors.primary} name="repeat-outline" size={20} />
          <Text style={styles.emptyText}>Tus viajes terminados aparecerán aquí para repetirlos con un toque.</Text>
        </View>
      ) : null}
      {recent.map((trip) => (
        <View key={trip.id} style={styles.tripCard}>
          <View style={styles.tripHeader}>
            <Text numberOfLines={2} style={styles.tripRoute}>{trip.originName} → {trip.destinationName}</Text>
            <Text style={[styles.badge, trip.status === 'finalizado' ? styles.badgeDone : styles.badgeMuted]}>{STATUS_LABELS[trip.status]}</Text>
          </View>
          <Text style={styles.tripMeta}>{formatDateTime(trip.departureAt)} · {trip.totalSeats} cupos · {formatPrice(trip.price)}</Text>
          <View style={styles.tripActions}>
            {approved ? (
              <SmallAction
                icon="repeat"
                label="Repetir viaje"
                onPress={() => router.push({ pathname: '/create-trip', params: { repeatFrom: trip.id } })}
                primary
              />
            ) : null}
            <SmallAction
              icon={trip.status === 'finalizado' ? 'people-outline' : 'time-outline'}
              label={trip.status === 'finalizado' ? 'Pasajeros y pagos' : 'Ver historial'}
              onPress={() => router.push({ pathname: '/trip-summary', params: { tripId: trip.id } })}
            />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function QuickAction({ icon, label, onPress }: Readonly<{ icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }>) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.quickAction, pressed ? styles.pressed : null]}>
      <Ionicons color={colors.primary} name={icon} size={22} />
      <Text numberOfLines={1} style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}

function SmallAction({ icon, label, onPress, primary = false }: Readonly<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  primary?: boolean;
}>) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.smallAction, primary ? styles.smallActionPrimary : null, pressed ? styles.pressed : null]}
    >
      <Ionicons color={primary ? colors.white : colors.primary} name={icon} size={16} />
      <Text style={[styles.smallActionText, primary ? styles.smallActionTextPrimary : null]}>{label}</Text>
    </Pressable>
  );
}

const cardBase = {
  backgroundColor: colors.white,
  borderColor: colors.lightGray,
  borderRadius: radius.radiusLarge,
  borderWidth: 1,
} as const;

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  header: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderBottomColor: colors.lightGray,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing[12],
    paddingHorizontal: dimensions.screenPadding,
    paddingVertical: spacing[12],
  },
  headerText: { flex: 1 },
  greeting: { ...typography.headingM, color: colors.text },
  headerSubtitle: { ...typography.caption, color: colors.textSecondary },
  content: {
    gap: spacing[16],
    paddingBottom: dimensions.bottomNavigationHeight + spacing[32],
    paddingHorizontal: dimensions.screenPadding,
    paddingTop: spacing[16],
  },
  searchCard: { ...cardBase, gap: spacing[8], padding: spacing[16] },
  inlineLink: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  inlineLinkText: { ...typography.caption, color: colors.primary, flex: 1 },
  mapCard: { ...cardBase, alignItems: 'center', flexDirection: 'row', gap: spacing[12], padding: spacing[16] },
  mapIcon: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusMedium,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  cardTitle: { ...typography.bodyMedium, color: colors.text, fontWeight: '700' },
  cardSubtitle: { ...typography.caption, color: colors.textSecondary },
  sectionHeader: { alignItems: 'baseline', flexDirection: 'row', gap: spacing[8], justifyContent: 'space-between', marginTop: spacing[4] },
  sectionTitle: { ...typography.headingM, color: colors.text, flex: 1 },
  sectionMeta: { ...typography.caption, color: colors.textSecondary },
  emptyText: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },
  emptySmall: { ...cardBase, alignItems: 'center', borderStyle: 'dashed', flexDirection: 'row', gap: spacing[12], padding: spacing[16] },
  seeAll: { alignItems: 'center', alignSelf: 'center', flexDirection: 'row', gap: spacing[4], padding: spacing[8] },
  seeAllText: { ...typography.bodySmall, color: colors.primary, fontWeight: '700' },
  error: { ...typography.bodySmall, backgroundColor: '#FFEAEA', color: colors.error, padding: spacing[12] },
  quickGrid: { flexDirection: 'row', gap: spacing[8] },
  quickAction: { ...cardBase, alignItems: 'center', flex: 1, gap: spacing[4], paddingVertical: spacing[12] },
  quickLabel: { ...typography.caption, color: colors.text, fontWeight: '600' },
  tripCard: { ...cardBase, gap: spacing[8], padding: spacing[16] },
  nextCard: { borderColor: colors.primary, borderWidth: 1.5 },
  tripHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing[8] },
  tripRoute: { ...typography.bodyMedium, color: colors.text, flex: 1, fontWeight: '700' },
  tripMetaRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[4] },
  tripMeta: { ...typography.bodySmall, color: colors.textSecondary },
  badge: {
    ...typography.caption,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusFull,
    color: colors.primary,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: spacing[8],
    paddingVertical: 2,
  },
  badgeLive: { backgroundColor: '#E8F7EF', color: colors.success },
  badgeDone: { backgroundColor: '#E8F7EF', color: colors.success },
  badgeMuted: { backgroundColor: colors.lightGray, color: colors.textSecondary },
  tripActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8], marginTop: spacing[4] },
  smallAction: {
    alignItems: 'center',
    borderColor: colors.primary,
    borderRadius: radius.radiusFull,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing[12],
    paddingVertical: 6,
  },
  smallActionPrimary: { backgroundColor: colors.primary },
  smallActionText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  smallActionTextPrimary: { color: colors.white },
});
