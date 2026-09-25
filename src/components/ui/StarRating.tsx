import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';

type StarRatingProps = {
  score: number;
  total?: number;
};

export function StarRating({ score, total = 5 }: StarRatingProps) {
  return (
    <View accessibilityLabel={`${score} de ${total}`} style={styles.container}>
      {Array.from({ length: total }).map((_, index) => (
        <Ionicons
          color={index < Math.round(score) ? colors.warning : colors.lightGray}
          key={index}
          name="star"
          size={16}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: spacing[4],
  },
});
