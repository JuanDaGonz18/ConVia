import { mockTrips } from '@/data/mock/trips';
import { ensureSupabaseConfigured, isSupabaseEnabled, supabase } from '@/lib/supabase';
import { notificationService } from '@/services/notificationService';
import { Trip, TripStatus } from '@/types';

const useSupabase = isSupabaseEnabled;

export type CreateTripInput = {
  vehicleId: string;
  originName: string;
  originLat?: number;
  originLng?: number;
  destinationName: string;
  destinationLat?: number;
  destinationLng?: number;
  departureAt: string;
  price: number;
  totalSeats: number;
  description?: string;
};

export type TripRequestStatus = 'pendiente' | 'aceptado' | 'negado' | 'abordado' | 'cancelado';

export type TripRequestRecord = {
  id: string;
  trip_id: string;
  passenger_id: string;
  direccion: string;
  estado: TripRequestStatus;
  qr_token: string;
  created_at: string;
  responded_at: string | null;
  passengerName: string | null;
  tripLabel: string | null;
  tripDepartureAt: string | null;
};

export type DriverTripStatus = 'por_empezar' | 'en_curso' | 'finalizado' | 'cancelado';

export type DriverTripRecord = {
  id: string;
  originName: string;
  destinationName: string;
  departureAt: string;
  price: number;
  totalSeats: number;
  status: DriverTripStatus;
};

const REQUEST_COLUMNS =
  'id, trip_id, passenger_id, direccion, estado, qr_token, created_at, responded_at, ' +
  'passenger:profiles!trip_requests_passenger_id_fkey(nombre), ' +
  'trip:trips!trip_requests_trip_id_fkey(origen_nombre, destino_nombre, salida_at)';

type RequestRow = Omit<TripRequestRecord, 'passengerName' | 'tripLabel' | 'tripDepartureAt'> & {
  passenger: { nombre: string } | null;
  trip: { origen_nombre: string; destino_nombre: string; salida_at: string } | null;
};

function mapRequest(row: RequestRow): TripRequestRecord {
  const { passenger, trip, ...rest } = row;
  return {
    ...rest,
    passengerName: passenger?.nombre || null,
    tripLabel: trip ? `${trip.origen_nombre} → ${trip.destino_nombre}` : null,
    tripDepartureAt: trip?.salida_at ?? null,
  };
}

async function requireUserId() {
  ensureSupabaseConfigured();
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('AUTH_REQUIRED');
  return data.user.id;
}

const statusMap: Record<string, TripStatus> = {
  por_empezar: 'pending',
  en_curso: 'driver_arriving',
  finalizado: 'completed',
  cancelado: 'cancelled',
};

function mapAvailableTrip(row: {
  id: string | null;
  driver_id: string | null;
  driver_nombre: string | null;
  driver_avatar_url: string | null;
  driver_rating: number | null;
  vehicle_id: string | null;
  origen_nombre: string | null;
  origen_lat: number | null;
  origen_lng: number | null;
  destino_nombre: string | null;
  destino_lat: number | null;
  destino_lng: number | null;
  salida_at: string | null;
  precio: number | null;
  cupos_disponibles: number | null;
  descripcion: string | null;
  estado: string | null;
}): Trip | null {
  if (!row.id || !row.driver_id || !row.origen_nombre || !row.destino_nombre || !row.salida_at) {
    return null;
  }

  return {
    id: row.id,
    origin: {
      id: `${row.id}-origin`,
      label: row.origen_nombre,
      address: row.origen_nombre,
      latitude: row.origen_lat ?? 0,
      longitude: row.origen_lng ?? 0,
    },
    destination: {
      id: `${row.id}-destination`,
      label: row.destino_nombre,
      address: row.destino_nombre,
      latitude: row.destino_lat ?? 0,
      longitude: row.destino_lng ?? 0,
    },
    departureTime: row.salida_at,
    price: Number(row.precio ?? 0),
    seatsAvailable: Number(row.cupos_disponibles ?? 0),
    driver: {
      id: row.driver_id,
      name: row.driver_nombre ?? 'Conductor WheelsApp',
      email: '',
      role: 'driver',
      avatarUrl: row.driver_avatar_url ?? undefined,
      rating: { score: Number(row.driver_rating ?? 0) },
      vehicleId: row.vehicle_id ?? '',
    },
    passengers: [],
    status: statusMap[row.estado ?? 'por_empezar'] ?? 'pending',
    description: row.descripcion ?? undefined,
  };
}

export const tripService = {
  async getAvailableTrips(): Promise<Trip[]> {
    if (useSupabase) {
      ensureSupabaseConfigured();
      const { data, error } = await supabase
        .from('available_trips')
        .select('*')
        .order('salida_at');
      if (error) throw error;
      return data.map(mapAvailableTrip).filter((trip): trip is Trip => trip !== null);
    }

    return mockTrips;
  },
  async createTrip(input: CreateTripInput) {
    if (!useSupabase) throw new Error('SUPABASE_REQUIRED');
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from('trips')
      .insert({
        driver_id: userId,
        vehicle_id: input.vehicleId,
        origen_nombre: input.originName,
        origen_lat: input.originLat,
        origen_lng: input.originLng,
        destino_nombre: input.destinationName,
        destino_lat: input.destinationLat,
        destino_lng: input.destinationLng,
        salida_at: input.departureAt,
        precio: input.price,
        cupos_totales: input.totalSeats,
        descripcion: input.description,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  },
  async requestPickup(tripId: string, address: string, lat?: number, lng?: number) {
    if (!useSupabase) throw new Error('SUPABASE_REQUIRED');
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from('trip_requests')
      .insert({
        trip_id: tripId,
        passenger_id: userId,
        direccion: address,
        lat,
        lng,
      })
      .select('id')
      .single();
    if (error) throw error;
    notificationService.notify('request_created', data.id);
  },
  async getPassengerRequests(): Promise<TripRequestRecord[]> {
    if (!useSupabase) return [];
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from('trip_requests')
      .select(REQUEST_COLUMNS)
      .eq('passenger_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as unknown as RequestRow[]).map(mapRequest);
  },
  async getDriverRequests(): Promise<TripRequestRecord[]> {
    if (!useSupabase) return [];
    const userId = await requireUserId();
    const { data: trips, error: tripsError } = await supabase
      .from('trips')
      .select('id')
      .eq('driver_id', userId)
      .in('estado', ['por_empezar', 'en_curso']);
    if (tripsError) throw tripsError;
    const tripIds = trips.map((trip) => trip.id);
    if (!tripIds.length) return [];
    const { data, error } = await supabase
      .from('trip_requests')
      .select(REQUEST_COLUMNS)
      .in('trip_id', tripIds)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as unknown as RequestRow[]).map(mapRequest);
  },
  async getDriverTrips(): Promise<DriverTripRecord[]> {
    if (!useSupabase) return [];
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from('trips')
      .select('id, origen_nombre, destino_nombre, salida_at, precio, cupos_totales, estado')
      .eq('driver_id', userId)
      .order('salida_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data.map((row) => ({
      id: row.id,
      originName: row.origen_nombre,
      destinationName: row.destino_nombre,
      departureAt: row.salida_at,
      price: Number(row.precio),
      totalSeats: row.cupos_totales,
      status: row.estado,
    }));
  },
  async cancelRequest(requestId: string) {
    if (!useSupabase) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { error } = await supabase.rpc('cancel_trip_request', { p_request_id: requestId });
    if (error) throw error;
    notificationService.notify('request_cancelled', requestId);
  },
  async respondToRequest(requestId: string, accept: boolean) {
    if (!useSupabase) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { error } = await supabase.rpc('respond_trip_request', {
      p_request_id: requestId,
      p_accept: accept,
    });
    if (error) throw error;
    notificationService.notify('request_responded', requestId);
  },
  async startTrip(tripId: string) {
    if (!useSupabase) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { error } = await supabase.rpc('start_trip', { p_trip_id: tripId });
    if (error) throw error;
  },
  async finishTrip(tripId: string) {
    if (!useSupabase) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { error } = await supabase.rpc('finish_trip', { p_trip_id: tripId });
    if (error) throw error;
  },
  async boardPassenger(qrToken: string) {
    if (!useSupabase) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { error } = await supabase.rpc('board_passenger', { p_qr_token: qrToken });
    if (error) throw error;
  },
  async cancelTrip(tripId: string): Promise<Trip | undefined> {
    if (useSupabase) {
      ensureSupabaseConfigured();
      const { error } = await supabase.rpc('cancel_trip', { p_trip_id: tripId });
      if (error) throw error;
      return undefined;
    }
    return updateMockTripStatus(tripId, 'cancelled');
  },
};

function updateMockTripStatus(tripId: string, status: TripStatus) {
  const trip = mockTrips.find((item) => item.id === tripId);

  if (!trip) {
    return undefined;
  }

  return { ...trip, status };
}
