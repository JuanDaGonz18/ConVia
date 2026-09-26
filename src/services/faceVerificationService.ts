import { FaceVerificationFailureReason, FaceVerificationResult, FaceVerificationTrigger } from '@/types';
import { ensureSupabaseConfigured, isSupabaseEnabled, supabase } from '@/lib/supabase';
import { computeFaceEmbedding, FaceCheckError } from '@/services/faceRecognition';

type SubmitResponse = {
  result: 'verified' | 'not_verified';
  enrolled: boolean;
  reason: 'FACE_MISMATCH' | 'LICENSE_PHOTO_RECAPTURE' | null;
  similarity: number | null;
  threshold: number;
};

const errorResult = (message: string, failureReason: FaceVerificationResult['failureReason']): FaceVerificationResult => ({
  status: 'error',
  verified: false,
  livenessPassed: false,
  faceMatched: false,
  similarity: 0,
  failureReason,
  message,
});

/**
 * Face verification without any paid service:
 *  1. The phone turns the selfie into a 128-number embedding (faceRecognition.ts)
 *     and deletes the photo.
 *  2. submit_face_embedding() stores it on first use (registration) or compares
 *     it server-side with the registered template. The template is never sent
 *     back to the app, and the result is recorded by the database.
 */
export const faceVerificationService = {
  async verifyPhoto(_userId: string, uri: string, trigger: FaceVerificationTrigger): Promise<FaceVerificationResult> {
    if (!isSupabaseEnabled) return errorResult('La verificación facial requiere conexión con Supabase.', 'network_error');

    let embedding: number[];
    try {
      embedding = await computeFaceEmbedding(uri);
    } catch (error) {
      if (error instanceof FaceCheckError) return errorResult(error.message, error.reason);
      return errorResult('No se pudo procesar la foto. Inténtalo de nuevo.', 'model_unavailable');
    }

    try {
      ensureSupabaseConfigured();
      const { data, error } = await supabase.rpc('submit_face_embedding', {
        p_embedding: embedding,
        p_purpose: trigger,
      });
      if (error) return serverError(error.message);
      const response = data as unknown as SubmitResponse;
      const verified = response.result === 'verified';
      const againstLicense = trigger === 'driver_identity' || trigger === 'driver_activate';
      return {
        status: verified ? 'verified' : 'not_verified',
        verified,
        livenessPassed: false,
        faceMatched: verified,
        similarity: response.similarity ?? 1,
        failureReason: verified ? undefined : 'face_mismatch',
        message: verified
          ? response.enrolled ? 'Rostro registrado.' : againstLicense ? 'Tu identidad coincide con la foto de tu licencia.' : 'Identidad verificada.'
          : response.reason === 'LICENSE_PHOTO_RECAPTURE'
            ? 'Parece una foto de la licencia, no una selfie en vivo. Toma la selfie directamente a tu rostro.'
            : againstLicense
              ? 'Tu rostro no coincide con la foto de tu licencia. Inténtalo de frente y con buena luz.'
              : 'El rostro no coincide con el registrado. Inténtalo de frente y con buena luz.',
      };
    } catch {
      return errorResult('No se pudo conectar con el servidor. Revisa tu conexión.', 'network_error');
    }
  },

  /**
   * Driver's license photo: the phone finds the portrait on the card, turns it
   * into an embedding and deletes the photo. Only the embedding is sent; the
   * server keeps it as the driver's reference face. This does NOT check that
   * the license is authentic or officially registered.
   */
  async submitLicensePhoto(uri: string): Promise<{ ok: true } | { ok: false; message: string; reason: FaceVerificationFailureReason }> {
    if (!isSupabaseEnabled) return { ok: false, message: 'Esta función requiere conexión con Supabase.', reason: 'network_error' };
    let embedding: number[];
    try {
      embedding = await computeFaceEmbedding(uri, 'document');
    } catch (error) {
      if (error instanceof FaceCheckError) return { ok: false, message: error.message, reason: error.reason };
      return { ok: false, message: 'No se pudo procesar la foto. Inténtalo de nuevo.', reason: 'model_unavailable' };
    }
    try {
      ensureSupabaseConfigured();
      const { error } = await supabase.rpc('submit_license_face', { p_embedding: embedding });
      if (error) {
        const result = serverError(error.message);
        return { ok: false, message: result.message ?? '', reason: result.failureReason ?? 'network_error' };
      }
      return { ok: true };
    } catch {
      return { ok: false, message: 'No se pudo conectar con el servidor. Revisa tu conexión.', reason: 'network_error' };
    }
  },
};

/** Server messages meant for the user are shown as-is; anything else is treated as a connection problem. */
function serverError(message: string): FaceVerificationResult {
  if (message.includes('Demasiados intentos')) return errorResult(message, 'too_many_attempts');
  if (/licencia|suspendido/i.test(message)) return errorResult(message, 'storage_error');
  return errorResult('No se pudo registrar la verificación. Revisa tu conexión e inténtalo de nuevo.', 'network_error');
}
