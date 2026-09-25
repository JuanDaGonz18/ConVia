import * as SecureStore from 'expo-secure-store';

const EMBEDDING_PREFIX = 'face_embedding_';
export const FACE_EMBEDDING_SIZE = 128;

function keyForUser(userId: string) {
  return `${EMBEDDING_PREFIX}${userId}`;
}

export const faceStorageService = {
  async saveEmbedding(userId: string, embedding: Float32Array | number[]) {
    if (embedding.length !== FACE_EMBEDDING_SIZE) throw new Error('invalid_embedding');
    await SecureStore.setItemAsync(keyForUser(userId), JSON.stringify([...embedding]));
  },

  async loadEmbedding(userId: string): Promise<Float32Array | null> {
    const value = await SecureStore.getItemAsync(keyForUser(userId));
    if (!value) return null;
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== FACE_EMBEDDING_SIZE) {
      throw new Error('invalid_embedding');
    }
    return new Float32Array(parsed.map((item) => Number(item)));
  },

  async deleteEmbedding(userId: string) {
    await SecureStore.deleteItemAsync(keyForUser(userId));
  },
};