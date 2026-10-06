/**
 * On-device face pipeline (free, offline):
 *   photo → ML Kit face detection + landmarks → quality checks →
 *   5-point similarity alignment to 112×112 → SFace (ONNX) → 128-d embedding.
 *
 * Two sources share the model, alignment and normalization:
 *   'selfie'   — a live photo of the user.
 *   'document' — a photo of the user's driver's license; the portrait on the
 *                card is small, so it is analysed at a higher resolution.
 *
 * Validated against OpenCV's reference SFace implementation (cosine agreement
 * ≈0.98 on LFW). No image or embedding is ever logged.
 */
import { Asset } from 'expo-asset';
import { Paths } from 'expo-file-system';
import { NativeModules } from 'react-native';
import type { InferenceSession, Tensor } from 'onnxruntime-common';
import type { Image } from 'react-native-nitro-image';
import type { Face, ImageFaceDetector } from 'react-native-vision-camera-face-detector';

import {
  alignFace,
  checkFace,
  checkImageQuality,
  FaceCheckError,
  FaceSource,
  landmarkPoints,
  MESSAGES,
  normalizeEmbedding,
  Pixels,
  SIZE,
  WORKING_SIZE,
} from '@/services/faceCore';

export { FaceCheckError };
export type { FaceSource };

type NitroImages = typeof import('react-native-nitro-image')['Images'];
type Ort = { InferenceSession: typeof InferenceSession; Tensor: typeof Tensor };

// Metro bundles the model as an asset (see metro.config.js assetExts).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MODEL_ASSET = require('../../assets/models/sface_int8.onnx');

const UNAVAILABLE = new FaceCheckError(
  'model_unavailable',
  'El reconocimiento facial no está disponible en esta instalación. Instala la versión de desarrollo más reciente de ConVía.',
);

let natives: { images: NitroImages; detectors: Record<FaceSource, ImageFaceDetector>; ort: Ort } | null = null;
let sessionPromise: Promise<InferenceSession> | null = null;

/** Native modules are loaded lazily so a missing one never crashes the app at import time. */
function getNatives() {
  if (natives) return natives;
  // onnxruntime-react-native calls NativeModules.Onnxruntime.install() while it is
  // being imported, so check the native side first instead of letting that throw.
  if (!NativeModules.Onnxruntime) throw UNAVAILABLE;
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { Images } = require('react-native-nitro-image') as typeof import('react-native-nitro-image');
    const { createImageFaceDetector } = require('react-native-vision-camera-face-detector') as typeof import('react-native-vision-camera-face-detector');
    const ort = require('onnxruntime-react-native') as Ort;
    /* eslint-enable @typescript-eslint/no-require-imports */
    const detector = (minFaceSize: number) => createImageFaceDetector({
      performanceMode: 'accurate',
      runLandmarks: true,
      runClassifications: true,
      minFaceSize, // smallest face to look for, relative to the image width
    });
    natives = { images: Images, detectors: { selfie: detector(0.15), document: detector(0.03) }, ort };
    return natives;
  } catch {
    throw UNAVAILABLE;
  }
}

async function getSession(): Promise<InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const { ort } = getNatives();
      const asset = Asset.fromModule(MODEL_ASSET);
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      try {
        return await ort.InferenceSession.create(uri);
      } catch {
        // Some loaders reject file:// URIs; fall back to the raw bytes.
        const bytes = new Uint8Array(await (await fetch(uri)).arrayBuffer());
        return ort.InferenceSession.create(bytes);
      }
    })();
    sessionPromise.catch(() => {
      sessionPromise = null;
    });
  }
  try {
    return await sessionPromise;
  } catch {
    throw UNAVAILABLE;
  }
}

/** Loads the model ahead of time so the first verification is fast. */
export function preloadFaceModel() {
  void getSession().catch(() => undefined);
}

const toPath = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ''));
const toUri = (path: string) => (path.startsWith('file://') ? path : `file://${path}`);

async function detect(image: Image, source: FaceSource): Promise<{ faces: Face[]; path: string }> {
  const detector = getNatives().detectors[source];
  const path = await image.saveToTemporaryFileAsync('jpg', 92);
  return { faces: detector.detectFaces(toUri(path)), path };
}

/**
 * Finds the faces in the photo. If none are found the photo may be stored
 * sideways (EXIF orientation), so the other orientations are tried too.
 */
async function detectUpright(photo: Image, source: FaceSource, tempFiles: string[]) {
  let image = photo;
  for (const degrees of [0, 90, 270, 180]) {
    if (degrees) image = await photo.rotateAsync(degrees);
    const { faces, path } = await detect(image, source);
    tempFiles.push(path);
    if (faces.length) return { image, faces };
  }
  throw new FaceCheckError('no_face_detected', MESSAGES.noFace[source]);
}

async function readPixels(image: Image): Promise<Pixels> {
  const raw = await image.toRawPixelDataAsync();
  const format = raw.pixelFormat;
  if (format === 'unknown') throw new FaceCheckError('poor_image_quality', 'No se pudo leer la foto. Inténtalo de nuevo.');
  const bpp = format.length; // 'RGB'/'BGR' = 3 bytes, the rest 4
  const data = new Uint8Array(raw.buffer);
  return {
    data,
    width: raw.width,
    height: raw.height,
    stride: data.length / raw.height,
    r: format.indexOf('R'),
    g: format.indexOf('G'),
    b: format.indexOf('B'),
    bpp,
  };
}

async function embed(tensor: Float32Array) {
  const { ort } = getNatives();
  const session = await getSession();
  const input = new ort.Tensor('float32', tensor, [1, 3, SIZE, SIZE]);
  const output = await session.run({ [session.inputNames[0]]: input });
  return normalizeEmbedding(output[session.outputNames[0]]?.data as Float32Array | undefined, UNAVAILABLE);
}

/** Deletes temporary copies. Only files inside the app cache are touched, never a gallery original. */
async function deleteFiles(paths: string[]) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File } = require('expo-file-system') as typeof import('expo-file-system');
    const cacheDir = toPath(Paths.cache.uri).replace(/\/+$/, '');
    for (const path of paths) {
      try {
        if (!toPath(toUri(path)).startsWith(`${cacheDir}/`)) continue;
        const file = new File(toUri(path));
        if (file.exists) file.delete();
      } catch {
        // Temporary files are also cleared by the OS; never fail verification over cleanup.
      }
    }
  } catch {
    // expo-file-system unavailable: the OS cache cleanup will remove them.
  }
}

/**
 * Turns a selfie (or the portrait on a driver's license) into a normalized
 * 128-d face embedding, or throws a FaceCheckError with a user-facing Spanish
 * message. Deletes the photo (when it is an app cache copy) and every
 * intermediate file before returning.
 */
export async function computeFaceEmbedding(photoUri: string, source: FaceSource = 'selfie'): Promise<number[]> {
  const tempFiles = [photoUri];
  try {
    const { images } = getNatives();
    const original = await images.loadFromFileAsync(toPath(photoUri));
    const scale = Math.min(1, WORKING_SIZE[source] / Math.max(original.width, original.height));
    const working = scale < 1
      ? await original.resizeAsync(Math.round(original.width * scale), Math.round(original.height * scale))
      : original;

    const { image, faces } = await detectUpright(working, source, tempFiles);
    const face = checkFace(faces, image.width, source);
    const points = landmarkPoints(face, source);
    const tensor = alignFace(await readPixels(image), points);
    checkImageQuality(tensor, source);
    return await embed(tensor);
  } catch (error) {
    if (error instanceof FaceCheckError) throw error;
    // Only the error text is logged (never pixels or embeddings), and only in development.
    if (__DEV__) console.warn('[face] pipeline error:', error instanceof Error ? error.message : String(error));
    throw new FaceCheckError('model_unavailable', 'No se pudo procesar la foto en este teléfono. Inténtalo de nuevo.');
  } finally {
    await deleteFiles(tempFiles);
  }
}
