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

import { FaceVerificationFailureReason } from '@/types';

export class FaceCheckError extends Error {
  constructor(
    public readonly reason: FaceVerificationFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'FaceCheckError';
  }
}

type NitroImages = typeof import('react-native-nitro-image')['Images'];
type Ort = { InferenceSession: typeof InferenceSession; Tensor: typeof Tensor };

// Metro bundles the model as an asset (see metro.config.js assetExts).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MODEL_ASSET = require('../../assets/models/sface_int8.onnx');

export type FaceSource = 'selfie' | 'document';

const SIZE = 112;
const EMBEDDING_SIZE = 128;
/** Longest side the photo is scaled to before detection. */
const WORKING_SIZE: Record<FaceSource, number> = { selfie: 720, document: 1600 };
// Standard ArcFace/SFace 112×112 landmark template (image-left eye first).
const TEMPLATE: [number, number][] = [
  [38.2946, 51.6963], // left eye
  [73.5318, 51.5014], // right eye
  [56.0252, 71.7366], // nose
  [41.5493, 92.3655], // left mouth corner
  [70.7299, 92.2041], // right mouth corner
];
// Calibrated on sharp vs blurred/darkened test photos (sharp ≥ 51, blurred ≤ 8).
const MIN_SHARPNESS = 20;
const MIN_BRIGHTNESS = 45;
const MAX_BRIGHTNESS = 215;
const MIN_FACE_WIDTH_RATIO = 0.25;
const MAX_ANGLE = 20;
// License portraits measured 140–156 px wide at 1600 px (8–10 % of the photo);
// a selfie is ~40 %. Below 90 px the face has too little detail to compare.
const MIN_DOCUMENT_FACE_PX = 90;
const MAX_DOCUMENT_FACE_RATIO = 0.3;
// Share of blown-out pixels on the face; glare across the portrait measured 9 %.
const MAX_GLARE = 0.05;

const UNAVAILABLE = new FaceCheckError(
  'model_unavailable',
  'El reconocimiento facial no está disponible en esta instalación. Instala la versión de desarrollo más reciente de WheelsApp.',
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

const MESSAGES = {
  noFace: {
    selfie: 'No detectamos ningún rostro. Centra tu cara en la cámara con buena luz.',
    document: 'No encontramos el rostro en la foto de la licencia. Toma la licencia completa, plana, con buena luz y sin reflejos.',
  },
  multipleFaces: {
    selfie: 'Hay más de un rostro en la foto. Asegúrate de que solo aparezcas tú.',
    document: 'Hay más de un rostro en la foto. Fotografía solo tu licencia, sin otras personas ni documentos.',
  },
  notCentered: {
    selfie: 'Mira de frente a la cámara, sin girar la cabeza.',
    document: 'El rostro de la licencia se ve inclinado. Toma la foto de frente, con la licencia plana.',
  },
  eyes: {
    selfie: 'Mantén los ojos abiertos al tomar la foto.',
    document: 'No se ven bien los ojos en la foto de la licencia. Evita reflejos sobre la foto.',
  },
  landmarks: {
    selfie: 'No se ven bien tus ojos, nariz y boca. Quítate gafas oscuras o tapabocas.',
    document: 'No se distinguen bien los rasgos en la foto de la licencia. Toma una foto más nítida y cercana.',
  },
  dark: {
    selfie: 'Hay muy poca luz. Busca un lugar más iluminado.',
    document: 'La foto de la licencia está muy oscura. Tómala en un lugar bien iluminado.',
  },
  bright: {
    selfie: 'Hay demasiada luz sobre tu rostro. Evita la luz directa.',
    document: 'La foto de la licencia tiene demasiada luz. Evita la luz directa y los reflejos.',
  },
  blurry: {
    selfie: 'La foto salió borrosa. Quédate quieto al capturar.',
    document: 'La foto de la licencia salió borrosa. Apoya el teléfono y enfoca la licencia antes de capturar.',
  },
} satisfies Record<string, Record<FaceSource, string>>;

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

function checkFace(faces: Face[], imageWidth: number, source: FaceSource): Face {
  if (faces.length > 1) {
    throw new FaceCheckError('multiple_faces_detected', MESSAGES.multipleFaces[source]);
  }
  const face = faces[0];
  if (source === 'selfie' && face.bounds.width / imageWidth < MIN_FACE_WIDTH_RATIO) {
    throw new FaceCheckError('poor_image_quality', 'Tu rostro se ve muy pequeño. Acerca un poco más el teléfono.');
  }
  if (source === 'document') {
    // A license portrait is a small part of the card; a face filling the photo is a selfie.
    if (face.bounds.width / imageWidth > MAX_DOCUMENT_FACE_RATIO) {
      throw new FaceCheckError('not_a_document', 'Esta foto parece una selfie, no una licencia. Toma la foto a tu licencia de conducción completa.');
    }
    if (face.bounds.width < MIN_DOCUMENT_FACE_PX) {
      throw new FaceCheckError('poor_image_quality', 'La foto de tu licencia se ve muy pequeña o lejana. Acerca el teléfono para que la licencia ocupe casi toda la foto.');
    }
  }
  if (Math.abs(face.yawAngle) > MAX_ANGLE || Math.abs(face.pitchAngle) > MAX_ANGLE) {
    throw new FaceCheckError('face_not_centered', MESSAGES.notCentered[source]);
  }
  const eyes = [face.leftEyeOpenProbability, face.rightEyeOpenProbability];
  if (eyes.every((value) => value !== undefined && value < 0.3)) {
    throw new FaceCheckError('eyes_not_visible', MESSAGES.eyes[source]);
  }
  return face;
}

/** The five landmarks in template order (image-left first), or a quality error. */
function landmarkPoints(face: Face, source: FaceSource): [number, number][] {
  const l = face.landmarks;
  const required = [l?.LEFT_EYE, l?.RIGHT_EYE, l?.NOSE_BASE, l?.MOUTH_LEFT, l?.MOUTH_RIGHT];
  if (required.some((point) => !point)) {
    throw new FaceCheckError('poor_image_quality', MESSAGES.landmarks[source]);
  }
  const [eyeA, eyeB, nose, mouthA, mouthB] = required as { x: number; y: number }[];
  const [leftEye, rightEye] = eyeA.x <= eyeB.x ? [eyeA, eyeB] : [eyeB, eyeA];
  const [leftMouth, rightMouth] = mouthA.x <= mouthB.x ? [mouthA, mouthB] : [mouthB, mouthA];
  return [leftEye, rightEye, nose, leftMouth, rightMouth].map((point) => [point.x, point.y]);
}

/** Least-squares similarity transform (rotation + uniform scale + shift), src → template. */
function similarityTransform(src: [number, number][]) {
  const n = src.length;
  let msx = 0, msy = 0, mdx = 0, mdy = 0;
  for (let i = 0; i < n; i += 1) {
    msx += src[i][0]; msy += src[i][1]; mdx += TEMPLATE[i][0]; mdy += TEMPLATE[i][1];
  }
  msx /= n; msy /= n; mdx /= n; mdy /= n;
  let variance = 0, a = 0, b = 0;
  for (let i = 0; i < n; i += 1) {
    const sx = src[i][0] - msx, sy = src[i][1] - msy;
    const dx = TEMPLATE[i][0] - mdx, dy = TEMPLATE[i][1] - mdy;
    variance += sx * sx + sy * sy;
    a += sx * dx + sy * dy;
    b += sx * dy - sy * dx;
  }
  const cos = a / variance;
  const sin = b / variance;
  return { cos, sin, tx: mdx - (cos * msx - sin * msy), ty: mdy - (sin * msx + cos * msy) };
}

type Pixels = { data: Uint8Array; width: number; height: number; stride: number; r: number; g: number; b: number; bpp: number };

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

/** Warps the face into a 112×112 RGB tensor (CHW, 0–255) with bilinear sampling. */
function alignFace(pixels: Pixels, points: [number, number][]) {
  const { cos, sin, tx, ty } = similarityTransform(points);
  const det = cos * cos + sin * sin;
  const { data, width, height, stride, bpp } = pixels;
  const channels = [pixels.r, pixels.g, pixels.b];
  const plane = SIZE * SIZE;
  const tensor = new Float32Array(3 * plane);

  const sample = (x: number, y: number, offset: number) => {
    const cx = x < 0 ? 0 : x >= width ? width - 1 : x;
    const cy = y < 0 ? 0 : y >= height ? height - 1 : y;
    return data[cy * stride + cx * bpp + offset];
  };

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const dx = x - tx, dy = y - ty;
      const sx = (cos * dx + sin * dy) / det;
      const sy = (-sin * dx + cos * dy) / det;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;
      for (let c = 0; c < 3; c += 1) {
        const offset = channels[c];
        const top = sample(x0, y0, offset) * (1 - fx) + sample(x0 + 1, y0, offset) * fx;
        const bottom = sample(x0, y0 + 1, offset) * (1 - fx) + sample(x0 + 1, y0 + 1, offset) * fx;
        tensor[c * plane + y * SIZE + x] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return tensor;
}

/** Brightness, glare and sharpness (Laplacian variance) of the central face region. */
function checkImageQuality(tensor: Float32Array, source: FaceSource) {
  const plane = SIZE * SIZE;
  const gray = new Float32Array(plane);
  for (let i = 0; i < plane; i += 1) {
    gray[i] = 0.299 * tensor[i] + 0.587 * tensor[plane + i] + 0.114 * tensor[2 * plane + i];
  }
  let sum = 0, lapSum = 0, lapSq = 0, count = 0, lapCount = 0, blownOut = 0;
  for (let y = 16; y < 96; y += 1) {
    for (let x = 16; x < 96; x += 1) {
      sum += gray[y * SIZE + x];
      count += 1;
      if (gray[y * SIZE + x] >= 248) blownOut += 1;
      if (y > 16 && y < 95 && x > 16 && x < 95) {
        const i = y * SIZE + x;
        const lap = gray[i - SIZE] + gray[i + SIZE] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
        lapSum += lap;
        lapSq += lap * lap;
        lapCount += 1;
      }
    }
  }
  const brightness = sum / count;
  const mean = lapSum / lapCount;
  const sharpness = lapSq / lapCount - mean * mean;
  if (brightness < MIN_BRIGHTNESS) throw new FaceCheckError('poor_lighting', MESSAGES.dark[source]);
  if (brightness > MAX_BRIGHTNESS) throw new FaceCheckError('poor_lighting', MESSAGES.bright[source]);
  if (source === 'document' && blownOut / count > MAX_GLARE) {
    throw new FaceCheckError('poor_lighting', 'Hay reflejos sobre la foto de tu licencia. Inclínala un poco o evita la luz directa.');
  }
  if (sharpness < MIN_SHARPNESS) throw new FaceCheckError('poor_image_quality', MESSAGES.blurry[source]);
}

async function embed(tensor: Float32Array) {
  const { ort } = getNatives();
  const session = await getSession();
  const input = new ort.Tensor('float32', tensor, [1, 3, SIZE, SIZE]);
  const output = await session.run({ [session.inputNames[0]]: input });
  const values = output[session.outputNames[0]]?.data as Float32Array | undefined;
  if (!values || values.length < EMBEDDING_SIZE) throw UNAVAILABLE;
  const embedding = Array.from(values.slice(0, EMBEDDING_SIZE));
  const norm = Math.sqrt(embedding.reduce((total, value) => total + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) throw new FaceCheckError('poor_image_quality', 'No se pudo analizar tu rostro. Inténtalo de nuevo.');
  return embedding.map((value) => value / norm);
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
