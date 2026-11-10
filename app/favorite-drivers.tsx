import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { toast } from '@/components/ui/Toast';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { RowSkeleton } from '@/components/ui/Skeleton';
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
  const { t } = useTranslation();
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
      .catch((loadError) => active && setError(errorMessage(loadError, t('favoriteDrivers.loadFailed'))))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [setFavoriteDriverIds, t]);

  const remove = async (driver: FavoriteDriver) => {
    setBusyId(driver.id);
    setError(null);
    try {
      await personalizationService.removeFavoriteDriver(driver.id);
      const remaining = drivers.filter((item) => item.id !== driver.id);
      setDrivers(remaining);
      setFavoriteDriverIds(remaining.map((item) => item.id));
      toast.info(t('favoriteDrivers.removed', { name: driver.name }));
    } catch (removeError) {
      setError(errorMessage(removeError, t('favoriteDrivers.removeFailed')));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader kicker={t('favoriteDrivers.kicker')} title={t('favoriteDrivers.title')} />
        <Text style={styles.subtitle}>{t('favoriteDrivers.subtitle')}</Text>

        {error ? <Notice tone="error">{error}</Notice> : null}
        {loading ? <RowSkeleton count={3} /> : null}
        {!loading && drivers.length === 0 && !error ? (
          <EmptyState
            compact
            icon="star-outline"
            message={t('favoriteDrivers.emptyText')}
            title={t('favoriteDrivers.emptyTitle')}
          />
        ) : null}

        {drivers.map((driver) => (
          <View key={driver.id} style={styles.card}>
            <Avatar imageUrl={driver.avatarUrl} name={driver.name} size={44} />
            <Text numberOfLines={1} style={styles.name}>{driver.name}</Text>
            <Pressable
              accessibilityLabel={t('favoriteDrivers.remove', { name: driver.name })}
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
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing[4] },
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
  error: { ...typography.bodySmall, backgroundColor: colors.errorLight, color: colors.error, padding: spacing[12] },
});
