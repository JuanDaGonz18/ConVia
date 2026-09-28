import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';

type StarRatingProps = Readonly<{
  score: number;
  total?: number;
  size?: number;
  /** When given, the stars can be tapped to choose a score. */
  onChange?: (score: number) => void;
  disabled?: boolean;
}>;

export function StarRating({ score, total = 5, size = 16, onChange, disabled = false }: StarRatingProps) {
  const stars = Array.from({ length: total }, (_, index) => index + 1);
  if (!onChange) {
    return (
      <View accessibilityLabel={`${score} de ${total}`} style={styles.container}>
        {stars.map((value) => (
          <Ionicons color={value <= Math.round(score) ? colors.warning : colors.lightGray} key={value} name="star" size={size} />
        ))}
      </View>
    );
  }
  return (
    <View accessibilityRole="adjustable" accessibilityValue={{ min: 0, max: total, now: score }} style={styles.container}>
      {stars.map((value) => (
        <Pressable
          accessibilityLabel={`${value} estrella${value === 1 ? '' : 's'}`}
          disabled={disabled}
          hitSlop={4}
          key={value}
          onPress={() => onChange(value)}
        >
          <Ionicons
            color={value <= score ? colors.warning : colors.border}
            name={value <= score ? 'star' : 'star-outline'}
            size={size}
          />
        </Pressable>
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
