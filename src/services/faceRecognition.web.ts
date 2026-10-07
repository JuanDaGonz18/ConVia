/**
 * Web version of the face pipeline (used by the iPhone/browser build):
 *   photo → MediaPipe Face Landmarker → quality checks →
 *   5-point similarity alignment to 112×112 → SFace (onnxruntime-web) → 128-d embedding.
 *
 * Same model, alignment, checks and normalization as the native pipeline
 * (see faceCore.ts); only detection and inference differ. Everything runs in
 * the browser: the photo never leaves the device, only the embedding does.
 */
import { Asset } from 'expo-asset';
import type { InferenceSession } from 'onnxruntime-common';

import {
  alignFace,
  checkFace,
  checkImageQuality,
  FaceCheckError,
  FaceLike,
  FaceSource,
  landmarkPoints,
  MESSAGES,
  normalizeEmbedding,
  Pixels,
  SIZE,
  WORKING_SIZE,
} from '@/services/faceCore';
import { importUrl, loadScript } from '@/web/loadScript';

export { FaceCheckError };
export type { FaceSource };

// eslint-disable-next-line @typescript-eslint/no-require-imports
const MODEL_ASSET = require('../../assets/models/sface_int8.onnx');

const ORT_VERSION = '1.24.3';
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const MEDIAPIPE_VERSION = '0.10.21';
const MEDIAPIPE_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`;
const LANDMARKER_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// MediaPipe Face Mesh indices that match ML Kit's five landmarks.
const IRIS_A = 468;
const IRIS_B = 473;
const NOSE_TIP = 1;
const NOSE_BELOW = 2;
const MOUTH_A = 61;
const MOUTH_B = 291;

const UNAVAILABLE = new FaceCheckError(
  'model_unavailable',
  'No se pudo cargar el reconocimiento facial. Revisa tu conexión a internet e inténtalo de nuevo.',
);

type Point = { x: number; y: number };
type OrtWeb = {
  InferenceSession: { create(model: string | Uint8Array, options?: object): Promise<InferenceSession> };
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
  env: { wasm: { wasmPaths?: string; numThreads?: number } };
};
type Landmark = { x: number; y: number; z: number };
type LandmarkerResult = {
  faceLandmarks: Landmark[][];
  faceBlendshapes?: { categories: { categoryName: string; score: number }[] }[];
  facialTransformationMatrixes?: { data: number[] }[];
};
type Landmarker = { detect(image: HTMLCanvasElement): LandmarkerResult };
type VisionModule = {
  FilesetResolver: { forVisionTasks(basePath: string): Promise<unknown> };
  FaceLandmarker: { createFromOptions(fileset: unknown, options: object): Promise<Landmarker> };
};

let sessionPromise: Promise<{ ort: OrtWeb; session: InferenceSession }> | null = null;
let landmarkerPromise: Promise<Landmarker> | null = null;

function retryable<T>(factory: () => Promise<T>, reset: () => void): Promise<T> {
  const promise = factory();
  promise.catch(reset);
  return promise;
}

function getSession() {
  if (!sessionPromise) {
    sessionPromise = retryable(async () => {
      await loadScript(`${ORT_BASE}ort.min.js`);
      const ort = (window as unknown as { ort?: OrtWeb }).ort;
      if (!ort) throw UNAVAILABLE;
      ort.env.wasm.wasmPaths = ORT_BASE;
      ort.env.wasm.numThreads = 1; // GitHub Pages can't send the headers multithreading needs.
      const asset = Asset.fromModule(MODEL_ASSET);
      const bytes = new Uint8Array(await (await fetch(asset.uri)).arrayBuffer());
      const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
      return { ort, session };
    }, () => { sessionPromise = null; });
  }
  return sessionPromise;
}

function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = retryable(async () => {
      const vision = await importUrl<VisionModule>(`${MEDIAPIPE_BASE}/vision_bundle.mjs`);
      const fileset = await vision.FilesetResolver.forVisionTasks(`${MEDIAPIPE_BASE}/wasm`);
      return vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: LANDMARKER_MODEL, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numFaces: 2,
        minFaceDetectionConfidence: 0.5,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
    }, () => { landmarkerPromise = null; });
  }
  return landmarkerPromise;
}

/** Loads the models ahead of time so the first verification is fast. */
export function preloadFaceModel() {
  void getSession().catch(() => undefined);
  void getLandmarker().catch(() => undefined);
}

function loadImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new FaceCheckError('poor_image_quality', 'No se pudo leer la foto. Inténtalo de nuevo.'));
    image.src = uri;
  });
}

function canvas(width: number, height: number) {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  const context = element.getContext('2d', { willReadFrequently: true });
  if (!context) throw UNAVAILABLE;
  return { element, context };
}

/** The photo scaled to the working size and rotated by `degrees`. */
function draw(image: HTMLImageElement, source: FaceSource, degrees: number) {
  const scale = Math.min(1, WORKING_SIZE[source] / Math.max(image.naturalWidth, image.naturalHeight));
  const w = Math.round(image.naturalWidth * scale);
  const h = Math.round(image.naturalHeight * scale);
  const sideways = degrees === 90 || degrees === 270;
  const { element, context } = canvas(sideways ? h : w, sideways ? w : h);
  context.translate(element.width / 2, element.height / 2);
  context.rotate((degrees * Math.PI) / 180);
  context.drawImage(image, -w / 2, -h / 2, w, h);
  return element;
}

const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/** Converts a MediaPipe face (normalized to `region`) into the ML Kit shape the checks expect. */
function toFace(result: LandmarkerResult, index: number, region: { x: number; y: number; w: number; h: number }): FaceLike {
  const mesh = result.faceLandmarks[index];
  const at = (i: number): Point => ({ x: region.x + mesh[i].x * region.w, y: region.y + mesh[i].y * region.h });
  const xs = mesh.map((point) => region.x + point.x * region.w);
  const nose = at(NOSE_TIP);
  const below = at(NOSE_BELOW);

  // Head pose from the 4×4 (column-major) facial transformation matrix.
  const m = result.facialTransformationMatrixes?.[index]?.data;
  const yawAngle = m ? toDegrees(Math.asin(Math.max(-1, Math.min(1, -m[2])))) : 0;
  const pitchAngle = m ? toDegrees(Math.atan2(m[6], m[10])) : 0;

  const blink = (name: string) => result.faceBlendshapes?.[index]?.categories.find((c) => c.categoryName === name)?.score;
  const leftBlink = blink('eyeBlinkLeft');
  const rightBlink = blink('eyeBlinkRight');

  return {
    bounds: { width: Math.max(...xs) - Math.min(...xs) },
    yawAngle,
    pitchAngle,
    leftEyeOpenProbability: leftBlink === undefined ? undefined : 1 - leftBlink,
    rightEyeOpenProbability: rightBlink === undefined ? undefined : 1 - rightBlink,
    landmarks: {
      LEFT_EYE: at(IRIS_A),
      RIGHT_EYE: at(IRIS_B),
      NOSE_BASE: { x: (nose.x + below.x) / 2, y: (nose.y + below.y) / 2 },
      MOUTH_LEFT: at(MOUTH_A),
      MOUTH_RIGHT: at(MOUTH_B),
    },
  };
}

function detectIn(landmarker: Landmarker, image: HTMLCanvasElement, region = { x: 0, y: 0, w: image.width, h: image.height }) {
  const result = landmarker.detect(image);
  return result.faceLandmarks.map((_, index) => toFace(result, index, region));
}

/**
 * A license portrait is ~10 % of the photo, too small for MediaPipe's
 * detector at full frame, so the photo is also scanned in overlapping tiles.
 */
function detectInTiles(landmarker: Landmarker, image: HTMLCanvasElement): FaceLike[] {
  const tile = Math.round(Math.min(image.width, image.height) * 0.5);
  const step = Math.round(tile / 2);
  const faces: FaceLike[] = [];
  const centers: Point[] = [];
  for (let y = 0; y + tile <= image.height + step - 1; y += step) {
    for (let x = 0; x + tile <= image.width + step - 1; x += step) {
      const tx = Math.min(x, image.width - tile);
      const ty = Math.min(y, image.height - tile);
      const { element, context } = canvas(tile, tile);
      context.drawImage(image, tx, ty, tile, tile, 0, 0, tile, tile);
      for (const face of detectIn(landmarker, element, { x: tx, y: ty, w: tile, h: tile })) {
        const eye = face.landmarks!.LEFT_EYE!;
        // Overlapping tiles see the same face more than once.
        if (centers.some((c) => Math.hypot(c.x - eye.x, c.y - eye.y) < face.bounds.width / 2)) continue;
        centers.push(eye);
        faces.push(face);
      }
    }
  }
  return faces;
}

async function detectUpright(photo: HTMLImageElement, source: FaceSource) {
  const landmarker = await getLandmarker().catch(() => { throw UNAVAILABLE; });
  for (const degrees of [0, 90, 270, 180]) {
    const image = draw(photo, source, degrees);
    let faces = detectIn(landmarker, image);
    if (!faces.length && source === 'document') faces = detectInTiles(landmarker, image);
    if (faces.length) return { image, faces };
  }
  throw new FaceCheckError('no_face_detected', MESSAGES.noFace[source]);
}

function readPixels(image: HTMLCanvasElement): Pixels {
  const context = image.getContext('2d', { willReadFrequently: true });
  if (!context) throw UNAVAILABLE;
  const { data, width, height } = context.getImageData(0, 0, image.width, image.height);
  return { data: new Uint8Array(data.buffer), width, height, stride: width * 4, r: 0, g: 1, b: 2, bpp: 4 };
}

async function embed(tensor: Float32Array) {
  const { ort, session } = await getSession().catch(() => { throw UNAVAILABLE; });
  const input = new ort.Tensor('float32', tensor, [1, 3, SIZE, SIZE]);
  const output = await session.run({ [session.inputNames[0]]: input as never });
  return normalizeEmbedding(output[session.outputNames[0]]?.data as Float32Array | undefined, UNAVAILABLE);
}

/**
 * Turns a selfie (or the portrait on a driver's license) into a normalized
 * 128-d face embedding, or throws a FaceCheckError with a user-facing Spanish
 * message. The photo stays in the browser.
 */
export async function computeFaceEmbedding(photoUri: string, source: FaceSource = 'selfie'): Promise<number[]> {
  try {
    const photo = await loadImage(photoUri);
    const { image, faces } = await detectUpright(photo, source);
    const face = checkFace(faces, image.width, source);
    const points = landmarkPoints(face, source);
    const tensor = alignFace(readPixels(image), points);
    checkImageQuality(tensor, source);
    return await embed(tensor);
  } catch (error) {
    if (error instanceof FaceCheckError) throw error;
    if (__DEV__) console.warn('[face] pipeline error:', error instanceof Error ? error.message : String(error));
    throw new FaceCheckError('model_unavailable', 'No se pudo procesar la foto en este navegador. Inténtalo de nuevo.');
  }
}

// Lets the team check the browser pipeline on a sample photo from the console:
// open the web app with ?debug-face and run `await __conviaFace(url)`.
if (typeof window !== 'undefined' && window.location.search.includes('debug-face')) {
  (window as unknown as { __conviaFace?: typeof computeFaceEmbedding }).__conviaFace = computeFaceEmbedding;
}
