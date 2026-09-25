import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

type RatingProps = {
  score: number;
};

export function Rating({ score }: RatingProps) {
  return (
    <View style={styles.container}>
      <Ionicons color={colors.warning} name="star" size={16} />
      <Text style={styles.score}>{score.toFixed(1)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing[4],
  },
  score: {
    ...typography.bodySmall,
    color: colors.text,
  },
});
