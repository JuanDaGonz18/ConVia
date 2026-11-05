/**
 * The verdict is decided here, by code, from what the models report. The
 * models only describe the photo (SAM: where the car and plate are; Muse
 * Spark: what the plate says, brand, color, quality). No Deno APIs, so it
 * can be unit-tested with Node.
 */
import { boxArea, type SamBox } from './sam.ts';

export type VerificationStatus = 'verified' | 'failed' | 'retry';

export type Detections = { cars: SamBox[]; plates: SamBox[] };

/** Muse Spark's structured answer (see VISION_SCHEMA in index.ts). */
export type VisionReport = {
  plate_text: string;
  plate_readable: boolean;
  brand: string;
  line: string;
  color: string;
  image_quality: 'good' | 'fair' | 'poor';
  looks_like_screen_or_printout: boolean;
  confidence: number;
};

export type Decision = {
  status: VerificationStatus;
  /** Stable code for logs and analytics. */
  reason: string;
  /** Shown to the driver, in Spanish. */
  message: string;
  plateRead: string | null;
  confidence: number | null;
  brandMatch: boolean | null;
  colorMatch: boolean | null;
};

/** SAM matches below this confidence are ignored. */
const MIN_DETECTION_CONFIDENCE = 0.4;
/** A second car counts only if it is at least this big relative to the main one (parked cars far behind are fine). */
const SECOND_CAR_RATIO = 0.35;
/** The main car must cover at least this share of the photo. */
const MIN_CAR_AREA = 0.12;
const MIN_READ_CONFIDENCE = 0.5;
/** A one-character difference read with less confidence than this is treated as a misread. */
const NEAR_MISS_CONFIDENCE = 0.85;

const CAR_PLATE = /^[A-Z]{3}\d{3}$/;

// Characters OCR commonly confuses, fixed by position (letters first, then digits).
const AS_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B', '6': 'G' };
const AS_DIGIT: Record<string, string> = { O: '0', Q: '0', D: '0', I: '1', L: '1', Z: '2', S: '5', B: '8', G: '6', T: '7' };

/** "abc-123", "ABC 123" → "ABC123". Same rule as the app's normalizePlate. */
export function normalizePlate(plate: string) {
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Normalizes a plate read from a photo and fixes O/0, I/1, S/5… by position (Colombian car: ABC123). */
export function normalizeReadPlate(plate: string) {
  const clean = normalizePlate(plate);
  if (clean.length !== 6) return clean;
  return [...clean].map((char, index) => (index < 3 ? AS_LETTER[char] ?? char : AS_DIGIT[char] ?? char)).join('');
}

export function isCarPlate(plate: string) {
  return CAR_PLATE.test(normalizePlate(plate));
}

function differences(a: string, b: string) {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let count = 0;
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) count++;
  return count;
}

function simplify(text: string) {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

const BRAND_ALIASES: Record<string, string> = {
  vw: 'volkswagen',
  chevy: 'chevrolet',
  mercedes: 'mercedes benz',
  'mercedes-benz': 'mercedes benz',
  benz: 'mercedes benz',
};

/** true/false when the read brand clearly is/isn't in the registered "marca y modelo"; null when unknown. */
export function brandMatches(registered: string, read: string): boolean | null {
  const readBrand = simplify(read);
  if (!readBrand || readBrand === 'desconocida' || readBrand === 'unknown') return null;
  const canonical = BRAND_ALIASES[readBrand] ?? readBrand;
  const registeredWords = simplify(registered).split(' ').map((word) => BRAND_ALIASES[word] ?? word).join(' ');
  if (!registeredWords) return null;
  return registeredWords.includes(canonical) || canonical.split(' ').some((word) => word.length > 2 && registeredWords.split(' ').includes(word));
}

const COLOR_FAMILIES: Record<string, string[]> = {
  blanco: ['blanco', 'blanca', 'white', 'perla', 'marfil'],
  negro: ['negro', 'negra', 'black'],
  gris: ['gris', 'plata', 'plateado', 'plateada', 'silver', 'gray', 'grey', 'grafito', 'titanio'],
  rojo: ['rojo', 'roja', 'red', 'vinotinto', 'granate', 'vino'],
  azul: ['azul', 'blue', 'turquesa'],
  verde: ['verde', 'green'],
  amarillo: ['amarillo', 'amarilla', 'yellow', 'dorado', 'dorada', 'gold'],
  naranja: ['naranja', 'orange', 'anaranjado'],
  cafe: ['cafe', 'marron', 'brown', 'beige', 'champana', 'arena'],
};

function colorFamily(color: string) {
  const words = simplify(color).split(' ');
  for (const [family, names] of Object.entries(COLOR_FAMILIES)) {
    if (words.some((word) => names.includes(word))) return family;
  }
  return null;
}

/** true/false when both colors are recognizable; null otherwise (e.g. "personalizado"). */
export function colorMatches(registered: string, read: string): boolean | null {
  const a = colorFamily(registered);
  const b = colorFamily(read);
  return a && b ? a === b : null;
}

function result(status: VerificationStatus, reason: string, message: string, extra: Partial<Decision> = {}): Decision {
  return { status, reason, message, plateRead: null, confidence: null, brandMatch: null, colorMatch: null, ...extra };
}

/** Step 2: is there exactly one car with a visible plate? null = continue. */
export function checkDetections({ cars, plates }: Detections): Decision | null {
  const confident = (box: SamBox) => box.confidence === null || box.confidence >= MIN_DETECTION_CONFIDENCE;
  const foundCars = cars.filter(confident).sort((a, b) => boxArea(b) - boxArea(a));
  if (!foundCars.length) {
    return result('retry', 'no_car', 'No encontramos un carro en la foto. Encuadra el carro completo y vuelve a intentarlo.');
  }
  const main = foundCars[0];
  if (foundCars.slice(1).some((car) => boxArea(car) >= boxArea(main) * SECOND_CAR_RATIO)) {
    return result('retry', 'multiple_cars', 'Hay más de un carro en la foto. Toma la foto solo a tu carro.');
  }
  if (boxArea(main) < MIN_CAR_AREA) {
    return result('retry', 'car_too_far', 'El carro se ve muy lejos. Acércate un poco, sin cortar el carro.');
  }
  // The plate has to belong to the main car: its center inside the car's box.
  const ownPlate = plates.filter(confident).some((plate) => {
    const cx = (plate.x1 + plate.x2) / 2;
    const cy = (plate.y1 + plate.y2) / 2;
    return cx >= main.x1 && cx <= main.x2 && cy >= main.y1 && cy <= main.y2;
  });
  if (!ownPlate) {
    return result('retry', 'no_plate', 'No se ve la placa. Toma la foto de frente o de atrás, con la placa visible.');
  }
  return null;
}

/** Steps 3–4: compares what Muse Spark read with the registered vehicle. */
export function decide(
  report: VisionReport,
  registered: { plate: string; brand: string; color: string },
): Decision {
  if (report.looks_like_screen_or_printout) {
    return result('retry', 'not_live_photo', 'Parece una foto de una pantalla o de una impresión. Toma la foto directamente al carro.');
  }
  if (report.image_quality === 'poor') {
    return result('retry', 'poor_quality', 'La foto quedó borrosa u oscura. Tómala de nuevo con buena luz y sin moverte.');
  }
  const plateRead = normalizeReadPlate(report.plate_text ?? '');
  const confidence = Math.min(1, Math.max(0, Number(report.confidence) || 0));
  if (!report.plate_readable || !CAR_PLATE.test(plateRead)) {
    return result('retry', 'plate_unreadable', 'No pudimos leer la placa completa. Acércate y asegúrate de que se vea entera y sin reflejos.', {
      plateRead: plateRead || null,
      confidence,
    });
  }
  if (confidence < MIN_READ_CONFIDENCE) {
    return result('retry', 'low_confidence', 'No estamos seguros de lo que leímos. Toma otra foto con la placa más cerca y bien iluminada.', {
      plateRead,
      confidence,
    });
  }

  const expected = normalizePlate(registered.plate);
  const brandMatch = brandMatches(registered.brand, report.brand);
  const colorMatch = colorMatches(registered.color, report.color);
  const extra = { plateRead, confidence, brandMatch, colorMatch };

  if (plateRead === expected) {
    // Brand and color are supporting signals: both clearly wrong means this plate is on another car.
    if (brandMatch === false && colorMatch === false) {
      return result('failed', 'vehicle_mismatch', 'La placa coincide, pero la marca y el color no corresponden al vehículo registrado. Revisa los datos del vehículo.', extra);
    }
    return result('verified', 'plate_match', '¡Listo! Verificamos que la placa de la foto coincide con la de tu vehículo.', extra);
  }
  if (differences(plateRead, expected) === 1 && confidence < NEAR_MISS_CONFIDENCE) {
    return result('retry', 'plate_uncertain', 'La placa casi coincide, pero no la leímos con claridad. Toma otra foto más cerca de la placa.', extra);
  }
  return result('failed', 'plate_mismatch', `La placa de la foto (${plateRead}) no coincide con la registrada (${expected}). Revisa la placa del vehículo o toma la foto a tu carro.`, extra);
}
