import { ensureSupabaseConfigured, isSupabaseEnabled, supabase } from '@/lib/supabase';
import { notificationService } from '@/services/notificationService';
import { ChatConversation, ChatMessage } from '@/types';
import { formatMessageTime } from '@/utils/format';

type MessageRow = {
  id: string;
  trip_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

type ChatTrip = {
  trip_id: string;
  origen_nombre: string;
  destino_nombre: string;
  driver_id: string;
  driver_nombre: string;
  driver_avatar_url: string | null;
  viewer_is_driver: boolean;
};

const MESSAGE_COLUMNS = 'id, trip_id, sender_id, body, created_at';

function mapMessage(row: MessageRow, currentUserId: string, names: Record<string, string>): ChatMessage {
  return {
    id: row.id,
    senderId: row.sender_id,
    senderName: row.sender_id === currentUserId ? 'Yo' : names[row.sender_id] || 'Participante',
    text: row.body,
    timestamp: formatMessageTime(row.created_at),
    isMe: row.sender_id === currentUserId,
  };
}

async function requireUserId() {
  ensureSupabaseConfigured();
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('AUTH_REQUIRED');
  return data.user.id;
}

async function resolveNames(trips: ChatTrip[], messages: MessageRow[]) {
  const names: Record<string, string> = {};
  for (const trip of trips) names[trip.driver_id] = trip.driver_nombre;
  const unknownSenders = [...new Set(messages.map((row) => row.sender_id))].filter((id) => !names[id]);
  if (!unknownSenders.length) return names;
  const { data, error } = await supabase.from('profiles').select('id, nombre').in('id', unknownSenders);
  if (error) throw error;
  for (const profile of data) names[profile.id] = profile.nombre;
  return names;
}

export const chatService = {
  /**
   * One conversation per active trip the user drives or was accepted on, so
   * a chat can be opened before anyone has written the first message.
   */
  async getConversations(): Promise<ChatConversation[]> {
    if (!isSupabaseEnabled) return [];
    const userId = await requireUserId();

    // Active trips the user drives or was accepted on (the server checks both).
    const { data: chatTrips, error: tripsError } = await supabase.rpc('my_chat_trips');
    if (tripsError) throw tripsError;
    const trips = new Map<string, ChatTrip>();
    for (const trip of chatTrips as ChatTrip[]) trips.set(trip.trip_id, trip);
    if (!trips.size) return [];

    const tripIds = [...trips.keys()];
    const { data: messageData, error: messageError } = await supabase
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .in('trip_id', tripIds)
      .order('created_at', { ascending: true });
    if (messageError) throw messageError;
    const messages = messageData as MessageRow[];

    const names = await resolveNames([...trips.values()], messages);

    return tripIds.map((tripId) => {
      const trip = trips.get(tripId)!;
      const rows = messages.filter((row) => row.trip_id === tripId);
      const last = rows.at(-1);
      const isDriver = trip.viewer_is_driver;
      return {
        id: tripId,
        tripId,
        participantId: isDriver ? '' : trip.driver_id,
        participantName: isDriver ? 'Pasajeros del viaje' : trip.driver_nombre || 'Conductor',
        participantRole: isDriver ? 'client' : 'driver',
        participantAvatar: isDriver ? undefined : trip.driver_avatar_url ?? undefined,
        participantNames: names,
        vehicleInfo: `${trip.origen_nombre} → ${trip.destino_nombre}`,
        lastMessage: last?.body ?? 'Sin mensajes todavía',
        lastMessageTime: last ? formatMessageTime(last.created_at) : '',
        unreadCount: 0,
        messages: rows.map((row) => mapMessage(row, userId, names)),
      };
    });
  },

  /** One trip's conversation, or null when the user is no longer part of it. */
  async getConversation(tripId: string): Promise<ChatConversation | null> {
    const conversations = await chatService.getConversations();
    return conversations.find((conversation) => conversation.tripId === tripId) ?? null;
  },

  /** Why a trip's chat cannot be opened: the trip ended, or the user is not part of it. */
  async getClosedReason(tripId: string): Promise<'ended' | 'unavailable'> {
    if (!isSupabaseEnabled) return 'unavailable';
    ensureSupabaseConfigured();
    const { data } = await supabase.rpc('chat_trip_state', { p_trip_id: tripId });
    return data === 'ended' ? 'ended' : 'unavailable';
  },

  async sendMessage(tripId: string, body: string): Promise<ChatMessage> {
    if (!isSupabaseEnabled) throw new Error('SUPABASE_REQUIRED');
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from('messages')
      .insert({ trip_id: tripId, sender_id: userId, body: body.trim() })
      .select(MESSAGE_COLUMNS)
      .single();
    if (error) throw error;
    notificationService.notify('message', data.id);
    return mapMessage(data as MessageRow, userId, {});
  },

  subscribe(
    tripId: string,
    onMessage: (message: ChatMessage) => void,
    currentUserId: string,
    names: Record<string, string> = {},
  ) {
    if (!isSupabaseEnabled) return () => undefined;
    const channel = supabase
      .channel(`trip-${tripId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `trip_id=eq.${tripId}` }, (payload) => {
        onMessage(mapMessage(payload.new as MessageRow, currentUserId, names));
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  },
};
