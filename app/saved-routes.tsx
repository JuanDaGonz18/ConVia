import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { PlusBadge } from '@/components/subscription/PlusBadge';
import { requirePlus } from '@/components/subscription/PlusGate';
import { TripCard } from '@/components/trip/TripCard';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { toast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { personalizationService } from '@/services/personalizationService';
import { describeDays, formatClock } from '@/services/recurringTripService';
import { matchTrip, TripMatch } from '@/services/tripMatching';
import { tripService } from '@/services/tripService';
import { useAppStore } from '@/store/appStore';
import { LIMIT_INFO } from '@/subscription/plans';
import { usePlan } from '@/subscription/usePlan';
import { SavedRoute, Trip } from '@/types';
import { errorMessage } from '@/utils/format';

function describeWhen(route: SavedRoute) {
  const days = route.days.length ? describeDays(route.days) : 'Cualquier día';
  return route.timeFrom && route.timeTo ? `${days} · ${formatClock(route.timeFrom)} a ${formatClock(route.timeTo)}` : `${days} · cualquier hora`;
}

/** Saved routes (search shortcuts and alerts) and the trips the alerts found. */
export default function SavedRoutesScreen() {
  const routes = useAppStore((state) => state.savedRoutes);
  const setSavedRoutes = useAppStore((state) => state.setSavedRoutes);
  const setTripSearch = useAppStore((state) => state.setTripSearch);
  const setSelectedTrip = useAppStore((state) => state.setSelectedTrip);
  const viewerId = useAppStore((state) => state.currentUser?.id ?? null);
  const { can, isBetaPerk, limit, atLimit } = usePlan();
  const [found, setFound] = useState<{ trip: Trip; route: SavedRoute | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<SavedRoute | null>(null);
  const [error, setError] = useState<string | null>(null);
  const full = atLimit('saved_routes', routes.length);
  const routeLimit = limit('saved_routes');

  const load = useCallback(async () => {
    try {
      const [savedRoutes, hits] = await Promise.all([personalizationService.getSavedRoutes(), personalizationService.getAlertHits()]);
      setSavedRoutes(savedRoutes);
      // Only trips that are still open (available_trips hides started, full or past ones).
      const trips = await tripService.getAvailableTripsByIds(hits.map((hit) => hit.tripId));
      const byId = new Map(trips.map((trip) => [trip.id, trip]));
      setFound(hits.flatMap((hit) => {
        const trip = byId.get(hit.tripId);
        return trip ? [{ trip, route: savedRoutes.find((route) => route.id === hit.routeId) ?? null }] : [];
      }));
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError, 'No se pudieron cargar tus rutas.'));
    } finally {
      setLoading(false);
    }
  }, [setSavedRoutes]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Same compatibility as the rest of the app, against the route that found the trip.
  const matches = useMemo(() => new Map<string, TripMatch | null>(found.map(({ trip, route }) => [
    trip.id,
    route ? matchTrip(trip, { origin: route.origin, destination: route.destination, viewerId }) : null,
  ])), [found, viewerId]);

  const search = (route: SavedRoute) => {
    setTripSearch({ destination: route.destination, origin: route.origin });
    router.navigate('/(tabs)');
  };

  const toggleAlert = async (route: SavedRoute, alert: boolean) => {
    if (alert && !can('smart_match_alerts')) {
      requirePlus({ capability: 'smart_match_alerts' });
      return;
    }
    setBusyId(route.id);
    setError(null);
    try {
      await personalizationService.setRouteAlert(route.id, alert);
      setSavedRoutes(routes.map((item) => (item.id === route.id ? { ...item, alert } : item)));
      toast.info(alert ? 'Te avisaremos de viajes compatibles nuevos' : 'Alerta desactivada');
    } catch (toggleError) {
      setError(errorMessage(toggleError, 'No se pudo cambiar la alerta.'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (route: SavedRoute) => {
    setToDelete(null);
    setBusyId(route.id);
    try {
      await personalizationService.deleteRoute(route.id);
      setSavedRoutes(routes.filter((item) => item.id !== route.id));
      toast.info('Ruta eliminada');
    } catch (removeError) {
      setError(errorMessage(removeError, 'No se pudo eliminar la ruta.'));
    } finally {
      setBusyId(null);
    }
  };

  const add = () => {
    if (full) requirePlus({ limit: 'saved_routes' });
    else router.push('/route');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl colors={[colors.primary]} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} refreshing={refreshing} />}
      >
        <ScreenHeader kicker="TUS VIAJES" title="Rutas y alertas" />
        <Text style={styles.subtitle}>
          Guarda los trayectos que haces seguido para buscarlos con un toque. Con la alerta activa te avisamos cuando se publica un viaje compatible.
        </Text>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {loading ? <ActivityIndicator color={colors.primary} /> : null}

        {!loading && !routes.length ? (
          <EmptyState compact icon="git-branch-outline" message="Por ejemplo, de tu casa a la universidad entre las 6 y las 7 a. m." title="Aún no tienes rutas" />
        ) : null}

        {routes.map((route) => (
          <View key={route.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.flex}>
                <Text numberOfLines={1} style={styles.cardTitle}>{route.name}</Text>
                {route.name !== `${route.origin.label} → ${route.destination.label}` ? (
                  <Text numberOfLines={2} style={styles.meta}>{route.origin.label} → {route.destination.label}</Text>
                ) : null}
                <Text style={styles.meta}>{describeWhen(route)}</Text>
              </View>
              {busyId === route.id ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <View style={styles.alertSwitch}>
                  <Ionicons color={route.alert ? colors.primary : colors.textSecondary} name={route.alert ? 'notifications' : 'notifications-off-outline'} size={16} />
                  <Switch
                    accessibilityLabel={route.alert ? 'Desactivar alerta' : 'Activar alerta'}
                    onValueChange={(value) => void toggleAlert(route, value)}
                    thumbColor={route.alert ? colors.primary : undefined}
                    trackColor={{ true: colors.primaryLight }}
                    value={route.alert}
                  />
                </View>
              )}
            </View>
            <View style={styles.actions}>
              <Pressable accessibilityRole="button" onPress={() => search(route)} style={styles.action}>
                <Ionicons color={colors.primary} name="search-outline" size={16} />
                <Text style={styles.actionText}>Buscar viajes</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/route', params: { id: route.id } })} style={styles.action}>
                <Ionicons color={colors.primary} name="create-outline" size={16} />
                <Text style={styles.actionText}>Editar</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setToDelete(route)} style={styles.action}>
                <Ionicons color={colors.error} name="trash-outline" size={16} />
                <Text style={[styles.actionText, styles.danger]}>Eliminar</Text>
              </Pressable>
            </View>
          </View>
        ))}

        {routeLimit !== null && !loading ? (
          <View style={styles.planRow}>
            {isBetaPerk('smart_match_alerts') ? <PlusBadge compact /> : null}
            <Text style={styles.planText}>
              {full ? LIMIT_INFO.saved_routes.reachedText(routeLimit) : `Puedes guardar hasta ${routeLimit} rutas.`}
              {isBetaPerk('smart_match_alerts') ? ' Las alertas son de ConVía+ y están abiertas durante la beta.' : ''}
            </Text>
          </View>
        ) : null}
        <ButtonPrimary icon="add-circle-outline" onPress={add} title="Nueva ruta" />

        <Text style={styles.sectionTitle}>Viajes que encontraron tus alertas</Text>
        {!loading && !found.length ? (
          <Text style={styles.meta}>
            {routes.some((route) => route.alert)
              ? 'Aún no hay viajes nuevos compatibles con tus rutas. Te avisaremos apenas se publique uno.'
              : 'Activa la alerta de una ruta para ver aquí los viajes compatibles que se publiquen.'}
          </Text>
        ) : null}
        {found.map(({ trip }) => (
          <TripCard
            key={trip.id}
            match={matches.get(trip.id) ?? null}
            onTripPress={() => {
              setSelectedTrip(trip);
              router.push('/trip-details');
            }}
            trip={trip}
          />
        ))}
      </ScrollView>

      <ConfirmDialog
        cancelLabel="Volver"
        confirmLabel="Sí, eliminar"
        icon="trash-outline"
        message="Dejarás de recibir alertas de esta ruta."
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && void remove(toDelete)}
        title={`¿Eliminar "${toDelete?.name ?? 'esta ruta'}"?`}
        tone="danger"
        visible={toDelete !== null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  flex: { flex: 1, gap: 2 },
  subtitle: { ...typography.body, color: colors.textSecondary },
  card: {
    backgroundColor: colors.white,
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    gap: spacing[8],
    padding: spacing[16],
  },
  cardHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing[8] },
  cardTitle: { ...typography.bodyMedium, color: colors.text, fontWeight: '700' },
  meta: { ...typography.bodySmall, color: colors.textSecondary },
  alertSwitch: { alignItems: 'center', flexDirection: 'row', gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[16] },
  action: { alignItems: 'center', flexDirection: 'row', gap: spacing[4], paddingVertical: spacing[4] },
  actionText: { ...typography.bodySmall, color: colors.primary, fontWeight: '700' },
  danger: { color: colors.error },
  planRow: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.radiusMedium,
    flexDirection: 'row',
    gap: spacing[8],
    padding: spacing[12],
  },
  planText: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },
  sectionTitle: { ...typography.headingM, color: colors.text, marginTop: spacing[8] },
});
