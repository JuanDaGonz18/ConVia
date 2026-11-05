import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { TripStatus } from '@/types';

type StatusBadgeProps = {
  status: TripStatus;
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>{t(`tripCardStatus.${status}`)}</Text>
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
