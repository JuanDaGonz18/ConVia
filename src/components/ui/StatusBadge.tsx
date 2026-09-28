import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { TripStatus } from '@/types';

const labels: Record<TripStatus, string> = {
  pending: 'Pendiente',
  accepted: 'Aceptado',
  driver_arriving: 'En camino',
  started: 'Iniciado',
  completed: 'Finalizado',
  cancelled: 'Cancelado',
  not_started: 'No iniciado',
};

type StatusBadgeProps = {
  status: TripStatus;
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>{labels[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusFull,
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[4],
  },
  text: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
});
