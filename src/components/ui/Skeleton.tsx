import { useEffect, useState } from 'react';
import { Animated, DimensionValue, StyleSheet, View } from 'react-native';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';

/** Gently pulsing placeholder shown while content loads. */
export function Skeleton({ width = '100%', height = 14, round = false }: Readonly<{ width?: DimensionValue; height?: number; round?: boolean }>) {
  const [opacity] = useState(() => new Animated.Value(0.5));
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={[styles.block, { borderRadius: round ? height / 2 : radius.radiusSmall, height, opacity, width }]}
    />
  );
}

/** Placeholder with the shape of a trip card. */
export function TripCardSkeleton() {
  return (
    <View accessibilityLabel="Cargando" style={styles.card}>
      <View style={styles.row}>
        <Skeleton height={44} round width={44} />
        <View style={styles.lines}>
          <Skeleton width="60%" />
          <Skeleton height={12} width="30%" />
        </View>
      </View>
      <Skeleton width="85%" />
      <Skeleton width="70%" />
      <View style={styles.row}>
        <Skeleton height={12} width="45%" />
        <View style={styles.flex} />
        <Skeleton height={18} width={70} />
      </View>
    </View>
  );
}

/** A few trip-card placeholders. */
export function TripListSkeleton({ count = 2 }: Readonly<{ count?: number }>) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }, (_, index) => <TripCardSkeleton key={index} />)}
    </View>
  );
}

/** Placeholder rows for simple lists (chats, requests). */
export function RowSkeleton({ count = 3 }: Readonly<{ count?: number }>) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={[styles.card, styles.row]}>
          <Skeleton height={44} round width={44} />
          <View style={styles.lines}>
            <Skeleton width="55%" />
            <Skeleton height={12} width="80%" />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.lightGray },
  card: {
    backgroundColor: colors.white,
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    gap: spacing[12],
    padding: spacing[16],
  },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing[12] },
  lines: { flex: 1, gap: spacing[8] },
  list: { gap: spacing[12] },
  flex: { flex: 1 },
});
