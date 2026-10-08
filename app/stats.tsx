import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { PlusBadge } from '@/components/subscription/PlusBadge';
import { requirePlus } from '@/components/subscription/PlusGate';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { RowSkeleton } from '@/components/ui/Skeleton';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { DriverStats, PassengerStats, statsService, TripStats } from '@/services/statsService';
import { useAppStore } from '@/store/appStore';
import { usePlan } from '@/subscription/usePlan';
import { errorMessage, formatPrice } from '@/utils/format';

const km = (value: number) => `${value.toLocaleString('es-CO', { maximumFractionDigits: 1 })} km`;
const percent = (part: number, total: number) => (total > 0 ? `${Math.round((part / total) * 100)} %` : '—');
const rating = (value: number, count: number) => (count > 0 ? `${value.toFixed(1).replace('.', ',')} ★` : '—');
const ratingHint = (count: number) => (count > 0 ? `${count} calificaci${count === 1 ? 'ón' : 'ones'}` : 'Sin calificaciones aún');

function Stat({ label, value, hint }: Readonly<{ label: string; value: string; hint?: string }>) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
    </View>
  );
}

function Section({ icon, title, children }: Readonly<{ icon: keyof typeof Ionicons.glyphMap; title: string; children: React.ReactNode }>) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Ionicons color={colors.primary} name={icon} size={20} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.grid}>{children}</View>
    </View>
  );
}

function PassengerSection({ stats }: Readonly<{ stats: PassengerStats }>) {
  return (
    <Section icon="person-outline" title="Como pasajero">
      <Stat label="Viajes realizados" value={String(stats.completed)} />
      <Stat label="Próximos" value={String(stats.upcoming)} />
      <Stat hint="Tu tramo de cada ruta" label="Distancia aprox." value={km(stats.km)} />
      <Stat hint="Precio acordado de tus cupos" label="Aportes a conductores" value={formatPrice(stats.spent)} />
      <Stat label="Conductores distintos" value={String(stats.drivers)} />
      <Stat hint={ratingHint(stats.ratingCount)} label="Tu calificación" value={rating(stats.rating, stats.ratingCount)} />
      <Stat hint="Incluye rechazadas y canceladas" label="Solicitudes" value={String(stats.requests)} />
      <Stat label="No se realizaron" value={String(stats.cancelled)} />
    </Section>
  );
}

function DriverSection({ stats }: Readonly<{ stats: DriverStats }>) {
  return (
    <Section icon="car-outline" title="Como conductor">
      <Stat label="Viajes finalizados" value={String(stats.completed)} />
      <Stat label="Publicados" value={String(stats.published)} />
      <Stat label="Pasajeros llevados" value={String(stats.passengers)} />
      <Stat hint="Pasajeros sobre cupos ofrecidos" label="Ocupación" value={percent(stats.passengers, stats.seatsOffered)} />
      <Stat hint="Según la ruta de cada viaje" label="Distancia aprox." value={km(stats.km)} />
      <Stat hint="Precio × pasajeros" label="Aportes acordados" value={formatPrice(stats.agreed)} />
      <Stat hint="Los que marcaste como recibidos" label="Aportes recibidos" value={formatPrice(stats.paid)} />
      <Stat label="Solicitudes aceptadas" value={percent(stats.accepted, stats.accepted + stats.rejected)} />
      <Stat hint="Finalizados sobre los que no se cancelaron" label="Viajes completados" value={percent(stats.completed, stats.completed + stats.cancelled)} />
      <Stat hint={ratingHint(stats.ratingCount)} label="Tu calificación" value={rating(stats.rating, stats.ratingCount)} />
    </Section>
  );
}

/** Informational summary from the user's own trips (computed by the server). */
export default function StatsScreen() {
  const canDrive = useAppStore((state) => state.currentUser?.driverStatus != null);
  const { can, isBetaPerk } = usePlan();
  const [stats, setStats] = useState<TripStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStats(await statsService.getMyStats());
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError, 'No se pudieron cargar tus estadísticas.'));
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const locked = !can('advanced_trip_stats') && !can('advanced_driver_stats');

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl colors={[colors.primary]} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} refreshing={refreshing} />}
      >
        <ScreenHeader kicker="TUS VIAJES" title="Estadísticas" />
        <View style={styles.introRow}>
          <Text style={styles.subtitle}>Un resumen de tus viajes en ConVía. Las distancias son aproximadas y los aportes son los precios acordados; los pagos ocurren fuera de la app.</Text>
          {isBetaPerk('advanced_trip_stats') ? <PlusBadge compact /> : null}
        </View>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {!stats && !error ? <RowSkeleton count={3} /> : null}
        {locked ? (
          <ButtonSecondary icon="sparkles-outline" onPress={() => requirePlus({ capability: 'advanced_trip_stats' })} title="Ver estadísticas con ConVía+" />
        ) : null}
        {stats?.passenger ? <PassengerSection stats={stats.passenger} /> : null}
        {stats?.driver && (canDrive || stats.driver.published > 0) ? <DriverSection stats={stats.driver} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  introRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing[8] },
  subtitle: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },
  section: { gap: spacing[12] },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  sectionTitle: { ...typography.headingM, color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[8] },
  stat: {
    backgroundColor: colors.white,
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    flexBasis: '48%',
    flexGrow: 1,
    gap: 2,
    padding: spacing[12],
  },
  statValue: { ...typography.headingM, color: colors.text },
  statLabel: { ...typography.bodySmall, color: colors.text, fontWeight: '600' },
  statHint: { ...typography.caption, color: colors.textSecondary },
});
