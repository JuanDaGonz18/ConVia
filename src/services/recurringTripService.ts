import { ensureSupabaseConfigured, isSupabaseEnabled, supabase } from '@/lib/supabase';
import { notificationService } from '@/services/notificationService';
import { parseRoute, serializeRoute } from '@/services/tripService';
import { Location, TripRoute } from '@/types';

/** ISO weekdays, Monday first. */
export const WEEKDAYS: { day: number; short: string; long: string }[] = [
  { day: 1, short: 'L', long: 'Lunes' },
  { day: 2, short: 'M', long: 'Martes' },
  { day: 3, short: 'X', long: 'Miércoles' },
  { day: 4, short: 'J', long: 'Jueves' },
  { day: 5, short: 'V', long: 'Viernes' },
  { day: 6, short: 'S', long: 'Sábado' },
  { day: 7, short: 'D', long: 'Domingo' },
];

/** "Lun a vie", "Todos los días", "Lun, mié y vie". */
export function describeDays(days: number[]) {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return 'Todos los días';
  if (sorted.join() === '1,2,3,4,5') return 'De lunes a viernes';
  const names = sorted.map((day) => WEEKDAYS[day - 1].long.toLowerCase());
  const text = names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names.at(-1)}` : names[0] ?? '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "07:30" → "7:30 a. m." */
export function formatClock(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
}

/** Local date as YYYY-MM-DD (what the server stores for a schedule). */
export function toLocalDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export type RecurringTrip = {
  id: string;
  vehicleId: string;
  origin: Location;
  destination: Location;
  route?: TripRoute;
  /** Local departure time "HH:MM". */
  time: string;
  days: number[];
  startDate: string;
  endDate: string | null;
  price: number;
  totalSeats: number;
  description: string | null;
  active: boolean;
  /** Published upcoming trips of this schedule. */
  upcoming: number;
};

export type RecurringTripInput = {
  vehicleId: string;
  origin: Location;
  destination: Location;
  route: TripRoute | null;
  time: string;
  days: number[];
  startDate: string;
  endDate: string | null;
  price: number;
  totalSeats: number;
  description?: string;
};

function place(id: string, label: string, latitude: number, longitude: number): Location {
  return { id, label, address: label, latitude, longitude };
}

/**
 * Weekly schedules. The server validates the driver, vehicle and plan, and
 * publishes each trip up to 7 days ahead without duplicates.
 */
export const recurringTripService = {
  async getMine(): Promise<RecurringTrip[]> {
    if (!isSupabaseEnabled) return [];
    ensureSupabaseConfigured();
    const [{ data, error }, upcoming] = await Promise.all([
      supabase.from('recurring_trips').select('*').order('created_at', { ascending: false }),
      supabase
        .from('trips')
        .select('recurring_trip_id')
        .not('recurring_trip_id', 'is', null)
        .eq('estado', 'por_empezar')
        .gt('salida_at', new Date().toISOString()),
    ]);
    if (error) throw error;
    if (upcoming.error) throw upcoming.error;
    const counts = new Map<string, number>();
    for (const row of upcoming.data) {
      if (row.recurring_trip_id) counts.set(row.recurring_trip_id, (counts.get(row.recurring_trip_id) ?? 0) + 1);
    }
    return data.map((row) => ({
      id: row.id,
      vehicleId: row.vehicle_id,
      origin: place(`${row.id}-origin`, row.origen_nombre, row.origen_lat, row.origen_lng),
      destination: place(`${row.id}-destination`, row.destino_nombre, row.destino_lat, row.destino_lng),
      route: parseRoute(row.ruta),
      time: row.hora.slice(0, 5),
      days: row.dias,
      startDate: row.fecha_inicio,
      endDate: row.fecha_fin,
      price: Number(row.precio),
      totalSeats: row.cupos_totales,
      description: row.descripcion,
      active: row.activo,
      upcoming: counts.get(row.id) ?? 0,
    }));
  },

  /** Creates (no id) or changes a schedule; returns how many trips were published now. */
  async save(input: RecurringTripInput, id?: string): Promise<{ id: string; created: number; kept: number }> {
    if (!isSupabaseEnabled) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { data, error } = await supabase.rpc('save_recurring_trip', {
      p_id: id ?? (null as unknown as string),
      p_vehicle_id: input.vehicleId,
      p_origen_nombre: input.origin.label,
      p_origen_lat: input.origin.latitude,
      p_origen_lng: input.origin.longitude,
      p_destino_nombre: input.destination.label,
      p_destino_lat: input.destination.latitude,
      p_destino_lng: input.destination.longitude,
      p_ruta: serializeRoute(input.route) ?? (null as unknown as string),
      p_hora: input.time,
      p_dias: input.days,
      p_fecha_inicio: input.startDate,
      p_fecha_fin: input.endDate ?? (null as unknown as string),
      p_precio: input.price,
      p_cupos_totales: input.totalSeats,
      p_descripcion: input.description ?? '',
    });
    if (error) throw error;
    const result = data as { id: string; created: number; kept: number };
    // Passengers with a matching alert hear about the new trips.
    if (result.created > 0) notificationService.notify('recurring_saved', result.id);
    return result;
  },

  /** Pausing removes upcoming trips nobody asked for; resuming publishes again. */
  async setActive(id: string, active: boolean): Promise<{ created: number; removed: number; kept: number }> {
    if (!isSupabaseEnabled) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { data, error } = await supabase.rpc('set_recurring_trip_active', { p_id: id, p_active: active });
    if (error) throw error;
    const result = data as { created: number; removed: number; kept: number };
    if (result.created > 0) notificationService.notify('recurring_saved', id);
    return result;
  },

  /** Deletes the schedule; trips that already have requests stay as normal trips. */
  async remove(id: string): Promise<{ removed: number; kept: number }> {
    if (!isSupabaseEnabled) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { data, error } = await supabase.rpc('delete_recurring_trip', { p_id: id });
    if (error) throw error;
    return data as { removed: number; kept: number };
  },
};
