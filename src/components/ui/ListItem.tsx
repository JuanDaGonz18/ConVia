import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

type ListItemProps = {
  title: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
};

export function ListItem({ title, subtitle, icon, onPress }: ListItemProps) {
  const content = (
    <>
      {icon ? <Ionicons color={colors.primary} name={icon} size={22} /> : null}
      <View style={styles.textContainer}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {onPress ? (
        <Ionicons color={colors.textSecondary} name="chevron-forward" size={20} />
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable accessibilityLabel={title} onPress={onPress} style={styles.item}>
        {content}
      </Pressable>
    );
  }

  return <View style={styles.item}>{content}</View>;
}

const styles = StyleSheet.create({
  item: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing[12],
    minHeight: 56,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    ...typography.bodyMedium,
    color: colors.text,
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
});
