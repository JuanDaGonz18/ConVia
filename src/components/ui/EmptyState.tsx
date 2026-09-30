import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

type EmptyStateProps = Readonly<{
  title: string;
  message?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** A clear next step, when there is one. */
  action?: { label: string; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap };
  /** Smaller, inline version for sections. */
  compact?: boolean;
}>;

/** Explains why a list is empty and what the person can do about it. */
export function EmptyState({ title, message, icon = 'sparkles-outline', action, compact = false }: EmptyStateProps) {
  return (
    <View style={[styles.container, compact ? styles.compact : null]}>
      <View style={[styles.iconCircle, compact ? styles.iconCircleCompact : null]}>
        <Ionicons color={colors.primary} name={icon} size={compact ? 22 : 30} />
      </View>
      <Text style={[styles.title, compact ? styles.titleCompact : null]}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {action ? (
        <View style={styles.action}>
          <ButtonSecondary icon={action.icon} onPress={action.onPress} title={action.label} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: spacing[8], paddingHorizontal: spacing[16], paddingVertical: spacing[32] },
  compact: { paddingVertical: spacing[16] },
  iconCircle: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusFull,
    height: 64,
    justifyContent: 'center',
    marginBottom: spacing[4],
    width: 64,
  },
  iconCircleCompact: { height: 44, width: 44 },
  title: { ...typography.headingM, color: colors.text, textAlign: 'center' },
  titleCompact: { ...typography.bodyMedium, fontWeight: '700' },
  message: { ...typography.bodySmall, color: colors.textSecondary, maxWidth: 320, textAlign: 'center' },
  action: { alignSelf: 'stretch', marginTop: spacing[8] },
});
