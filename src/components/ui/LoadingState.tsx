import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

type LoadingStateProps = {
  label?: string;
};

export function LoadingState({ label = 'Cargando' }: LoadingStateProps) {
  return (
    <View style={styles.container}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing[8],
    padding: spacing[24],
  },
  label: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
});
