import { FaceRegisterPayload, FaceVerificationResult } from '@/types';
import { cosineSimilarity, generateFaceEmbedding } from '@/services/faceEmbeddingService';
import { faceStorageService } from '@/services/faceStorageService';

export const FACE_MATCH_THRESHOLD = 0.6;

function localReferenceId(userId: string) {
  return `local-face-${userId}`;
}

export const faceVerificationService = {
  async registerEmbedding(userId: string, rgb: Uint8Array) {
    const embedding = await generateFaceEmbedding(rgb);
    await faceStorageService.saveEmbedding(userId, embedding);
    return { embedding, faceReferenceId: localReferenceId(userId) };
  },

  async verifyEmbedding(userId: string, rgb: Uint8Array): Promise<FaceVerificationResult> {
    const registered = await faceStorageService.loadEmbedding(userId);
    if (!registered) throw new Error('embedding_unavailable');

    const current = await generateFaceEmbedding(rgb);
    const similarity = cosineSimilarity(current, registered);
    return {
      verified: similarity >= FACE_MATCH_THRESHOLD,
      livenessPassed: true,
      faceMatched: similarity >= FACE_MATCH_THRESHOLD,
      similarity,
      faceReferenceId: localReferenceId(userId),
    };
  },

  async registerFaceReference(payload: FaceRegisterPayload) {
    return { faceReferenceId: localReferenceId(payload.userId) };
  },

  async startMockVerification() {
    return 'verified' as const;
  },
};
