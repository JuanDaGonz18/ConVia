/**
 * On-device face pipeline (free, offline):
 *   photo → ML Kit face detection + landmarks → quality checks →
 *   5-point similarity alignment to 112×112 → SFace (ONNX Runtime, ORT format) → 128-d embedding.
 *
 * Two sources share the model, alignment and normalization:
 *   'selfie'   — a live photo of the user.
 *   'document' — a photo of the user's driver's license; the portrait on the
 *                card is small, so it is analysed at a higher resolution.
 *
 * Validated against OpenCV's reference SFace implementation (cosine agreement
 * ≈0.98 on LFW). No image or embedding is ever logged.
 */
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
import { downloadVerified } from '@/services/modelDownload';
import { regionsAroundFace, toBase64 } from '@/services/studentCard';

export { FaceCheckError };
export type { FaceSource };

type NitroImages = typeof import('react-native-nitro-image')['Images'];
type Ort = { InferenceSession: typeof InferenceSession; Tensor: typeof Tensor };

// The model (~10 MB) is not bundled in the APK: it is downloaded once, checked against
// its SHA-256 and kept in the app's documents folder. It is the ORT-format conversion of
// assets/models/sface_int8.onnx (the minimal Android runtime only reads ORT format; see
// scripts/ort-minimal). The web build keeps loading the .onnx file.
const MODEL = {
  url: 'https://github.com/JuanDaGonz18/ConVia/releases/download/models-v1/sface_int8.ort',
  sha256: '2c8eb28c3ed5d0a4b17384dd01655743c5c295948934a83f591a8bb8fcebc204',
};
const MODEL_DOWNLOAD_ATTEMPTS = 3;

const UNAVAILABLE = new FaceCheckError(
  'model_unavailable',
  'El reconocimiento facial no está disponible en esta instalación. Instala la versión de desarrollo más reciente de ConVía.',
);

const MODEL_OFFLINE = new FaceCheckError(
  'network_error',
  'Para verificar tu rostro, ConVía descarga una sola vez el modelo de reconocimiento (unos 10 MB). Conéctate a internet e inténtalo de nuevo.',
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

/** The cached model file; downloaded (with retries) and verified first when missing. */
async function modelFile() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Directory, File } = require('expo-file-system') as typeof import('expo-file-system');
  const dir = new Directory(Paths.document, 'models');
  const name = `sface_int8-${MODEL.sha256.slice(0, 16)}.ort`;
  const model = new File(dir, name);
  if (model.exists) return model;

  dir.create({ intermediates: true, idempotent: true });
  // Drop models left by older app versions.
  for (const entry of dir.list()) {
    if (entry instanceof File && entry.name !== name) {
      try {
        entry.delete();
      } catch {
        // Not worth failing over.
      }
    }
  }
  const partial = new File(dir, `${name}.download`);
  const ok = await downloadVerified(
    {
      download: async () => {
        await File.downloadFileAsync(MODEL.url, partial, { idempotent: true });
      },
      sha256: () => partial.digest('SHA-256'),
      commit: () => partial.moveSync(model),
      discard: () => {
        try {
          if (partial.exists) partial.delete();
        } catch {
          // Overwritten by the next download.
        }
      },
    },
    {
      expectedSha256: MODEL.sha256,
      attempts: MODEL_DOWNLOAD_ATTEMPTS,
      onError: (attempt, error) => {
        if (__DEV__) console.warn(`[face] model download attempt ${attempt} failed:`, error instanceof Error ? error.message : String(error));
      },
    },
  );
  if (!ok) throw MODEL_OFFLINE;
  return model;
}

async function getSession(): Promise<InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const { ort } = getNatives();
      const model = await modelFile();
      try {
        return await ort.InferenceSession.create(model.uri);
      } catch {
        // Some loaders reject file:// URIs; fall back to the raw bytes.
        try {
          return await ort.InferenceSession.create(await model.bytes());
        } catch (error) {
          // A file that verified but no longer loads: download it again next time.
          try {
            model.delete();
          } catch {
            // Ignore: the error below is what matters.
          }
          throw error;
        }
      }
    })();
    sessionPromise.catch(() => {
      sessionPromise = null;
    });
  }
  try {
    return await sessionPromise;
  } catch (error) {
    if (error instanceof FaceCheckError) throw error;
    throw UNAVAILABLE;
  }
}

/** Downloads (first time) and loads the model ahead of time so verification is fast. */
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

/** What leaves the phone for a student-card check: the face's embedding and crops without the face. */
export type StudentCardAnalysis =
  | { ok: true; embedding: number[]; crops: string[] }
  | { ok: false; reason: 'face_not_found' | 'several_faces' | 'face_unusable' | 'nothing_to_read' };

/** Longest side of each crop sent to the server (text stays legible, uploads stay small). */
const CARD_CROP_MAX_SIDE = 1024;

/**
 * Student card: finds the card's portrait once, computes its embedding (compared with the
 * user's selfie in the database, like the license) and cuts the card into crops AROUND the
 * face, from the same upright image the face was found in, so no face pixels are sent. Any
 * doubt (no face, several faces, unusable face, nothing readable around it) returns a reason
 * instead, and the check goes to manual review without sending the photo. Deletes the photo
 * (when it is an app cache copy) and every intermediate file.
 */
export async function analyzeStudentCard(photoUri: string): Promise<StudentCardAnalysis> {
  const tempFiles = [photoUri];
  try {
    const { images } = getNatives();
    const original = await images.loadFromFileAsync(toPath(photoUri));
    const scale = Math.min(1, WORKING_SIZE.document / Math.max(original.width, original.height));
    const working = scale < 1
      ? await original.resizeAsync(Math.round(original.width * scale), Math.round(original.height * scale))
      : original;

    let detected: { image: Image; faces: Face[] };
    try {
      detected = await detectUpright(working, 'document', tempFiles);
    } catch (error) {
      if (error instanceof FaceCheckError) return { ok: false, reason: 'face_not_found' };
      throw error;
    }
    const { image, faces } = detected;
    // A second face (e.g. a small security photo) can't be excluded reliably: manual review.
    if (faces.length !== 1) return { ok: false, reason: 'several_faces' };
    let face: Face;
    try {
      face = checkFace(faces, image.width, 'document');
    } catch {
      return { ok: false, reason: 'face_unusable' };
    }
    const regions = regionsAroundFace(face.bounds, image.width, image.height);
    if (!regions.length) return { ok: false, reason: 'nothing_to_read' };

    let embedding: number[];
    try {
      const tensor = alignFace(await readPixels(image), landmarkPoints(face, 'document'));
      checkImageQuality(tensor, 'document');
      embedding = await embed(tensor);
    } catch (error) {
      if (error === MODEL_OFFLINE) throw error;
      return { ok: false, reason: 'face_unusable' };
    }

    const crops: string[] = [];
    for (const region of regions) {
      const crop = await image.cropAsync(region.startX, region.startY, region.endX, region.endY);
      const shrink = Math.min(1, CARD_CROP_MAX_SIDE / Math.max(crop.width, crop.height));
      const sized = shrink < 1 ? await crop.resizeAsync(Math.round(crop.width * shrink), Math.round(crop.height * shrink)) : crop;
      const encoded = await sized.toEncodedImageDataAsync('jpg', 80);
      crops.push(toBase64(new Uint8Array(encoded.buffer)));
    }
    return { ok: true, embedding, crops };
  } catch (error) {
    if (error === MODEL_OFFLINE) throw error;
    if (__DEV__) console.warn('[face] student card error:', error instanceof Error ? error.message : String(error));
    throw new FaceCheckError('model_unavailable', 'No se pudo procesar la foto en este teléfono. Inténtalo de nuevo.');
  } finally {
    await deleteFiles(tempFiles);
  }
}

/** A document image to send whole (card without photo, cropped account screenshot): how many faces it shows, and its JPEG. */
export type DocumentImage = { faceCount: number; jpegBase64: string };

/**
 * Before a card without photo or an account screenshot is sent, the device makes sure no face is
 * in it (a Teams or Outlook profile picture, or a card that does have a photo): any face found
 * means the image is NOT sent and the user is asked to crop it or use the photo-card path.
 * Returns the image as JPEG (longest side 1600 px) for the upload.
 */
export async function inspectDocumentImage(photoUri: string): Promise<DocumentImage> {
  const tempFiles = [photoUri];
  try {
    const { images } = getNatives();
    const original = await images.loadFromFileAsync(toPath(photoUri));
    const scale = Math.min(1, WORKING_SIZE.document / Math.max(original.width, original.height));
    const working = scale < 1
      ? await original.resizeAsync(Math.round(original.width * scale), Math.round(original.height * scale))
      : original;
    let faceCount = 0;
    try {
      faceCount = (await detectUpright(working, 'document', tempFiles)).faces.length;
    } catch (error) {
      if (!(error instanceof FaceCheckError)) throw error;
    }
    const encoded = await working.toEncodedImageDataAsync('jpg', 85);
    return { faceCount, jpegBase64: toBase64(new Uint8Array(encoded.buffer)) };
  } catch (error) {
    if (__DEV__) console.warn('[face] document image error:', error instanceof Error ? error.message : String(error));
    throw new FaceCheckError('model_unavailable', 'No se pudo procesar la imagen en este teléfono. Inténtalo de nuevo.');
  } finally {
    await deleteFiles(tempFiles);
  }
}
