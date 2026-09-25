import { Asset } from 'expo-asset';
import * as ort from 'onnxruntime-react-native';
import type { InferenceSession, Tensor } from 'onnxruntime-common';
import { FACE_EMBEDDING_SIZE } from '@/services/faceStorageService';

const ortRuntime = ort as unknown as {
  InferenceSession: typeof InferenceSession;
  Tensor: typeof Tensor;
};

// Metro treats the ONNX file as a bundled asset.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MODEL_ASSET = require('../../assets/models/sface_int8.onnx');
const INPUT_SIZE = 112;
const RGB_CHANNELS = 3;
let sessionPromise: Promise<InferenceSession> | null = null;

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const asset = Asset.fromModule(MODEL_ASSET);
      await asset.downloadAsync();
      return ortRuntime.InferenceSession.create(asset.localUri ?? asset.uri);
    })();
  }
  return sessionPromise;
}

export async function generateFaceEmbedding(rgb: Uint8Array): Promise<Float32Array> {
  const expectedLength = INPUT_SIZE * INPUT_SIZE * RGB_CHANNELS;
  if (rgb.length !== expectedLength) throw new Error('invalid_face_frame');

  const input = new Float32Array(expectedLength);
  const planeSize = INPUT_SIZE * INPUT_SIZE;
  for (let pixel = 0; pixel < planeSize; pixel += 1) {
    input[pixel] = rgb[pixel * 3] / 255;
    input[planeSize + pixel] = rgb[pixel * 3 + 1] / 255;
    input[planeSize * 2 + pixel] = rgb[pixel * 3 + 2] / 255;
  }

  const session = await getSession();
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const result = await session.run({
    [inputName]: new ortRuntime.Tensor('float32', input, [1, 3, INPUT_SIZE, INPUT_SIZE]) as Tensor,
  });
  const output = result[outputName]?.data;
  if (!output || output.length < FACE_EMBEDDING_SIZE) throw new Error('invalid_embedding_output');

  const embedding = new Float32Array(output.slice(0, FACE_EMBEDDING_SIZE) as Float32Array);
  const norm = Math.sqrt(embedding.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) throw new Error('invalid_embedding_output');
  for (let index = 0; index < embedding.length; index += 1) embedding[index] /= norm;
  return embedding;
}

export function cosineSimilarity(first: Float32Array, second: Float32Array) {
  if (first.length !== second.length || first.length === 0) return 0;
  let dot = 0;
  let firstNorm = 0;
  let secondNorm = 0;
  for (let index = 0; index < first.length; index += 1) {
    dot += first[index] * second[index];
    firstNorm += first[index] ** 2;
    secondNorm += second[index] ** 2;
  }
  return dot / (Math.sqrt(firstNorm) * Math.sqrt(secondNorm));
}