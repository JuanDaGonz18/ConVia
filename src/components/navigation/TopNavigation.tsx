import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

type TopNavigationProps = {
  title: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
};

export function TopNavigation({ title, onBack, rightAction }: TopNavigationProps) {
  return (
    <View style={styles.container}>
      <View style={styles.side}>
        {onBack ? (
          <Pressable
            accessibilityLabel="Volver"
            accessibilityRole="button"
            onPress={onBack}
            style={styles.iconButton}
          >
            <Ionicons color={colors.text} name="chevron-back" size={24} />
          </Pressable>
        ) : null}
      </View>
      <Text numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      <View style={[styles.side, styles.right]}>{rightAction}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 56,
    paddingHorizontal: spacing[16],
  },
  side: {
    width: dimensions.iconButtonSize,
  },
  right: {
    alignItems: 'flex-end',
  },
  iconButton: {
    alignItems: 'center',
    height: dimensions.iconButtonSize,
    justifyContent: 'center',
    width: dimensions.iconButtonSize,
  },
  title: {
    ...typography.bodyMedium,
    color: colors.text,
    flex: 1,
    textAlign: 'center',
  },
});
