import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

type NotifyEvent = 'request_created' | 'request_responded' | 'request_cancelled' | 'message';
type Push = { recipients: string[]; title: string; body: string; data: Record<string, string> };

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

const RESPONSE_TEXT: Record<string, string> = {
  aceptado: 'aceptó tu solicitud. Ya puedes ver tu QR de abordaje.',
  negado: 'rechazó tu solicitud.',
};

/**
 * Builds the notification from the stored row and returns null unless the
 * caller is the user who actually performed the action. Recipients are always
 * derived server-side, so a client cannot notify arbitrary users.
 */
async function buildPush(event: NotifyEvent, id: string, callerId: string): Promise<Push | null> {
  if (event === 'message') {
    const { data: message } = await admin
      .from('messages')
      .select('trip_id, sender_id, body, sender:profiles!messages_sender_id_fkey(nombre)')
      .eq('id', id)
      .single();
    if (!message || message.sender_id !== callerId) return null;
    const [{ data: trip }, { data: requests }] = await Promise.all([
      admin.from('trips').select('driver_id').eq('id', message.trip_id).single(),
      admin.from('trip_requests').select('passenger_id')
        .eq('trip_id', message.trip_id).in('estado', ['pendiente', 'aceptado', 'abordado']),
    ]);
    const participants = [trip?.driver_id, ...(requests ?? []).map((row) => row.passenger_id)];
    const sender = (message.sender as { nombre?: string } | null)?.nombre || 'Nuevo mensaje';
    return {
      recipients: participants.filter((userId): userId is string => !!userId && userId !== callerId),
      title: sender,
      body: message.body.slice(0, 180),
      data: { type: 'message', tripId: message.trip_id },
    };
  }

  const { data: request } = await admin
    .from('trip_requests')
    .select('trip_id, passenger_id, estado, direccion, passenger:profiles!trip_requests_passenger_id_fkey(nombre), trip:trips!trip_requests_trip_id_fkey(driver_id, destino_nombre, driver:profiles!trips_driver_id_fkey(nombre))')
    .eq('id', id)
    .single();
  if (!request) return null;
  const trip = request.trip as { driver_id: string; destino_nombre: string; driver: { nombre: string } | null } | null;
  if (!trip) return null;
  const passengerName = (request.passenger as { nombre?: string } | null)?.nombre || 'Un pasajero';
  const data = { type: event, requestId: id, tripId: request.trip_id };

  if (event === 'request_created' && request.passenger_id === callerId && request.estado === 'pendiente') {
    return { recipients: [trip.driver_id], title: 'Nueva solicitud', body: `${passengerName} quiere unirse a tu viaje a ${trip.destino_nombre}.`, data };
  }
  if (event === 'request_cancelled' && request.passenger_id === callerId && request.estado === 'cancelado') {
    return { recipients: [trip.driver_id], title: 'Solicitud cancelada', body: `${passengerName} canceló su solicitud.`, data };
  }
  if (event === 'request_responded' && trip.driver_id === callerId && RESPONSE_TEXT[request.estado]) {
    return { recipients: [request.passenger_id], title: 'Respuesta a tu solicitud', body: `${trip.driver?.nombre || 'El conductor'} ${RESPONSE_TEXT[request.estado]}`, data };
  }
  return null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return response({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return response({ error: 'AUTH_REQUIRED' }, 401);
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return response({ error: 'AUTH_REQUIRED' }, 401);

  const body = await request.json().catch(() => null) as { event?: NotifyEvent; id?: string } | null;
  if (!body?.event || !body.id) return response({ error: 'EVENT_REQUIRED' }, 400);

  const push = await buildPush(body.event, body.id, authData.user.id);
  if (!push?.recipients.length) return response({ sent: 0 });

  const { data: profiles, error } = await admin
    .from('profiles')
    .select('expo_push_token')
    .in('id', push.recipients)
    .eq('notifications_enabled', true)
    .not('expo_push_token', 'is', null);
  if (error) return response({ error: 'NOTIFY_FAILED' }, 500);
  const messages = (profiles ?? []).map((profile) => ({
    to: profile.expo_push_token,
    title: push.title,
    body: push.body,
    data: push.data,
    sound: 'default',
    channelId: 'default',
  }));
  if (!messages.length) return response({ sent: 0 });

  const expoResponse = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!expoResponse.ok) {
    console.error('[notify] Expo push failed', expoResponse.status, await expoResponse.text());
    return response({ error: 'PUSH_FAILED' }, 502);
  }
  return response({ sent: messages.length });
});
