import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { ChatMessage } from '@/types';

type ChatMessageItemProps = {
  message: ChatMessage;
};

export function ChatMessageItem({ message }: ChatMessageItemProps) {
  const isMe = message.isMe;

  return (
    <View
      style={[
        styles.container,
        isMe ? styles.containerMe : styles.containerOther,
      ]}
    >
      <View
        style={[
          styles.bubble,
          isMe ? styles.bubbleMe : styles.bubbleOther,
        ]}
      >
        {!isMe ? (
          <Text style={styles.senderName}>{message.senderName}</Text>
        ) : null}
        <Text style={[styles.text, isMe ? styles.textMe : styles.textOther]}>
          {message.text}
        </Text>
        <View style={styles.metaRow}>
          <Text style={[styles.time, isMe ? styles.timeMe : styles.timeOther]}>
            {message.timestamp}
          </Text>
          {isMe ? (
            <Ionicons accessibilityLabel="Enviado" color="rgba(255,255,255,0.8)" name="checkmark" size={14} />
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: spacing[4],
    width: '100%',
  },
  containerMe: {
    alignItems: 'flex-end',
  },
  containerOther: {
    alignItems: 'flex-start',
  },
  bubble: {
    borderRadius: radius.radiusLarge,
    maxWidth: '80%',
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[12],
  },
  bubbleMe: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: radius.radiusSmall,
  },
  bubbleOther: {
    backgroundColor: colors.white,
    borderBottomLeftRadius: radius.radiusSmall,
    borderColor: colors.lightGray,
    borderWidth: 1,
  },
  senderName: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
    marginBottom: spacing[4],
  },
  text: {
    ...typography.body,
    lineHeight: 20,
  },
  textMe: {
    color: colors.white,
  },
  textOther: {
    color: colors.text,
  },
  metaRow: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    flexDirection: 'row',
    gap: spacing[4],
    marginTop: spacing[4],
  },
  time: {
    ...typography.caption,
    fontSize: 10,
  },
  timeMe: {
    color: 'rgba(255,255,255,0.7)',
  },
  timeOther: {
    color: colors.textSecondary,
  },
});
