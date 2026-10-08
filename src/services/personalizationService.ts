import { ensureSupabaseConfigured, isSupabaseEnabled, supabase } from '@/lib/supabase';
import { FavoriteDriver, Location, SavedPlace, SavedPlaceKind, SavedRoute, UserPreferences } from '@/types';

export const PLACE_KIND_LABELS: Record<SavedPlaceKind, string> = {
  home: 'Casa',
  work: 'Trabajo',
  university: 'Universidad',
  other: 'Otro lugar',
};

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

  // ─── Saved routes and alerts ───────────────────────────────────────────────

  async getSavedRoutes(): Promise<SavedRoute[]> {
    if (!isSupabaseEnabled || !(await hasSession())) return [];
    const { data, error } = await supabase.from('saved_routes').select('*').order('created_at');
    if (error) throw error;
    return data.map(mapRoute);
  },

  /** Creates a route, or replaces the one with `id`. The server applies the plan's limit and alert capability. */
  async saveRoute(input: Omit<SavedRoute, 'id'>, id?: string): Promise<SavedRoute> {
    if (!isSupabaseEnabled) throw new Error('SUPABASE_REQUIRED');
    const userId = await requireUserId();
    const values = {
      nombre: input.name.trim().slice(0, 40) || `${input.origin.label.slice(0, 18)} → ${input.destination.label.slice(0, 18)}`,
      origen_nombre: input.origin.label.slice(0, 300),
      origen_lat: input.origin.latitude,
      origen_lng: input.origin.longitude,
      destino_nombre: input.destination.label.slice(0, 300),
      destino_lat: input.destination.latitude,
      destino_lng: input.destination.longitude,
      dias: input.days,
      hora_desde: input.timeFrom,
      hora_hasta: input.timeTo,
      alerta: input.alert,
    };
    const query = id
      ? supabase.from('saved_routes').update(values).eq('id', id)
      : supabase.from('saved_routes').insert({ ...values, user_id: userId });
    const { data, error } = await query.select('*').single();
    if (error) throw error;
    return mapRoute(data);
  },

  async setRouteAlert(id: string, alert: boolean): Promise<void> {
    if (!isSupabaseEnabled) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { error } = await supabase.from('saved_routes').update({ alerta: alert }).eq('id', id);
    if (error) throw error;
  },

  async deleteRoute(id: string): Promise<void> {
    if (!isSupabaseEnabled) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { error } = await supabase.from('saved_routes').delete().eq('id', id);
    if (error) throw error;
  },

  /** Trips the alerts found (newest first); the trips themselves come from available_trips. */
  async getAlertHits(): Promise<{ tripId: string; routeId: string | null; at: string }[]> {
    if (!isSupabaseEnabled || !(await hasSession())) return [];
    const { data, error } = await supabase
      .from('trip_alert_hits')
      .select('trip_id, route_id, created_at')
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw error;
    return data.map((row) => ({ tripId: row.trip_id, routeId: row.route_id, at: row.created_at }));
  },

  async dismissAlertHit(tripId: string): Promise<void> {
    if (!isSupabaseEnabled) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { error } = await supabase.from('trip_alert_hits').delete().eq('trip_id', tripId);
    if (error) throw error;
  },

  // ─── Preferences ───────────────────────────────────────────────────────────

  async getPreferences(): Promise<UserPreferences> {
    if (!isSupabaseEnabled || !(await hasSession())) return DEFAULT_PREFERENCES;
    const { data, error } = await supabase.from('user_preferences').select('*').maybeSingle();
    if (error) throw error;
    if (!data) return DEFAULT_PREFERENCES;
    return {
      sort: data.orden as UserPreferences['sort'],
      time: data.horario as UserPreferences['time'],
      maxPickupKm: data.max_recogida_km === null ? null : Number(data.max_recogida_km),
      maxDropoffKm: data.max_bajada_km === null ? null : Number(data.max_bajada_km),
      pickupPlaceId: data.recogida_place_id,
      notifyAlerts: data.avisar_alertas,
      notifyRecurring: data.avisar_recurrentes,
    };
  },

  async savePreferences(preferences: UserPreferences): Promise<void> {
    if (!isSupabaseEnabled) throw new Error('SUPABASE_REQUIRED');
    const userId = await requireUserId();
    const { error } = await supabase.from('user_preferences').upsert({
      user_id: userId,
      orden: preferences.sort,
      horario: preferences.time,
      max_recogida_km: preferences.maxPickupKm,
      max_bajada_km: preferences.maxDropoffKm,
      recogida_place_id: preferences.pickupPlaceId,
      avisar_alertas: preferences.notifyAlerts,
      avisar_recurrentes: preferences.notifyRecurring,
    }, { onConflict: 'user_id' });
    if (error) throw error;
  },
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  sort: 'match',
  time: 'any',
  maxPickupKm: null,
  maxDropoffKm: null,
  pickupPlaceId: null,
  notifyAlerts: true,
  notifyRecurring: true,
};

type RouteRow = {
  id: string; nombre: string;
  origen_nombre: string; origen_lat: number; origen_lng: number;
  destino_nombre: string; destino_lat: number; destino_lng: number;
  dias: number[]; hora_desde: string | null; hora_hasta: string | null; alerta: boolean;
};

function mapRoute(row: RouteRow): SavedRoute {
  const point = (suffix: string, label: string, latitude: number, longitude: number): Location => ({
    id: `${row.id}-${suffix}`, label, address: label, latitude, longitude,
  });
  return {
    id: row.id,
    name: row.nombre,
    origin: point('origin', row.origen_nombre, row.origen_lat, row.origen_lng),
    destination: point('destination', row.destino_nombre, row.destino_lat, row.destino_lng),
    days: row.dias,
    timeFrom: row.hora_desde?.slice(0, 5) ?? null,
    timeTo: row.hora_hasta?.slice(0, 5) ?? null,
    alert: row.alerta,
  };
}
