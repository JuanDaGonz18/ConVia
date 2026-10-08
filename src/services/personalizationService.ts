import { ensureSupabaseConfigured, isSupabaseEnabled, supabase } from '@/lib/supabase';
import { FavoriteDriver, Location, SavedPlace, SavedPlaceKind } from '@/types';

export const PLACE_KIND_LABELS: Record<SavedPlaceKind, string> = {
  home: 'Casa',
  work: 'Trabajo',
  university: 'Universidad',
  other: 'Otro lugar',
};

export const MAX_SAVED_PLACES = 10;

async function requireUserId() {
  ensureSupabaseConfigured();
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('AUTH_REQUIRED');
  return data.user.id;
}

/** True when a session exists; reads return nothing without one instead of failing. */
async function hasSession() {
  ensureSupabaseConfigured();
  const { data } = await supabase.auth.getSession();
  return !!data.session;
}

type PlaceRow = { id: string; kind: string; label: string; address: string; lat: number; lng: number };

function mapPlace(row: PlaceRow): SavedPlace {
  return {
    id: row.id,
    kind: row.kind as SavedPlaceKind,
    label: row.label,
    address: row.address,
    latitude: row.lat,
    longitude: row.lng,
  };
}

/**
 * Saved places (home, work, university, others) and favorite drivers.
 * Both are private to the user (RLS) and optional.
 */
export const personalizationService = {
  async getSavedPlaces(): Promise<SavedPlace[]> {
    // The session can disappear while the app starts (expired or signing out).
    if (!isSupabaseEnabled || !(await hasSession())) return [];
    const { data, error } = await supabase
      .from('saved_places')
      .select('id, kind, label, address, lat, lng')
      .order('created_at');
    if (error) throw error;
    return data.map(mapPlace);
  },

  /** Creates a place, or replaces the one with `id` (or the existing one of a single-use kind). */
  async savePlace(input: { id?: string; kind: SavedPlaceKind; label: string; location: Location }): Promise<SavedPlace> {
    if (!isSupabaseEnabled) throw new Error('SUPABASE_REQUIRED');
    const userId = await requireUserId();
    const values = {
      kind: input.kind,
      label: input.label.trim().slice(0, 40) || PLACE_KIND_LABELS[input.kind],
      address: input.location.address.slice(0, 300),
      lat: input.location.latitude,
      lng: input.location.longitude,
    };
    const query = input.id
      ? supabase.from('saved_places').update(values).eq('id', input.id)
      : supabase.from('saved_places').insert({ ...values, user_id: userId });
    const { data, error } = await query.select('id, kind, label, address, lat, lng').single();
    if (error) throw error;
    return mapPlace(data);
  },

  async deletePlace(id: string): Promise<void> {
    if (!isSupabaseEnabled) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { error } = await supabase.from('saved_places').delete().eq('id', id);
    if (error) throw error;
  },

  async getFavoriteDrivers(): Promise<FavoriteDriver[]> {
    if (!isSupabaseEnabled || !(await hasSession())) return [];
    const { data, error } = await supabase
      .from('favorite_drivers')
      .select('driver_id, created_at, driver:profiles!favorite_drivers_driver_id_fkey(nombre, avatar_url)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as unknown as { driver_id: string; driver: { nombre: string; avatar_url: string | null } | null }[]).map((row) => ({
      id: row.driver_id,
      name: row.driver?.nombre || 'Conductor',
      avatarUrl: row.driver?.avatar_url ?? undefined,
    }));
  },

  async addFavoriteDriver(driverId: string): Promise<void> {
    if (!isSupabaseEnabled) throw new Error('SUPABASE_REQUIRED');
    const userId = await requireUserId();
    const { error } = await supabase
      .from('favorite_drivers')
      .upsert({ user_id: userId, driver_id: driverId }, { ignoreDuplicates: true, onConflict: 'user_id,driver_id' });
    if (error) throw error;
  },

  async removeFavoriteDriver(driverId: string): Promise<void> {
    if (!isSupabaseEnabled) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { error } = await supabase.from('favorite_drivers').delete().eq('driver_id', driverId);
    if (error) throw error;
  },
};
