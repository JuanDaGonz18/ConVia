import { randomUUID } from 'expo-crypto';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { ensureSupabaseConfigured, isSupabaseEnabled, supabase } from '@/lib/supabase';
import { isValidPlate, normalizePlate } from '@/services/vehicleService';

export type VehicleVerificationStatus = 'verified' | 'failed' | 'retry';

export type VehicleVerification = {
  status: VehicleVerificationStatus;
  /** Stable code from the server, e.g. 'no_plate' or 'plate_mismatch'. */
  reason: string;
  /** Explanation for the driver, in Spanish. */
  message: string;
  plateRead: string | null;
  confidence: number | null;
  /** When the result was recorded; null if it wasn't. */
  verifiedAt: string | null;
  /** The server ran without MODEL_API_KEY and simulated the models. */
  mock: boolean;
};

type FunctionResponse = {
  status: VehicleVerificationStatus;
  reason: string;
  message: string;
  plate_read: string | null;
  confidence: number | null;
  verified_at: string | null;
  mock: boolean;
};

const retry = (message: string, reason = 'client_error'): VehicleVerification => ({
  status: 'retry',
  reason,
  message,
  plateRead: null,
  confidence: null,
  verifiedAt: null,
  mock: false,
});

/** Only cars (ABC123) can be verified automatically; motorcycle plates (ABC12D) can't. */
export function canVerifyPlate(plate: string) {
  return isValidPlate(plate) && /^[A-Z]{3}\d{3}$/.test(normalizePlate(plate));
}

/**
 * Vehicle verification with AI (Edge Function verify-vehicle): the photo is
 * uploaded to vehicle-photos/<uid>/verify-<random>.jpg, the server checks it
 * with SAM 3.1 + Muse Spark and deletes it. Faces are never sent: this photo
 * is only of the car.
 */
export const vehicleVerificationService = {
  async verify(vehicleId: string, photo: { uri: string; mimeType: string }): Promise<VehicleVerification> {
    if (!isSupabaseEnabled) return retry('La verificación del vehículo requiere conexión con Supabase.');
    ensureSupabaseConfigured();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return retry('Tu sesión expiró. Vuelve a iniciar sesión.', 'auth_required');

    const path = `${userData.user.id}/verify-${randomUUID()}.jpg`;
    try {
      const image = await (await fetch(photo.uri)).arrayBuffer();
      if (!image.byteLength) return retry('No se pudo leer la foto. Tómala de nuevo.');
      const { error } = await supabase.storage
        .from('vehicle-photos')
        .upload(path, image, { contentType: photo.mimeType || 'image/jpeg', upsert: false });
      if (error) return retry('No se pudo subir la foto. Revisa tu conexión e inténtalo de nuevo.', 'upload_failed');
    } catch {
      return retry('No se pudo subir la foto. Revisa tu conexión e inténtalo de nuevo.', 'upload_failed');
    }

    const { data, error } = await supabase.functions.invoke<FunctionResponse>('verify-vehicle', {
      body: { vehicle_id: vehicleId, photo_path: path },
    });
    if (error || !data?.status) {
      // The server deletes the photo after checking it; if it never got it, don't leave the plate stored.
      void supabase.storage.from('vehicle-photos').remove([path]).catch(() => undefined);
      if (error instanceof FunctionsHttpError && error.context.status === 404) {
        return retry('No encontramos el vehículo o la foto. Guarda el vehículo e inténtalo de nuevo.', 'not_found');
      }
      return retry('No se pudo conectar con el servicio de verificación. Inténtalo de nuevo.', 'network_error');
    }
    return {
      status: data.status,
      reason: data.reason,
      message: data.message,
      plateRead: data.plate_read,
      confidence: data.confidence,
      verifiedAt: data.verified_at,
      mock: data.mock,
    };
  },

  /**
   * The vehicle's latest recorded verification, or null. A result only counts
   * for the plate it was made with: after a plate change it no longer applies.
   */
  async getLatest(vehicleId: string, currentPlate: string): Promise<VehicleVerification | null> {
    if (!isSupabaseEnabled) return null;
    ensureSupabaseConfigured();
    const { data, error } = await supabase
      .from('vehicle_verifications')
      .select('status, reason, message, plate_read, plate_expected, confidence, created_at, mock')
      .eq('vehicle_id', vehicleId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.plate_expected !== normalizePlate(currentPlate)) return null;
    return {
      status: data.status as VehicleVerificationStatus,
      reason: data.reason,
      message: data.message,
      plateRead: data.plate_read,
      confidence: data.confidence,
      verifiedAt: data.created_at,
      mock: data.mock,
    };
  },
};
