import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Avatar } from '@/components/ui/Avatar';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { personalizationService } from '@/services/personalizationService';
import { useAppStore } from '@/store/appStore';
import { FavoriteDriver } from '@/types';
import { errorMessage } from '@/utils/format';

export default function FavoriteDriversScreen() {
  const setFavoriteDriverIds = useAppStore((state) => state.setFavoriteDriverIds);
  const [drivers, setDrivers] = useState<FavoriteDriver[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void personalizationService.getFavoriteDrivers()
      .then((items) => {
        if (!active) return;
        setDrivers(items);
        setFavoriteDriverIds(items.map((item) => item.id));
      })
      .catch((loadError) => active && setError(errorMessage(loadError, 'No se pudieron cargar tus favoritos.')))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [setFavoriteDriverIds]);

  const remove = async (driver: FavoriteDriver) => {
    setBusyId(driver.id);
    setError(null);
    try {
      await personalizationService.removeFavoriteDriver(driver.id);
      const remaining = drivers.filter((item) => item.id !== driver.id);
      setDrivers(remaining);
      setFavoriteDriverIds(remaining.map((item) => item.id));
    } catch (removeError) {
      setError(errorMessage(removeError, 'No se pudo quitar de favoritos.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityLabel="Volver" onPress={() => router.back()} style={styles.back}>
          <Ionicons color={colors.text} name="arrow-back" size={24} />
        </Pressable>
        <Text style={styles.kicker}>PERSONALIZACIÓN</Text>
        <Text style={styles.title}>Conductores favoritos</Text>
        <Text style={styles.subtitle}>Sus viajes aparecen destacados y antes que los demás. Para agregar uno, toca la estrella en el detalle de un viaje.</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        {!loading && drivers.length === 0 && !error ? (
          <View style={styles.empty}>
            <Ionicons color={colors.warning} name="star-outline" size={40} />
            <Text style={styles.emptyText}>Aún no tienes conductores favoritos.</Text>
          </View>
        ) : null}

        {drivers.map((driver) => (
          <View key={driver.id} style={styles.card}>
            <Avatar imageUrl={driver.avatarUrl} name={driver.name} size={44} />
            <Text numberOfLines={1} style={styles.name}>{driver.name}</Text>
            <Pressable
              accessibilityLabel={`Quitar a ${driver.name} de favoritos`}
              disabled={busyId === driver.id}
              hitSlop={8}
              onPress={() => void remove(driver)}
              style={styles.starButton}
            >
              {busyId === driver.id
                ? <ActivityIndicator color={colors.warning} size="small" />
                : <Ionicons color={colors.warning} name="star" size={24} />}
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[12], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  back: { alignSelf: 'flex-start', padding: spacing[4] },
  kicker: { ...typography.label, color: colors.primary },
  title: { ...typography.headingXL, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing[4] },
  empty: { alignItems: 'center', gap: spacing[8], paddingVertical: spacing[24] },
  emptyText: { ...typography.body, color: colors.textSecondary },
  card: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing[12],
    padding: spacing[16],
  },
  name: { ...typography.bodyMedium, color: colors.text, flex: 1, fontWeight: '600' },
  starButton: { padding: spacing[4] },
  error: { ...typography.bodySmall, backgroundColor: '#FFEAEA', color: colors.error, padding: spacing[12] },
});
