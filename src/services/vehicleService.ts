import { mockVehicles } from '@/data/mock/vehicles';
import { ensureSupabaseConfigured, isSupabaseEnabled, supabase } from '@/lib/supabase';
import type { Database } from '@/lib/database.types';
import { Vehicle } from '@/types';

type VehicleRow = Database['public']['Tables']['vehicles']['Row'];

function mapVehicle(row: VehicleRow): Vehicle {
  return {
    id: row.id,
    ownerId: row.driver_id,
    brand: row.marca,
    model: row.marca,
    plate: row.placa,
    seats: row.puestos,
    color: row.color,
    photoUrl: row.foto_url ?? undefined,
  };
}

async function requireUserId() {
  ensureSupabaseConfigured();
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('AUTH_REQUIRED');
  return data.user.id;
}

/** Most passengers a vehicle or a trip can take (also enforced by the database). */
export const MAX_SEATS = 6;

const PHOTO_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** "abc-123" → "ABC123". */
export function normalizePlate(plate: string) {
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Colombian plates: cars ABC123, motorcycles ABC12D. */
export function isValidPlate(plate: string) {
  return /^[A-Z]{3}\d{3}$|^[A-Z]{3}\d{2}[A-Z]$/.test(normalizePlate(plate));
}

export type VehicleInput = {
  plate: string;
  brand: string;
  color: string;
  seats: number;
};

/** Uploads to vehicle-photos/<uid>/<vehicleId>.<ext> (public bucket) and returns its URL. */
async function uploadPhoto(userId: string, vehicleId: string, uri: string, mimeType: string) {
  const extension = PHOTO_TYPES[mimeType] ?? 'jpg';
  const image = await (await fetch(uri)).arrayBuffer();
  if (!image.byteLength) throw new Error('No se pudo leer la foto del vehículo.');
  if (image.byteLength > 10 * 1024 * 1024) throw new Error('La foto supera el límite de 10 MB.');
  const path = `${userId}/${vehicleId}.${extension}`;
  const { error } = await supabase.storage
    .from('vehicle-photos')
    .upload(path, image, { contentType: PHOTO_TYPES[mimeType] ? mimeType : 'image/jpeg', upsert: true });
  if (error) throw error;
  // Cache-bust: the path is reused when the photo changes.
  return `${supabase.storage.from('vehicle-photos').getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
}

export const vehicleService = {
  /** The driver's active vehicles, newest first. */
  async getMyVehicles(): Promise<Vehicle[]> {
    if (!isSupabaseEnabled) return mockVehicles;
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from('vehicles')
      .select('*')
      .eq('driver_id', userId)
      .eq('activo', true)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data.map(mapVehicle);
  },

  async getVehicle(vehicleId: string): Promise<Vehicle | undefined> {
    if (!isSupabaseEnabled) return mockVehicles.find((vehicle) => vehicle.id === vehicleId);
    ensureSupabaseConfigured();
    const { data, error } = await supabase.from('vehicles').select('*').eq('id', vehicleId).maybeSingle();
    if (error) throw error;
    return data ? mapVehicle(data) : undefined;
  },

  /**
   * Creates the vehicle (or updates `vehicleId`) and, when `photo` is given,
   * uploads it. A new vehicle needs a photo.
   */
  async saveVehicle(
    input: VehicleInput,
    photo: { uri: string; mimeType: string } | null,
    vehicleId?: string,
  ): Promise<Vehicle> {
    if (!isSupabaseEnabled) throw new Error('SUPABASE_REQUIRED');
    const userId = await requireUserId();
    if (!vehicleId && !photo) throw new Error('Agrega una foto del vehículo.');
    const values = {
      placa: normalizePlate(input.plate),
      marca: input.brand.trim(),
      color: input.color.trim(),
      puestos: input.seats,
    };

    // Plates are unique: re-adding a vehicle the driver removed brings it back.
    let targetId = vehicleId;
    if (!targetId) {
      const { data: removed, error: lookupError } = await supabase
        .from('vehicles')
        .select('id')
        .eq('driver_id', userId)
        .eq('placa', values.placa)
        .eq('activo', false)
        .maybeSingle();
      if (lookupError) throw lookupError;
      targetId = removed?.id;
    }

    const saved = targetId
      ? await supabase.from('vehicles').update({ ...values, activo: true }).eq('id', targetId).select('*').single()
      : await supabase.from('vehicles').insert({ ...values, driver_id: userId }).select('*').single();
    if (saved.error) throw saved.error;
    if (!photo) return mapVehicle(saved.data);

    try {
      const url = await uploadPhoto(userId, saved.data.id, photo.uri, photo.mimeType);
      const { data, error } = await supabase.from('vehicles').update({ foto_url: url }).eq('id', saved.data.id).select('*').single();
      if (error) throw error;
      return mapVehicle(data);
    } catch (photoError) {
      // Don't leave a new vehicle without its required photo.
      if (!targetId) await supabase.from('vehicles').delete().eq('id', saved.data.id);
      throw photoError;
    }
  },

  /**
   * Hides a vehicle from the driver's list. Past trips keep referencing it,
   * so it is deactivated rather than deleted. Not allowed with upcoming trips.
   */
  async deactivateVehicle(vehicleId: string): Promise<void> {
    if (!isSupabaseEnabled) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { count, error: tripsError } = await supabase
      .from('trips')
      .select('id', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId)
      .in('estado', ['por_empezar', 'en_curso']);
    if (tripsError) throw tripsError;
    if (count) throw new Error('Este vehículo tiene viajes próximos o en curso. Cancélalos o finalízalos antes de quitarlo.');
    const { error } = await supabase.from('vehicles').update({ activo: false }).eq('id', vehicleId);
    if (error) throw error;
  },
};
