import { useState, useRef, useEffect } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Avatar } from '@/components/ui/Avatar';
import { ChatMessageItem } from '@/components/chat/ChatMessageItem';
import { QuickReplies } from '@/components/chat/QuickReplies';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { mockChatConversations } from '@/data/mock/chats';
import { ChatConversation, ChatMessage } from '@/types';

export default function ChatsScreen() {
  const [conversations, setConversations] = useState<ChatConversation[]>(
    mockChatConversations
  );
  const [activeChat, setActiveChat] = useState<ChatConversation | null>(null);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const flatListRef = useRef<FlatList>(null);

  // Auto scroll to bottom when messages update
  useEffect(() => {
    if (activeChat) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [activeChat]);

  const handleSendMessage = (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text || !activeChat) return;

    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      senderId: 'current-user',
      senderName: 'Yo',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isMe: true,
    };

    const updatedMessages = [...activeChat.messages, newMsg];

    const updatedChat: ChatConversation = {
      ...activeChat,
      lastMessage: text,
      lastMessageTime: 'Ahora',
      unreadCount: 0,
      messages: updatedMessages,
    };

    setActiveChat(updatedChat);
    setConversations((prev) =>
      prev.map((c) => (c.id === activeChat.id ? updatedChat : c))
    );
    setInputText('');

    // Simulate driver reply after 1.4 seconds
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      const automatedReplies = [
        '¡Entendido! Ya voy en camino.',
        'Perfecto, te espero con las intermitentes puestas.',
        'Listo, voy pasando por la 153 en este momento.',
        '¡Excelente! Nos vemos en el punto de recogida.',
      ];
      const randomReply =
        automatedReplies[Math.floor(Math.random() * automatedReplies.length)];

      const replyMsg: ChatMessage = {
        id: `reply-${Date.now()}`,
        senderId: activeChat.participantId,
        senderName: activeChat.participantName.split(' ')[0],
        text: randomReply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isMe: false,
      };

      const finalMessages = [...updatedMessages, replyMsg];
      const finalChat: ChatConversation = {
        ...updatedChat,
        lastMessage: randomReply,
        lastMessageTime: 'Ahora',
        messages: finalMessages,
      };

      setActiveChat(finalChat);
      setConversations((prev) =>
        prev.map((c) => (c.id === activeChat.id ? finalChat : c))
      );
    }, 1400);
  };

  // If in an active conversation view
  if (activeChat) {
    return (
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        {/* Chat Detail Header */}
        <View style={styles.detailHeader}>
          <Pressable
            accessibilityLabel="Volver a lista de chats"
            onPress={() => setActiveChat(null)}
            style={styles.backButton}
          >
            <Ionicons color={colors.text} name="arrow-back" size={24} />
          </Pressable>

          <Avatar name={activeChat.participantName} size={42} />

          <View style={styles.participantInfo}>
            <Text numberOfLines={1} style={styles.participantName}>
              {activeChat.participantName}
            </Text>
            {activeChat.vehicleInfo ? (
              <Text style={styles.vehicleInfo}>
                🚗 {activeChat.vehicleInfo} • {activeChat.plate}
              </Text>
            ) : null}
          </View>

          <Pressable
            accessibilityLabel="Llamar"
            onPress={() => alert(`Llamando a ${activeChat.participantName}...`)}
            style={styles.callButton}
          >
            <Ionicons color={colors.primary} name="call" size={20} />
          </Pressable>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
          style={styles.keyboardView}
        >
          {/* Message History */}
          <FlatList
            contentContainerStyle={styles.messagesContainer}
            data={activeChat.messages}
            keyExtractor={(item) => item.id}
            ref={flatListRef}
            renderItem={({ item }) => <ChatMessageItem message={item} />}
          />

          {/* Typing Indicator */}
          {isTyping ? (
            <View style={styles.typingBox}>
              <Text style={styles.typingText}>
                {activeChat.participantName.split(' ')[0]} está escribiendo...
              </Text>
            </View>
          ) : null}

          {/* Quick Replies Chips */}
          <QuickReplies onSelect={(reply) => handleSendMessage(reply)} />

          {/* Message Input Box */}
          <View style={styles.inputContainer}>
            <TextInput
              onChangeText={setInputText}
              placeholder="Escribe un mensaje..."
              placeholderTextColor={colors.textSecondary}
              style={styles.textInput}
              value={inputText}
            />
            <Pressable
              accessibilityLabel="Enviar mensaje"
              disabled={!inputText.trim()}
              onPress={() => handleSendMessage()}
              style={[
                styles.sendButton,
                !inputText.trim() ? styles.sendButtonDisabled : null,
              ]}
            >
              <Ionicons color={colors.white} name="send" size={18} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // Conversation List View
  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.listHeader}>
        <Text style={styles.kicker}>WHEELSAPP</Text>
        <Text style={styles.title}>Mensajes</Text>
        <Text style={styles.subtitle}>
          Coordina tu punto de encuentro y detalles del viaje
        </Text>
      </View>

      <FlatList
        contentContainerStyle={styles.conversationListContent}
        data={conversations}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => {
              setActiveChat(item);
              // Mark as read
              setConversations((prev) =>
                prev.map((c) => (c.id === item.id ? { ...c, unreadCount: 0 } : c))
              );
            }}
            style={styles.conversationCard}
          >
            <Avatar name={item.participantName} size={50} />

            <View style={styles.cardCenter}>
              <View style={styles.cardHeaderRow}>
                <Text numberOfLines={1} style={styles.cardName}>
                  {item.participantName}
                </Text>
                <Text style={styles.cardTime}>{item.lastMessageTime}</Text>
              </View>

              {item.vehicleInfo ? (
                <Text style={styles.cardVehicle}>
                  🚗 {item.vehicleInfo} • {item.plate}
                </Text>
              ) : null}

              <Text numberOfLines={1} style={styles.cardLastMessage}>
                {item.lastMessage}
              </Text>
            </View>

            {item.unreadCount > 0 ? (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>{item.unreadCount}</Text>
              </View>
            ) : (
              <Ionicons
                color={colors.border}
                name="chevron-forward"
                size={18}
              />
            )}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  listHeader: {
    backgroundColor: colors.white,
    borderBottomColor: colors.lightGray,
    borderBottomWidth: 1,
    gap: spacing[8],
    paddingHorizontal: dimensions.screenPadding,
    paddingVertical: spacing[16],
  },
  kicker: {
    ...typography.label,
    color: colors.primary,
  },
  title: {
    ...typography.headingXL,
    color: colors.text,
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  conversationListContent: {
    gap: spacing[12],
    paddingBottom: dimensions.bottomNavigationHeight + spacing[24],
    paddingHorizontal: dimensions.screenPadding,
    paddingTop: spacing[16],
  },
  conversationCard: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing[12],
    padding: spacing[16],
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
  },
  cardCenter: {
    flex: 1,
    gap: spacing[4],
  },
  cardHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardName: {
    ...typography.bodyMedium,
    color: colors.text,
    fontWeight: '600',
  },
  cardTime: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
  },
  cardVehicle: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '500',
  },
  cardLastMessage: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  unreadBadge: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.radiusFull,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  unreadBadgeText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
  },
  // Chat detail view
  detailHeader: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderBottomColor: colors.lightGray,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing[12],
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[12],
  },
  backButton: {
    padding: spacing[4],
  },
  participantInfo: {
    flex: 1,
    gap: 2,
  },
  participantName: {
    ...typography.bodyMedium,
    color: colors.text,
    fontWeight: '700',
  },
  vehicleInfo: {
    ...typography.caption,
    color: colors.primary,
  },
  callButton: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusFull,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  keyboardView: {
    flex: 1,
  },
  messagesContainer: {
    paddingHorizontal: dimensions.screenPadding,
    paddingVertical: spacing[16],
  },
  typingBox: {
    paddingHorizontal: dimensions.screenPadding,
    paddingVertical: spacing[4],
  },
  typingText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  inputContainer: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderTopColor: colors.lightGray,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing[8],
    paddingHorizontal: dimensions.screenPadding,
    paddingVertical: spacing[12],
  },
  textInput: {
    ...typography.body,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radius.radiusFull,
    borderWidth: 1,
    flex: 1,
    height: 44,
    paddingHorizontal: spacing[16],
  },
  sendButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.radiusFull,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  sendButtonDisabled: {
    backgroundColor: colors.lightGray,
    opacity: 0.6,
  },
});
