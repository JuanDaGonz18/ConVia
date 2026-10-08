import { mockTrips } from '@/data/mock/trips';
import { ensureSupabaseConfigured, isSupabaseEnabled, supabase } from '@/lib/supabase';
import { notificationService } from '@/services/notificationService';
import { matchFromServer, TripMatch } from '@/services/tripMatching';
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
  /** The passenger has ConVía+: their requests have priority (enforced by the server). */
  passengerIsPlus: boolean;
  tripLabel: string | null;
  tripDepartureAt: string | null;
  /** Latest change the driver made to the trip, shown to the passenger. */
  lastUpdate: { changes: string[]; at: string } | null;
  /** Where the passenger gets off, when they said (exact only once accepted). */
  dropoffLabel: string | null;
  /** Driver view: how well the request fits the trip, computed by the server. */
  match: TripMatch | null;
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
  /** Null for old trips saved without coordinates. */
  origin: Location | null;
  destination: Location | null;
  route?: TripRoute;
  departureAt: string;
  price: number;
  totalSeats: number;
  status: DriverTripStatus;
};

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
  driver_is_plus: boolean | null;
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
      name: row.driver_nombre ?? 'Conductor ConVía',
      email: '',
      role: 'driver',
      avatarUrl: row.driver_avatar_url ?? undefined,
      rating: { score: Number(row.driver_rating ?? 0) },
      vehicleId: row.vehicle_id ?? '',
      isPlus: row.driver_is_plus === true,
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
      // One's own trips can't be requested, so they never appear as available
      // (recommendations, lists, map or trip details).
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      let query = supabase.from('available_trips').select('*').order('salida_at');
      if (userId) query = query.neq('driver_id', userId);
      const { data, error } = await query;
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
  /** `dropoff`: where the passenger wants to get off (optional), so the driver can judge the fit. */
  async requestPickup(tripId: string, address: string, lat?: number, lng?: number, dropoff?: Location | null) {
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
        destino_nombre: dropoff?.label ?? null,
        destino_lat: dropoff?.latitude ?? null,
        destino_lng: dropoff?.longitude ?? null,
      })
      .select('id')
      .single();
    if (error) throw error;
    notificationService.notify('request_created', data.id);
  },
  /**
   * The passenger's own requests, newest first, with the driver's latest change
   * to each active one. The server returns trip places without house numbers.
   */
  async getPassengerRequests(): Promise<TripRequestRecord[]> {
    if (!useSupabase) return [];
    const userId = await requireUserId();
    const { data, error } = await supabase.rpc('my_trip_requests');
    if (error) throw error;
    return data.map((row) => ({
      id: row.id,
      trip_id: row.trip_id,
      passenger_id: userId,
      direccion: row.direccion,
      estado: row.estado,
      qr_token: row.qr_token,
      created_at: row.created_at,
      responded_at: row.responded_at,
      passengerName: null,
      passengerIsPlus: false,
      tripLabel: `${row.origen_viaje} → ${row.destino_viaje}`,
      tripDepartureAt: row.salida_at,
      lastUpdate: row.last_changes?.length ? { changes: row.last_changes, at: row.last_change_at } : null,
      dropoffLabel: row.destino_nombre || null,
      match: null,
    }));
  },
  /**
   * Requests for the driver's active trips, already ordered by the server:
   * compatibility first, ConVía+ as tie-breaker, then the newest. Pickup and
   * drop-off are exact only for accepted passengers.
   */
  async getDriverRequests(): Promise<TripRequestRecord[]> {
    if (!useSupabase) return [];
    ensureSupabaseConfigured();
    const { data, error } = await supabase.rpc('driver_trip_requests');
    if (error) throw error;
    return data.map((row) => ({
      id: row.id,
      trip_id: row.trip_id,
      passenger_id: row.passenger_id,
      direccion: row.direccion,
      estado: row.estado,
      qr_token: row.qr_token,
      created_at: row.created_at,
      responded_at: row.responded_at,
      passengerName: row.passenger_nombre || null,
      passengerIsPlus: row.passenger_is_plus === true,
      tripLabel: `${row.origen_nombre} → ${row.destino_viaje}`,
      tripDepartureAt: row.salida_at,
      lastUpdate: null,
      dropoffLabel: row.destino_nombre || null,
      match: matchFromServer({ score: row.match_score, level: row.match_level, pickupKm: row.pickup_km, dropoffKm: row.dropoff_km }),
    }));
  },

  /** Every trip the passenger had a seat on (or that was cancelled on them), newest first. */
  async getPassengerHistory(): Promise<PassengerTripRecord[]> {
    if (!useSupabase) return [];
    ensureSupabaseConfigured();
    const { data, error } = await supabase.rpc('passenger_trip_history');
    if (error) throw error;
    return data.map((row) => ({
      tripId: row.trip_id,
      requestId: row.request_id,
      requestStatus: row.request_estado,
      status: row.estado,
      originName: row.origen_nombre,
      destinationName: row.destino_nombre,
      departureAt: row.salida_at,
      finishedAt: row.finished_at,
      price: Number(row.precio),
      driver: {
        id: row.driver_id,
        name: row.driver_nombre,
        avatarUrl: row.driver_avatar_url ?? undefined,
        rating: Number(row.driver_rating ?? 0),
        isPlus: row.driver_is_plus === true,
      },
      myDriverScore: row.my_driver_score,
    }));
  },

  /** The passenger rates the driver of a finished trip (once; the server rejects repeats). */
  async rateDriver(tripId: string, score: number, comment: string | null) {
    if (!useSupabase) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { error } = await supabase.rpc('rate_trip_driver', { p_trip_id: tripId, p_score: score, p_comment: comment ?? undefined });
    if (error) throw error;
  },
  async getDriverTrips(): Promise<DriverTripRecord[]> {
    if (!useSupabase) return [];
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from('trips')
      .select('id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, ruta, salida_at, precio, cupos_totales, estado')
      .eq('driver_id', userId)
      .order('salida_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data.map((row) => ({
      id: row.id,
      originName: row.origen_nombre,
      destinationName: row.destino_nombre,
      origin: row.origen_lat !== null && row.origen_lng !== null
        ? place(`${row.id}-origin`, row.origen_nombre, row.origen_lat, row.origen_lng)
        : null,
      destination: row.destino_lat !== null && row.destino_lng !== null
        ? place(`${row.id}-destination`, row.destino_nombre, row.destino_lat, row.destino_lng)
        : null,
      route: parseRoute(row.ruta),
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

export type PassengerTripRecord = {
  tripId: string;
  requestId: string;
  requestStatus: TripRequestStatus;
  status: DriverTripStatus;
  originName: string;
  destinationName: string;
  departureAt: string;
  finishedAt: string | null;
  price: number;
  driver: { id: string; name: string; avatarUrl?: string; rating: number; isPlus: boolean };
  /** The score this passenger gave the driver; null when not rated yet. */
  myDriverScore: number | null;
};

/** A finished trip whose driver the passenger has not rated yet. */
export function needsDriverRating(trip: PassengerTripRecord) {
  return trip.status === 'finalizado' && trip.myDriverScore === null
    && (trip.requestStatus === 'aceptado' || trip.requestStatus === 'abordado');
}

export type TripMember = {
  requestId: string;
  id: string;
  name: string;
  avatarUrl?: string;
  rating: number;
  ratingCount: number;
  isPlus: boolean;
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
  driver: { id: string; name: string; avatarUrl?: string; rating: number; ratingCount: number; isPlus: boolean };
  /** Passenger viewer only: the rating they gave the driver, if any. */
  myDriverRating: { score: number; comment: string | null } | null;
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
  driver: { id: string; nombre: string; avatar_url: string | null; rating: number | null; rating_count: number | null; is_plus?: boolean };
  mi_calificacion_conductor?: { score: number; comentario: string | null } | null;
  passengers: {
    request_id: string; id: string; nombre: string; avatar_url: string | null;
    rating: number | null; rating_count: number | null; is_plus?: boolean; estado: TripRequestStatus; es_yo: boolean;
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
      isPlus: driver.is_plus === true,
    },
    myDriverRating: row.mi_calificacion_conductor
      ? { score: row.mi_calificacion_conductor.score, comment: row.mi_calificacion_conductor.comentario }
      : null,
    passengers: row.passengers.map((passenger) => ({
      requestId: passenger.request_id,
      id: passenger.id,
      name: passenger.nombre,
      avatarUrl: passenger.avatar_url ?? undefined,
      rating: Number(passenger.rating ?? 0),
      ratingCount: Number(passenger.rating_count ?? 0),
      isPlus: passenger.is_plus === true,
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
