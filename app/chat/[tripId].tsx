import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { ChatMessageItem } from '@/components/chat/ChatMessageItem';
import { QuickReplies } from '@/components/chat/QuickReplies';
import { TripMembersModal } from '@/components/chat/TripMembersModal';
import { Avatar } from '@/components/ui/Avatar';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { chatService } from '@/services/chatService';
import { useAppStore } from '@/store/appStore';
import { ChatConversation, ChatMessage } from '@/types';
import { errorMessage } from '@/utils/format';

const MAX_LENGTH = 2000;

export default function ChatScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const userId = useAppStore((state) => state.currentUser?.id);
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const [conversation, setConversation] = useState<ChatConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(false);

  const load = useCallback(async () => {
    if (!tripId) return;
    setLoadError(null);
    try {
      const found = await chatService.getConversation(tripId);
      setConversation(found);
      if (!found) setLoadError('El chat se habilita cuando el conductor acepta tu solicitud, y se cierra cuando el viaje termina.');
    } catch (error) {
      setLoadError(errorMessage(error, 'No se pudo cargar la conversación.'));
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const appendMessage = useCallback((message: ChatMessage) => {
    setConversation((current) => {
      if (!current || current.messages.some((item) => item.id === message.id)) return current;
      return { ...current, messages: [...current.messages, message] };
    });
  }, []);

  // New messages from the other participants arrive in real time.
  const names = conversation?.participantNames;
  const ready = conversation !== null;
  useEffect(() => {
    if (!ready || !tripId || !userId) return;
    return chatService.subscribe(tripId, appendMessage, userId, names);
    // Subscribe once per conversation; the names map is only read for labels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, tripId, userId, appendMessage]);

  const send = async (value: string, fromQuickReply = false) => {
    const body = value.trim();
    if (!body || !tripId || sending) return;
    setSendError(null);
    setSending(true);
    try {
      appendMessage(await chatService.sendMessage(tripId, body));
      // Keep what was typed if sending fails, so the user can retry.
      if (!fromQuickReply) setText('');
    } catch (error) {
      setSendError(errorMessage(error, 'No se pudo enviar el mensaje. Inténtalo de nuevo.'));
    } finally {
      setSending(false);
    }
  };

  const canSend = text.trim().length > 0 && !sending;

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Volver a los chats" hitSlop={8} onPress={() => router.back()} style={styles.back}>
          <Ionicons color={colors.text} name="arrow-back" size={24} />
        </Pressable>
        {conversation ? (
          <>
            {/* Tapping the header opens "Pasajeros del viaje" too. */}
            <Pressable accessibilityLabel="Ver los integrantes del viaje" onPress={() => setShowMembers(true)} style={styles.headerMain}>
              <Avatar imageUrl={conversation.participantAvatar} name={conversation.participantName} size={40} />
              <View style={styles.headerText}>
                <Text numberOfLines={1} style={styles.headerName}>{conversation.participantName}</Text>
                {conversation.vehicleInfo ? (
                  <View style={styles.routeRow}>
                    <Ionicons color={colors.primary} name="car-outline" size={13} />
                    <Text numberOfLines={1} style={styles.routeText}>{conversation.vehicleInfo}</Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
            <Pressable
              accessibilityLabel="Pasajeros del viaje"
              hitSlop={6}
              onPress={() => setShowMembers(true)}
              style={styles.membersButton}
            >
              <Ionicons color={colors.primary} name="people" size={20} />
              <Text style={styles.membersText}>Grupo</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.headerName}>Chat del viaje</Text>
        )}
      </View>

      {conversation && tripId ? (
        <TripMembersModal onClose={() => setShowMembers(false)} tripId={tripId} visible={showMembers} />
      ) : null}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !conversation ? (
        <View style={styles.centered}>
          <Ionicons color={colors.textSecondary} name="chatbubbles-outline" size={40} />
          <Text style={styles.emptyText}>{loadError}</Text>
          <ButtonSecondary onPress={() => void load()} title="Reintentar" />
        </View>
      ) : (
        // "padding" works on Android too now that the app draws edge to edge.
        <KeyboardAvoidingView behavior="padding" style={styles.flex}>
          <FlatList
            contentContainerStyle={[styles.messages, conversation.messages.length === 0 ? styles.messagesEmpty : null]}
            data={conversation.messages}
            keyExtractor={(item) => item.id}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={(
              <View style={styles.emptyState}>
                <Ionicons color={colors.primary} name="chatbubbles-outline" size={40} />
                <Text style={styles.emptyTitle}>Coordinen el viaje</Text>
                <Text style={styles.emptyText}>Acuerden el punto de encuentro y la hora. Los mensajes solo los ven los participantes del viaje.</Text>
              </View>
            )}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            ref={listRef}
            renderItem={({ item }) => <ChatMessageItem message={item} />}
            style={styles.flex}
          />

          {sendError ? <Text style={styles.sendError}>{sendError}</Text> : null}

          <View style={[styles.composerArea, { paddingBottom: Math.max(insets.bottom, spacing[8]) }]}>
            {text.length === 0 ? <QuickReplies disabled={sending} onSelect={(reply) => void send(reply, true)} /> : null}
            <View style={styles.composer}>
              <TextInput
                accessibilityLabel="Mensaje"
                maxLength={MAX_LENGTH}
                multiline
                onChangeText={setText}
                placeholder="Escribe un mensaje…"
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
                value={text}
              />
              <Pressable
                accessibilityLabel="Enviar mensaje"
                accessibilityState={{ disabled: !canSend }}
                disabled={!canSend}
                onPress={() => void send(text)}
                style={[styles.sendButton, canSend ? null : styles.sendButtonDisabled]}
              >
                {sending ? <ActivityIndicator color={colors.white} size="small" /> : <Ionicons color={colors.white} name="send" size={18} />}
              </Pressable>
            </View>
            {text.length > MAX_LENGTH - 200 ? (
              <Text style={styles.counter}>{text.length}/{MAX_LENGTH}</Text>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  flex: { flex: 1 },
  header: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderBottomColor: colors.lightGray,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing[12],
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[8],
  },
  back: { padding: spacing[4] },
  headerMain: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing[12] },
  headerText: { flex: 1, gap: 2 },
  membersButton: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusMedium,
    paddingHorizontal: spacing[8],
    paddingVertical: 4,
  },
  membersText: { ...typography.caption, color: colors.primary, fontSize: 11, fontWeight: '700' },
  headerName: { ...typography.bodyMedium, color: colors.text, fontWeight: '700' },
  routeRow: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  routeText: { ...typography.caption, color: colors.primary, flex: 1 },
  centered: { alignItems: 'center', flex: 1, gap: spacing[16], justifyContent: 'center', padding: spacing[24] },
  messages: { paddingHorizontal: spacing[16], paddingVertical: spacing[12] },
  messagesEmpty: { flexGrow: 1, justifyContent: 'center' },
  emptyState: { alignItems: 'center', gap: spacing[8], paddingHorizontal: spacing[24] },
  emptyTitle: { ...typography.headingM, color: colors.text },
  emptyText: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center' },
  sendError: {
    ...typography.caption,
    backgroundColor: '#FFEAEA',
    color: colors.error,
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[8],
  },
  composerArea: {
    backgroundColor: colors.white,
    borderTopColor: colors.lightGray,
    borderTopWidth: 1,
    gap: spacing[8],
    paddingTop: spacing[8],
  },
  composer: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing[8],
    paddingHorizontal: spacing[12],
  },
  input: {
    ...typography.body,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    paddingBottom: 10,
    paddingHorizontal: spacing[16],
    paddingTop: 10,
    textAlignVertical: 'center',
  },
  sendButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.radiusFull,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  sendButtonDisabled: { backgroundColor: colors.border },
  counter: { ...typography.caption, color: colors.textSecondary, paddingHorizontal: spacing[16], textAlign: 'right' },
});
