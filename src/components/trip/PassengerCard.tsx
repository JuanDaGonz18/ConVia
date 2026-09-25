import { StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { Passenger } from '@/types';

type PassengerCardProps = {
  passenger: Passenger;
};

export function PassengerCard({ passenger }: PassengerCardProps) {
  return (
    <View style={styles.card}>
      <Avatar name={passenger.name} />
      <View style={styles.content}>
        <Text style={styles.name}>{passenger.name}</Text>
        <Text style={styles.address}>{passenger.pickupLocation?.address}</Text>
      </View>
      <StatusBadge status="accepted" />
    </View>
  );
}

const styles = StyleSheet.create({
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
  content: {
    flex: 1,
  },
  name: {
    ...typography.bodyMedium,
    color: colors.text,
  },
  address: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
});
