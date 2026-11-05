import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

const DEFAULT_QUICK_REPLIES = ['atMeetingPoint', 'fiveMinutes', 'leaving', 'whereToWait', 'thanks'] as const;

type QuickRepliesProps = Readonly<{
  replies?: string[];
  disabled?: boolean;
  onSelect: (reply: string) => void;
}>;

/** One-tap messages, in a single horizontally scrolling row. */
export function QuickReplies({ replies, disabled = false, onSelect }: QuickRepliesProps) {
  const { t } = useTranslation();
  // The message is sent in the sender's language, as typed text would be.
  const shown = replies ?? DEFAULT_QUICK_REPLIES.map((key) => t(`tripChat.quickReplies.${key}`));
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
      // A horizontal ScrollView grows to fill a column unless told not to.
      style={styles.row}
    >
      {shown.map((reply) => (
        <Pressable
          accessibilityLabel={t('tripChat.quickReplySend', { reply })}
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
