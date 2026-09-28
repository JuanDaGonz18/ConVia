import { mockTrips } from '@/data/mock/trips';
import { ensureSupabaseConfigured, isSupabaseEnabled, supabase } from '@/lib/supabase';
import { notificationService } from '@/services/notificationService';
import type { Json } from '@/lib/database.types';
import { Location, Trip, TripRoute, TripStatus } from '@/types';

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
  /** Route chosen by the driver; null when it could not be computed. */
  route?: TripRoute | null;
};

type StoredRoute = {
  coords: [number, number][];
  km: number;
  minutes: number;
  via?: { label: string; lat: number; lng: number }[];
};

/** trips.ruta ([lng, lat] pairs) → TripRoute. Invalid or missing data gives undefined. */
export function parseRoute(value: unknown): TripRoute | undefined {
  const route = value as StoredRoute | null;
  if (!route || !Array.isArray(route.coords) || route.coords.length < 2) return undefined;
  return {
    coordinates: route.coords.map(([longitude, latitude]) => ({ latitude, longitude })),
    km: Number(route.km) || 0,
    minutes: Number(route.minutes) || 0,
    via: (route.via ?? []).map((stop) => ({
      id: `${stop.lat.toFixed(6)},${stop.lng.toFixed(6)}`,
      label: stop.label,
      address: stop.label,
      latitude: stop.lat,
      longitude: stop.lng,
    })),
  };
}

/** TripRoute → the compact shape stored in trips.ruta. */
function serializeRoute(route: TripRoute | null | undefined): Json | null {
  if (!route) return null;
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  return {
    coords: route.coordinates.map((point) => [round(point.longitude), round(point.latitude)]),
    km: Math.round(route.km * 10) / 10,
    minutes: route.minutes,
    via: route.via.map((stop) => ({ label: stop.label.slice(0, 80), lat: round(stop.latitude), lng: round(stop.longitude) })),
  };
}

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
  /** Latest change the driver made to the trip, shown to the passenger. */
  lastUpdate: { changes: string[]; at: string } | null;
};

export type DriverTripStatus = 'por_empezar' | 'en_curso' | 'finalizado' | 'cancelado' | 'no_iniciado';

/** What "Repetir viaje" copies from a previous trip. */
export type TripTemplate = {
  vehicleId: string;
  origin: { label: string; latitude: number | null; longitude: number | null };
  destination: { label: string; latitude: number | null; longitude: number | null };
  departureAt: string;
  price: number;
  totalSeats: number;
  description: string | null;
  status: DriverTripStatus;
  /** Passengers already accepted (they are notified when the trip changes). */
  acceptedCount: number;
  route: TripRoute | undefined;
};

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

type RequestRow = Omit<TripRequestRecord, 'passengerName' | 'tripLabel' | 'tripDepartureAt' | 'lastUpdate'> & {
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
    lastUpdate: null,
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
  no_iniciado: 'not_started',
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
  vehicle_marca: string | null;
  vehicle_color: string | null;
  vehicle_placa: string | null;
  vehicle_foto_url: string | null;
  ruta: Json | null;
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
    vehicle: row.vehicle_placa
      ? {
          brand: row.vehicle_marca ?? '',
          color: row.vehicle_color ?? '',
          plate: row.vehicle_placa,
          photoUrl: row.vehicle_foto_url ?? undefined,
        }
      : undefined,
    route: parseRoute(row.ruta),
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
        ruta: serializeRoute(input.route),
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
    const requests = (data as unknown as RequestRow[]).map(mapRequest);

    // Attach the driver's latest change to each active request's trip.
    const activeTripIds = [...new Set(requests
      .filter((request) => request.estado === 'pendiente' || request.estado === 'aceptado')
      .map((request) => request.trip_id))];
    if (!activeTripIds.length) return requests;
    const { data: updates, error: updatesError } = await supabase
      .from('trip_updates')
      .select('trip_id, changes, created_at')
      .in('trip_id', activeTripIds)
      .order('created_at', { ascending: false });
    if (updatesError) return requests; // The list still works without the change log.
    const latest = new Map<string, { changes: string[]; at: string }>();
    for (const update of updates) {
      if (!latest.has(update.trip_id)) latest.set(update.trip_id, { changes: update.changes, at: update.created_at });
    }
    return requests.map((request) => ({ ...request, lastUpdate: latest.get(request.trip_id) ?? null }));
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
  /** A previous trip of this driver, to prefill "Repetir viaje". */
  async getTripTemplate(tripId: string): Promise<TripTemplate | null> {
    if (!useSupabase) return null;
    const userId = await requireUserId();
    const [{ data, error }, accepted] = await Promise.all([
      supabase
        .from('trips')
        .select('vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, salida_at, precio, cupos_totales, descripcion, estado, ruta')
        .eq('id', tripId)
        .eq('driver_id', userId)
        .maybeSingle(),
      supabase
        .from('trip_requests')
        .select('id', { count: 'exact', head: true })
        .eq('trip_id', tripId)
        .in('estado', ['aceptado', 'abordado']),
    ]);
    if (error) throw error;
    if (accepted.error) throw accepted.error;
    if (!data) return null;
    return {
      vehicleId: data.vehicle_id,
      origin: { label: data.origen_nombre, latitude: data.origen_lat, longitude: data.origen_lng },
      destination: { label: data.destino_nombre, latitude: data.destino_lat, longitude: data.destino_lng },
      departureAt: data.salida_at,
      price: Number(data.precio),
      totalSeats: data.cupos_totales,
      description: data.descripcion,
      status: data.estado,
      acceptedCount: accepted.count ?? 0,
      route: parseRoute(data.ruta),
    };
  },

  /**
   * Edits a published trip. The server validates the change, records a
   * readable summary and returns it; accepted passengers are then notified.
   */
  async updateTrip(tripId: string, input: CreateTripInput): Promise<{ changes: string[]; notified: number }> {
    if (!useSupabase) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { data, error } = await supabase.rpc('update_trip', {
      p_trip_id: tripId,
      p_vehicle_id: input.vehicleId,
      p_origen_nombre: input.originName,
      p_origen_lat: input.originLat ?? 0,
      p_origen_lng: input.originLng ?? 0,
      p_destino_nombre: input.destinationName,
      p_destino_lat: input.destinationLat ?? 0,
      p_destino_lng: input.destinationLng ?? 0,
      p_salida_at: input.departureAt,
      p_precio: input.price,
      p_cupos_totales: input.totalSeats,
      p_descripcion: input.description ?? '',
      p_ruta: serializeRoute(input.route) ?? undefined,
    });
    if (error) throw error;
    const result = data as unknown as { changes: string[]; update_id: string | null; accepted: number };
    if (result.update_id && result.accepted > 0) notificationService.notify('trip_updated', result.update_id);
    return { changes: result.changes, notified: result.update_id ? result.accepted : 0 };
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
  /** Marks the trip completed and tells its passengers. */
  async finishTrip(tripId: string) {
    if (!useSupabase) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { data, error } = await supabase.rpc('finish_trip', { p_trip_id: tripId });
    if (error) throw error;
    notifyAffected(data);
  },

  /** Driver, accepted passengers and trip details. Only for members of the trip. */
  async getTripMembers(tripId: string): Promise<TripMembers> {
    if (!useSupabase) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { data, error } = await supabase.rpc('trip_members', { p_trip_id: tripId });
    if (error) throw error;
    return mapMembers(data as unknown as MembersRow);
  },

  async setPassengerPayment(requestId: string, paid: boolean) {
    if (!useSupabase) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { error } = await supabase.rpc('set_passenger_payment', { p_request_id: requestId, p_paid: paid });
    if (error) throw error;
  },

  async ratePassenger(requestId: string, score: number, comment: string | null) {
    if (!useSupabase) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { error } = await supabase.rpc('rate_trip_passenger', {
      p_request_id: requestId,
      p_score: score,
      p_comment: comment ?? undefined,
    });
    if (error) throw error;
  },
  async boardPassenger(qrToken: string) {
    if (!useSupabase) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { error } = await supabase.rpc('board_passenger', { p_qr_token: qrToken });
    if (error) throw error;
  },
  /** Cancels the trip (even with reserved seats) and tells the affected passengers. */
  async cancelTrip(tripId: string): Promise<Trip | undefined> {
    if (useSupabase) {
      ensureSupabaseConfigured();
      const { data, error } = await supabase.rpc('cancel_trip', { p_trip_id: tripId });
      if (error) throw error;
      notifyAffected(data);
      return undefined;
    }
    return updateMockTripStatus(tripId, 'cancelled');
  },
};

/** cancel_trip/finish_trip return the trip_updates row that notify turns into pushes. */
function notifyAffected(result: unknown) {
  const { update_id: updateId, notified } = (result ?? {}) as { update_id?: string; notified?: number };
  if (updateId && notified) notificationService.notify('trip_updated', updateId);
}

export type TripMember = {
  requestId: string;
  id: string;
  name: string;
  avatarUrl?: string;
  rating: number;
  ratingCount: number;
  status: TripRequestStatus;
  isMe: boolean;
  /** Only visible to the driver (and to the passenger themself). */
  pickupAddress: string | null;
  /** Driver only. */
  paid: boolean | null;
  myRating: { score: number; comment: string | null } | null;
};

export type TripMembers = {
  viewerIsDriver: boolean;
  trip: {
    id: string;
    origin: Location;
    destination: Location;
    departureAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    status: DriverTripStatus;
    price: number;
    totalSeats: number;
    description: string | null;
    route?: TripRoute;
    vehicle: { brand: string; color: string; plate: string; photoUrl?: string } | null;
  };
  driver: { id: string; name: string; avatarUrl?: string; rating: number; ratingCount: number };
  passengers: TripMember[];
};

type MembersRow = {
  viewer_is_driver: boolean;
  trip: {
    id: string;
    origen_nombre: string; origen_lat: number | null; origen_lng: number | null;
    destino_nombre: string; destino_lat: number | null; destino_lng: number | null;
    salida_at: string; started_at: string | null; finished_at: string | null;
    estado: DriverTripStatus; precio: number; cupos_totales: number; descripcion: string | null;
    ruta: unknown;
    vehicle: { marca: string; color: string; placa: string; foto_url: string | null } | null;
  };
  driver: { id: string; nombre: string; avatar_url: string | null; rating: number | null; rating_count: number | null };
  passengers: {
    request_id: string; id: string; nombre: string; avatar_url: string | null;
    rating: number | null; rating_count: number | null; estado: TripRequestStatus; es_yo: boolean;
    direccion: string | null; pago: 'pagado' | 'no_pagado' | null;
    mi_calificacion: { score: number; comentario: string | null } | null;
  }[];
};

function place(id: string, label: string, latitude: number | null, longitude: number | null): Location {
  return { id, label, address: label, latitude: latitude ?? 0, longitude: longitude ?? 0 };
}

function mapMembers(row: MembersRow): TripMembers {
  const { trip, driver } = row;
  return {
    viewerIsDriver: row.viewer_is_driver,
    trip: {
      id: trip.id,
      origin: place(`${trip.id}-origin`, trip.origen_nombre, trip.origen_lat, trip.origen_lng),
      destination: place(`${trip.id}-destination`, trip.destino_nombre, trip.destino_lat, trip.destino_lng),
      departureAt: trip.salida_at,
      startedAt: trip.started_at,
      finishedAt: trip.finished_at,
      status: trip.estado,
      price: Number(trip.precio),
      totalSeats: trip.cupos_totales,
      description: trip.descripcion,
      route: parseRoute(trip.ruta),
      vehicle: trip.vehicle
        ? { brand: trip.vehicle.marca, color: trip.vehicle.color, plate: trip.vehicle.placa, photoUrl: trip.vehicle.foto_url ?? undefined }
        : null,
    },
    driver: {
      id: driver.id,
      name: driver.nombre,
      avatarUrl: driver.avatar_url ?? undefined,
      rating: Number(driver.rating ?? 0),
      ratingCount: Number(driver.rating_count ?? 0),
    },
    passengers: row.passengers.map((passenger) => ({
      requestId: passenger.request_id,
      id: passenger.id,
      name: passenger.nombre,
      avatarUrl: passenger.avatar_url ?? undefined,
      rating: Number(passenger.rating ?? 0),
      ratingCount: Number(passenger.rating_count ?? 0),
      status: passenger.estado,
      isMe: passenger.es_yo,
      pickupAddress: passenger.direccion,
      paid: passenger.pago === null ? null : passenger.pago === 'pagado',
      myRating: passenger.mi_calificacion
        ? { score: passenger.mi_calificacion.score, comment: passenger.mi_calificacion.comentario }
        : null,
    })),
  };
}

function updateMockTripStatus(tripId: string, status: TripStatus) {
  const trip = mockTrips.find((item) => item.id === tripId);

  if (!trip) {
    return undefined;
  }

  return { ...trip, status };
}
