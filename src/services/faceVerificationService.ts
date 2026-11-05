import { FaceVerificationFailureReason, FaceVerificationResult, FaceVerificationTrigger } from '@/types';
import { ensureSupabaseConfigured, isSupabaseEnabled, supabase } from '@/lib/supabase';
import { computeFaceEmbedding, FaceCheckError } from '@/services/faceRecognition';
import i18n from '@/i18n';

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
    if (!isSupabaseEnabled) return errorResult(i18n.t('face.needsServer'), 'network_error');

    let embedding: number[];
    try {
      embedding = await computeFaceEmbedding(uri);
    } catch (error) {
      if (error instanceof FaceCheckError) return errorResult(error.message, error.reason);
      return errorResult(i18n.t('face.processFailed'), 'model_unavailable');
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
          ? i18n.t(response.enrolled ? 'face.enrolled' : againstLicense ? 'face.matchesLicense' : 'face.verified')
          : i18n.t(response.reason === 'LICENSE_PHOTO_RECAPTURE' ? 'face.recapture' : againstLicense ? 'face.licenseMismatch' : 'face.mismatch'),
      };
    } catch {
      return errorResult(i18n.t('face.connectFailed'), 'network_error');
    }
  },

  /**
   * Driver's license photo: the phone finds the portrait on the card, turns it
   * into an embedding and deletes the photo. Only the embedding is sent; the
   * server keeps it as the driver's reference face. This does NOT check that
   * the license is authentic or officially registered.
   */
  async submitLicensePhoto(uri: string): Promise<{ ok: true } | { ok: false; message: string; reason: FaceVerificationFailureReason }> {
    if (!isSupabaseEnabled) return { ok: false, message: i18n.t('face.featureNeedsServer'), reason: 'network_error' };
    let embedding: number[];
    try {
      embedding = await computeFaceEmbedding(uri, 'document');
    } catch (error) {
      if (error instanceof FaceCheckError) return { ok: false, message: error.message, reason: error.reason };
      return { ok: false, message: i18n.t('face.processFailed'), reason: 'model_unavailable' };
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
      return { ok: false, message: i18n.t('face.connectFailed'), reason: 'network_error' };
    }
  },
};

/** Server messages meant for the user are shown as-is; anything else is treated as a connection problem. */
function serverError(message: string): FaceVerificationResult {
  if (message.includes('Demasiados intentos')) return errorResult(message, 'too_many_attempts');
  if (/licencia|suspendido/i.test(message)) return errorResult(message, 'storage_error');
  return errorResult(i18n.t('face.recordFailed'), 'network_error');
}
