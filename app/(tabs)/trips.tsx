import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TripCard } from '@/components/trip/TripCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { radius } from '@/constants/radius';
import { mockTrips } from '@/data/mock/trips';

type FilterType = 'all' | 'pending' | 'accepted' | 'driver_arriving';

export default function TripsScreen() {
  const [filter, setFilter] = useState<FilterType>('all');

  const filteredTrips = mockTrips.filter((trip) => {
    if (filter === 'all') return true;
    return trip.status === filter;
  });

  const filterOptions: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'Todos' },
    { key: 'pending', label: 'Disponibles' },
    { key: 'accepted', label: 'Aceptados' },
    { key: 'driver_arriving', label: 'En camino' },
  ];

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.kicker}>WHEELSAPP</Text>
        <Text style={styles.title}>Viajes</Text>
        <Text style={styles.subtitle}>
          Explora y gestiona tus viajes compartidos en Bogotá
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filtersContainer}
        >
          {filterOptions.map((opt) => {
            const isActive = filter === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => setFilter(opt.key)}
                style={[styles.filterPill, isActive ? styles.filterPillActive : null]}
              >
                <Text
                  style={[
                    styles.filterText,
                    isActive ? styles.filterTextActive : null,
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.listContent}>
        {filteredTrips.length === 0 ? (
          <EmptyState
            title="No hay viajes con este filtro"
            message="Prueba seleccionando 'Todos' para ver las opciones disponibles."
          />
        ) : (
          filteredTrips.map((trip) => <TripCard key={trip.id} trip={trip} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    backgroundColor: colors.white,
    borderBottomColor: colors.lightGray,
    borderBottomWidth: 1,
    gap: spacing[8],
    paddingHorizontal: dimensions.screenPadding,
    paddingTop: spacing[16],
    paddingBottom: spacing[12],
  },
  kicker: {
    ...typography.label,
    color: colors.primary,
  },
  title: {
    ...typography.headingXL,
    color: colors.text,
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  filtersContainer: {
    flexDirection: 'row',
    gap: spacing[8],
    paddingTop: spacing[8],
  },
  filterPill: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radius.radiusFull,
    borderWidth: 1,
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[8],
  },
  filterPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  filterTextActive: {
    color: colors.white,
  },
  listContent: {
    gap: spacing[16],
    paddingBottom: dimensions.bottomNavigationHeight + spacing[24],
    paddingHorizontal: dimensions.screenPadding,
    paddingTop: spacing[16],
  },
});
