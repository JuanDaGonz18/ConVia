import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Avatar } from '@/components/ui/Avatar';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { chatService } from '@/services/chatService';
import { ChatConversation } from '@/types';
import { errorMessage } from '@/utils/format';

export default function ChatsScreen() {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setConversations(await chatService.getConversations());
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError, 'No se pudieron cargar los chats.'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload whenever the tab is shown, so previews include messages sent meanwhile.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.kicker}>WHEELSAPP</Text>
        <Text style={styles.title}>Mensajes</Text>
        <Text style={styles.subtitle}>Coordina el punto de encuentro y los detalles de tus viajes.</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : (
        <FlatList
          contentContainerStyle={[styles.list, conversations.length === 0 ? styles.listEmpty : null]}
          data={conversations}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <Ionicons color={error ? colors.error : colors.primary} name={error ? 'cloud-offline-outline' : 'chatbubbles-outline'} size={44} />
              <Text style={styles.emptyTitle}>{error ? 'No se pudieron cargar' : 'Aún no tienes chats'}</Text>
              <Text style={styles.emptyText}>
                {error ?? 'Cuando publiques un viaje o pidas un cupo, aquí podrás hablar con el conductor o los pasajeros.'}
              </Text>
            </View>
          )}
          refreshControl={<RefreshControl colors={[colors.primary]} onRefresh={() => void refresh()} refreshing={refreshing} />}
          renderItem={({ item }) => (
            <Pressable
              accessibilityLabel={`Chat con ${item.participantName}`}
              onPress={() => router.push({ pathname: '/chat/[tripId]', params: { tripId: item.tripId ?? item.id } })}
              style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
            >
              <Avatar imageUrl={item.participantAvatar} name={item.participantName} size={48} />
              <View style={styles.cardBody}>
                <View style={styles.cardTop}>
                  <Text numberOfLines={1} style={styles.cardName}>{item.participantName}</Text>
                  {item.lastMessageTime ? <Text style={styles.cardTime}>{item.lastMessageTime}</Text> : null}
                </View>
                {item.vehicleInfo ? (
                  <View style={styles.routeRow}>
                    <Ionicons color={colors.primary} name="car-outline" size={13} />
                    <Text numberOfLines={1} style={styles.routeText}>{item.vehicleInfo}</Text>
                  </View>
                ) : null}
                <Text numberOfLines={1} style={styles.cardMessage}>{item.lastMessage}</Text>
              </View>
              <Ionicons color={colors.border} name="chevron-forward" size={18} />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  header: {
    backgroundColor: colors.white,
    borderBottomColor: colors.lightGray,
    borderBottomWidth: 1,
    gap: spacing[8],
    paddingHorizontal: dimensions.screenPadding,
    paddingVertical: spacing[16],
  },
  kicker: { ...typography.label, color: colors.primary },
  title: { ...typography.headingXL, color: colors.text },
  subtitle: { ...typography.bodySmall, color: colors.textSecondary },
  loader: { marginTop: spacing[40] },
  list: {
    gap: spacing[12],
    paddingBottom: dimensions.bottomNavigationHeight + spacing[24],
    paddingHorizontal: dimensions.screenPadding,
    paddingTop: spacing[16],
  },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', gap: spacing[8], paddingHorizontal: spacing[16] },
  emptyTitle: { ...typography.headingM, color: colors.text },
  emptyText: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center' },
  card: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing[12],
    padding: spacing[16],
  },
  cardPressed: { backgroundColor: colors.primaryLight },
  cardBody: { flex: 1, gap: 2 },
  cardTop: { alignItems: 'center', flexDirection: 'row', gap: spacing[8], justifyContent: 'space-between' },
  cardName: { ...typography.bodyMedium, color: colors.text, flex: 1, fontWeight: '600' },
  cardTime: { ...typography.caption, color: colors.textSecondary },
  routeRow: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  routeText: { ...typography.caption, color: colors.primary, flex: 1 },
  cardMessage: { ...typography.bodySmall, color: colors.textSecondary },
});
