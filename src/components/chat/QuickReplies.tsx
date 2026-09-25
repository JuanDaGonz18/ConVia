import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

const DEFAULT_QUICK_REPLIES = [
  'Ya estoy en el punto de encuentro',
  'Llego en 3 minutos',
  '¿Cuál es el color del carro?',
  'Voy saliendo hacia allá',
  '¡Muchas gracias!',
];

type QuickRepliesProps = {
  replies?: string[];
  onSelect: (reply: string) => void;
};

export function QuickReplies({
  replies = DEFAULT_QUICK_REPLIES,
  onSelect,
}: QuickRepliesProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
    >
      {replies.map((reply, idx) => (
        <Pressable
          key={idx}
          onPress={() => onSelect(reply)}
          style={({ pressed }) => [
            styles.chip,
            pressed ? styles.chipPressed : null,
          ]}
        >
          <Text style={styles.chipText}>{reply}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: spacing[8],
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[8],
  },
  chip: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.border,
    borderRadius: radius.radiusFull,
    borderWidth: 1,
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[8],
  },
  chipPressed: {
    backgroundColor: '#D1E4FF',
  },
  chipText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '500',
  },
});
