/**
 * Platform-independent part of the face pipeline: quality checks, 5-point
 * alignment to 112×112 and image-quality gates. Shared by the native
 * (ML Kit + onnxruntime-react-native) and web (MediaPipe + onnxruntime-web)
 * implementations so both produce the same tensor for the same face.
 */
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

export type FaceSource = 'selfie' | 'document';

/** The subset of a detected face the checks need (matches ML Kit's Face). */
export type FaceLike = {
  bounds: { width: number };
  yawAngle: number;
  pitchAngle: number;
  leftEyeOpenProbability?: number;
  rightEyeOpenProbability?: number;
  landmarks?: Partial<Record<'LEFT_EYE' | 'RIGHT_EYE' | 'NOSE_BASE' | 'MOUTH_LEFT' | 'MOUTH_RIGHT', { x: number; y: number }>>;
};

export const SIZE = 112;
export const EMBEDDING_SIZE = 128;
/** Longest side the photo is scaled to before detection. */
export const WORKING_SIZE: Record<FaceSource, number> = { selfie: 720, document: 1600 };
// Standard ArcFace/SFace 112×112 landmark template (image-left eye first).
const TEMPLATE: [number, number][] = [
  [38.2946, 51.6963], // left eye
  [73.5318, 51.5014], // right eye
  [56.0252, 71.7366], // nose
  [41.5493, 92.3655], // left mouth corner
  [70.7299, 92.2041], // right mouth corner
];
// Calibrated on sharp vs blurred/darkened test photos (sharp ≥ 51, blurred ≤ 8).
export const MIN_SHARPNESS = 20;
export const MIN_BRIGHTNESS = 45;
export const MAX_BRIGHTNESS = 215;
export const MIN_FACE_WIDTH_RATIO = 0.25;
export const MAX_ANGLE = 20;
// License portraits measured 140–156 px wide at 1600 px (8–10 % of the photo);
// a selfie is ~40 %. Below 90 px the face has too little detail to compare.
export const MIN_DOCUMENT_FACE_PX = 90;
export const MAX_DOCUMENT_FACE_RATIO = 0.3;
// Share of blown-out pixels on the face; glare across the portrait measured 9 %.
export const MAX_GLARE = 0.05;

export const MESSAGES = {
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

export function checkFace<F extends FaceLike>(faces: F[], imageWidth: number, source: FaceSource): F {
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
export function landmarkPoints(face: FaceLike, source: FaceSource): [number, number][] {
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

export type Pixels = { data: Uint8Array; width: number; height: number; stride: number; r: number; g: number; b: number; bpp: number };

/** Warps the face into a 112×112 RGB tensor (CHW, 0–255) with bilinear sampling. */
export function alignFace(pixels: Pixels, points: [number, number][]) {
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
export function checkImageQuality(tensor: Float32Array, source: FaceSource) {
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

/** L2-normalizes the model output into the 128-d embedding sent to the server. */
export function normalizeEmbedding(values: ArrayLike<number> | undefined, unavailable: Error): number[] {
  if (!values || values.length < EMBEDDING_SIZE) throw unavailable;
  const embedding = Array.from(values).slice(0, EMBEDDING_SIZE);
  const norm = Math.sqrt(embedding.reduce((total, value) => total + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) throw new FaceCheckError('poor_image_quality', 'No se pudo analizar tu rostro. Inténtalo de nuevo.');
  return embedding.map((value) => value / norm);
}
