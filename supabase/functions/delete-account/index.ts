import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

// Face verification runs on the device and stores no photos, so only these hold user files.
const BUCKETS = ['avatars', 'vehicle-photos'];

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

async function removeFolder(bucket: string, userId: string) {
  const { data, error } = await admin.storage.from(bucket).list(userId, { limit: 1000 });
  if (error) {
    // A bucket that no longer exists has nothing to clean up.
    if (/not found/i.test(error.message)) return;
    throw error;
  }
  if (!data?.length) return;
  const { error: removeError } = await admin.storage.from(bucket).remove(data.map((file) => `${userId}/${file.name}`));
  if (removeError) throw removeError;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return response({ error: 'METHOD_NOT_ALLOWED' }, 405);

  // The user comes from the JWT only; the body is never trusted.
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return response({ error: 'AUTH_REQUIRED' }, 401);
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return response({ error: 'AUTH_REQUIRED' }, 401);
  const userId = authData.user.id;

  const { count: activeTrips, error: tripsError } = await admin
    .from('trips')
    .select('id', { count: 'exact', head: true })
    .eq('driver_id', userId)
    .eq('estado', 'en_curso');
  if (tripsError) return response({ error: 'DELETE_FAILED' }, 500);
  if (activeTrips) return response({ error: 'ACTIVE_TRIP' }, 409);

  try {
    for (const bucket of BUCKETS) await removeFolder(bucket, userId);
    // profiles, vehicles, trips, requests, messages… cascade from auth.users.
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw error;
    return response({ deleted: true });
  } catch (error) {
    console.error('[delete-account]', error);
    return response({ error: 'DELETE_FAILED' }, 500);
  }
});
