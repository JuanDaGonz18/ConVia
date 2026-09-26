import { useCallback, useState, useRef, useEffect } from 'react';
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
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Avatar } from '@/components/ui/Avatar';
import { ChatMessageItem } from '@/components/chat/ChatMessageItem';
import { QuickReplies } from '@/components/chat/QuickReplies';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { ChatConversation, ChatMessage } from '@/types';
import { chatService } from '@/services/chatService';
import { useAppStore } from '@/store/appStore';
import { errorMessage } from '@/utils/format';

export default function ChatsScreen() {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeChat, setActiveChat] = useState<ChatConversation | null>(null);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const currentUser = useAppStore((state) => state.currentUser);

  const flatListRef = useRef<FlatList>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void chatService.getConversations().then((items) => {
        if (!active) return;
        setConversations(items);
        setError(null);
      }).catch((loadError) => {
        if (active) setError(errorMessage(loadError, 'No se pudieron cargar los chats.'));
      }).finally(() => {
        if (active) setLoading(false);
      });
      return () => { active = false; };
    }, []),
  );

  const appendMessage = useCallback((message: ChatMessage) => {
    setActiveChat((current) => {
      if (!current || current.messages.some((item) => item.id === message.id)) return current;
      return { ...current, messages: [...current.messages, message], lastMessage: message.text, lastMessageTime: message.timestamp };
    });
  }, []);

  // Auto scroll to bottom when messages update
  useEffect(() => {
    if (activeChat) {
      const timer = setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
      return () => clearTimeout(timer);
    }
  }, [activeChat]);

  useEffect(() => {
    if (!activeChat?.tripId || !currentUser?.id) return;
    return chatService.subscribe(activeChat.tripId, appendMessage, currentUser.id, activeChat.participantNames);
    // Resubscribe only when the open trip changes, not on every new message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChat?.tripId, currentUser?.id, appendMessage]);

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text || !activeChat?.tripId || sending) return;
    setSendError(null);
    setSending(true);
    try {
      appendMessage(await chatService.sendMessage(activeChat.tripId, text));
      // Keep the typed text if sending fails so the user can retry.
      if (!textToSend) setInputText('');
    } catch (sendFailure) {
      setSendError(errorMessage(sendFailure, 'No se pudo enviar el mensaje.'));
    } finally {
      setSending(false);
    }
  };

  // If in an active conversation view
  if (activeChat) {
    return (
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        {/* Chat Detail Header */}
        <View style={styles.detailHeader}>
          <Pressable
            accessibilityLabel="Volver a lista de chats"
            onPress={() => {
              setActiveChat(null);
              setSendError(null);
            }}
            style={styles.backButton}
          >
            <Ionicons color={colors.text} name="arrow-back" size={24} />
          </Pressable>

          <Avatar imageUrl={activeChat.participantAvatar} name={activeChat.participantName} size={42} />

          <View style={styles.participantInfo}>
            <Text numberOfLines={1} style={styles.participantName}>
              {activeChat.participantName}
            </Text>
            {activeChat.vehicleInfo ? (
              <Text style={styles.vehicleInfo}>
                🚗 {activeChat.vehicleInfo}
              </Text>
            ) : null}
          </View>

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

          {sendError ? <Text style={styles.errorText}>{sendError}</Text> : null}
          {activeChat.messages.length === 0 ? <Text style={styles.emptyText}>Escribe el primer mensaje para coordinar el viaje.</Text> : null}

          {/* Quick Replies Chips */}
          <QuickReplies onSelect={(reply) => handleSendMessage(reply)} />

          {/* Message Input Box */}
          <View style={styles.inputContainer}>
            <TextInput
              maxLength={2000}
              onChangeText={setInputText}
              placeholder="Escribe un mensaje..."
              placeholderTextColor={colors.textSecondary}
              style={styles.textInput}
              value={inputText}
            />
            <Pressable
              accessibilityLabel="Enviar mensaje"
              disabled={!inputText.trim() || sending}
              onPress={() => handleSendMessage()}
              style={[
                styles.sendButton,
                !inputText.trim() || sending ? styles.sendButtonDisabled : null,
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

      {loading ? <Text style={styles.emptyText}>Cargando conversaciones...</Text> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {!loading && !error && conversations.length === 0 ? <Text style={styles.emptyText}>Tus viajes activos aparecerán aquí para coordinar con el conductor o los pasajeros.</Text> : null}
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
            <Avatar imageUrl={item.participantAvatar} name={item.participantName} size={50} />

            <View style={styles.cardCenter}>
              <View style={styles.cardHeaderRow}>
                <Text numberOfLines={1} style={styles.cardName}>
                  {item.participantName}
                </Text>
                <Text style={styles.cardTime}>{item.lastMessageTime}</Text>
              </View>

              {item.vehicleInfo ? (
                <Text style={styles.cardVehicle}>
                  🚗 {item.vehicleInfo}
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
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    padding: dimensions.screenPadding,
    textAlign: 'center',
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.error,
    paddingHorizontal: dimensions.screenPadding,
    paddingTop: spacing[12],
    textAlign: 'center',
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
