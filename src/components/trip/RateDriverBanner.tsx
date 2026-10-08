import { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';

import { RateDriverModal, RateDriverTarget } from '@/components/trip/RateDriverModal';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { needsDriverRating, PassengerTripRecord, tripService } from '@/services/tripService';

/** Only recent trips get the banner; older ones can still be rated from the trip history. */
const PROMPT_DAYS = 7;
const DISMISSED_KEY = 'convia.dismissedDriverRatings';

async function readDismissed(): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(DISMISSED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

async function addDismissed(tripId: string) {
  const ids = [tripId, ...(await readDismissed()).filter((id) => id !== tripId)].slice(0, 50);
  try {
    await SecureStore.setItemAsync(DISMISSED_KEY, JSON.stringify(ids));
  } catch {
    // Not critical: the banner may show once more.
  }
}

function isRecent(trip: PassengerTripRecord) {
  const at = new Date(trip.finishedAt ?? trip.departureAt).getTime();
  return Date.now() - at < PROMPT_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * "¿Cómo te fue con …?" after a finished trip. Shows the most recent trip whose
 * driver the passenger has not rated; closing it only hides the banner, the
 * rating stays available from "Mis viajes".
 */
export function RateDriverBanner() {
  const [pending, setPending] = useState<PassengerTripRecord | null>(null);
  const [target, setTarget] = useState<RateDriverTarget | null>(null);

  const load = useCallback(async () => {
    try {
      const [history, dismissed] = await Promise.all([tripService.getPassengerHistory(), readDismissed()]);
      setPending(history.find((trip) => needsDriverRating(trip) && isRecent(trip) && !dismissed.includes(trip.tripId)) ?? null);
    } catch {
      // The banner is optional; the history screen shows any error.
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // A trip can finish while the app is in the background.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => subscription.remove();
  }, [load]);

  if (!pending) return null;

  const dismiss = () => {
    void addDismissed(pending.tripId);
    setPending(null);
  };

  return (
    <>
      <View style={styles.banner}>
        <View style={styles.iconCircle}>
          <Ionicons color={colors.warning} name="star" size={20} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title}>¿Cómo te fue con {pending.driver.name}?</Text>
          <Text numberOfLines={1} style={styles.meta}>{pending.originName} → {pending.destinationName}</Text>
          <Pressable
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => setTarget({
              tripId: pending.tripId,
              tripLabel: `${pending.originName} → ${pending.destinationName}`,
              driver: { name: pending.driver.name, avatarUrl: pending.driver.avatarUrl },
            })}
            style={styles.action}
          >
            <Text style={styles.actionText}>Calificar al conductor</Text>
            <Ionicons color={colors.primary} name="chevron-forward" size={16} />
          </Pressable>
        </View>
        <Pressable accessibilityLabel="Ahora no" hitSlop={10} onPress={dismiss}>
          <Ionicons color={colors.textSecondary} name="close" size={20} />
        </Pressable>
      </View>
      <RateDriverModal
        onClose={() => setTarget(null)}
        onRated={() => setPending(null)}
        target={target}
      />
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: 'flex-start',
    backgroundColor: '#FFF8EB',
    borderColor: '#FDE7C2',
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing[12],
    padding: spacing[16],
  },
  iconCircle: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.radiusFull,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  text: { flex: 1, gap: 2 },
  title: { ...typography.bodyMedium, color: colors.text, fontWeight: '700' },
  meta: { ...typography.caption, color: colors.textSecondary },
  action: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 2, marginTop: spacing[4] },
  actionText: { ...typography.bodySmall, color: colors.primary, fontWeight: '700' },
});
