import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

type RatingProps = {
  score: number;
};

export function Rating({ score }: RatingProps) {
  const { t } = useTranslation();
  // Nobody has rated this person yet; "0.0" would read as a bad rating.
  const rated = score > 0;
  return (
    <View accessibilityLabel={rated ? t('rating.label', { score: score.toFixed(1) }) : t('rating.none')} style={styles.container}>
      <Ionicons color={rated ? colors.warning : colors.textSecondary} name={rated ? 'star' : 'star-outline'} size={16} />
      <Text style={styles.score}>{rated ? score.toFixed(1) : t('rating.new')}</Text>
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
