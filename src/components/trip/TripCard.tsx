import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Avatar } from '@/components/ui/Avatar';
import { Rating } from '@/components/ui/Rating';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { Trip } from '@/types';

type TripCardProps = {
  trip: Trip;
  onChatPress?: () => void;
};

export function TripCard({ trip, onChatPress }: TripCardProps) {
  const handleChat = () => {
    if (onChatPress) {
      onChatPress();
    } else {
      router.push('/(tabs)/chats');
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.driver}>
          <Avatar name={trip.driver.name} size={44} />
          <View>
            <Text style={styles.driverName}>{trip.driver.name}</Text>
            <Rating score={trip.driver.rating.score} />
          </View>
        </View>

        <View style={styles.headerRight}>
          <Pressable
            accessibilityLabel="Abrir chat con conductor"
            onPress={handleChat}
            style={styles.chatIconBtn}
          >
            <Ionicons color={colors.primary} name="chatbubble-ellipses-outline" size={18} />
          </Pressable>
          <StatusBadge status={trip.status} />
        </View>
      </View>

      <View style={styles.route}>
        <Text style={styles.routeLabel}>Origen</Text>
        <Text style={styles.routeText}>{trip.origin.address}</Text>
        <Text style={styles.routeLabel}>Destino</Text>
        <Text style={styles.routeText}>{trip.destination.address}</Text>
      </View>

      <View style={styles.footer}>
        <Text style={styles.meta}>{trip.departureTime} • {trip.seatsAvailable} cupos</Text>
        <Text style={styles.price}>${trip.price.toLocaleString('es-CO')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    gap: spacing[16],
    padding: spacing[16],
    shadowColor: colors.shadow,
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  driver: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing[12],
  },
  driverName: {
    ...typography.bodyMedium,
    color: colors.text,
  },
  headerRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing[8],
  },
  chatIconBtn: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusFull,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  route: {
    gap: spacing[4],
  },
  routeLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  routeText: {
    ...typography.bodySmall,
    color: colors.text,
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  meta: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  price: {
    ...typography.bodyMedium,
    color: colors.primary,
  },
});
