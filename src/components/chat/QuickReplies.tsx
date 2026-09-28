import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

const DEFAULT_QUICK_REPLIES = [
  'Ya estoy en el punto de encuentro',
  'Llego en 5 minutos',
  'Voy saliendo',
  '¿Dónde te espero?',
  '¡Gracias!',
];

type QuickRepliesProps = Readonly<{
  replies?: string[];
  disabled?: boolean;
  onSelect: (reply: string) => void;
}>;

/** One-tap messages, in a single horizontally scrolling row. */
export function QuickReplies({ replies = DEFAULT_QUICK_REPLIES, disabled = false, onSelect }: QuickRepliesProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
      // A horizontal ScrollView grows to fill a column unless told not to.
      style={styles.row}
    >
      {replies.map((reply) => (
        <Pressable
          accessibilityLabel={`Enviar: ${reply}`}
          accessibilityRole="button"
          disabled={disabled}
          key={reply}
          onPress={() => onSelect(reply)}
          style={({ pressed }) => [styles.chip, pressed ? styles.chipPressed : null, disabled ? styles.chipDisabled : null]}
        >
          <Text numberOfLines={1} style={styles.chipText}>{reply}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexGrow: 0 },
  content: {
    alignItems: 'center',
    gap: spacing[8],
    paddingHorizontal: spacing[12],
  },
  chip: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusFull,
    height: 32,
    justifyContent: 'center',
    paddingHorizontal: spacing[12],
  },
  chipPressed: { backgroundColor: '#D1E4FF' },
  chipDisabled: { opacity: 0.5 },
  chipText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
});
