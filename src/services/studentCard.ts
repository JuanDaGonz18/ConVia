/**
 * Student-card privacy, on the phone: the face never leaves it. The card goes whole, with every
 * face (plus a margin) painted over in gray on the device, so the text keeps its layout and can
 * be read in one piece. The face box comes from the same upright image that is painted, so no
 * coordinate mapping is involved. (Older app versions sent crops around the face instead:
 * regionsAroundFace / regionsAroundFaces, still accepted by the server.)
 *
 * Pure TypeScript (no React Native), unit-tested with Node.
 */

export type Box = { x: number; y: number; width: number; height: number };
/** A crop as start/end corners, the shape nitro-image's crop() takes. */
export type Region = { startX: number; startY: number; endX: number; endY: number; side: 'left' | 'right' | 'top' | 'bottom' };

/** Margin around the face box, as a share of the face's larger side (hair, ears, shoulders). */
export const FACE_MARGIN = 0.25;
/** A crop thinner than this share of the image can't hold a readable line of text. */
export const MIN_SIDE = 0.12;

/** The face box grown by the margin and clamped to the image. */
export function excludedBox(face: Box, width: number, height: number) {
  const margin = FACE_MARGIN * Math.max(face.width, face.height);
  return {
    x0: Math.max(0, Math.floor(face.x - margin)),
    y0: Math.max(0, Math.floor(face.y - margin)),
    x1: Math.min(width, Math.ceil(face.x + face.width + margin)),
    y1: Math.min(height, Math.ceil(face.y + face.height + margin)),
  };
}

/**
 * The parts of the image that don't touch the (grown) face box: full-height strips to its left
 * and right, and the column above and below it. Strips too thin to hold text are dropped.
 */
export function regionsAroundFace(face: Box, width: number, height: number): Region[] {
  const { x0, y0, x1, y1 } = excludedBox(face, width, height);
  const candidates: Region[] = [
    { side: 'left', startX: 0, startY: 0, endX: x0, endY: height },
    { side: 'right', startX: x1, startY: 0, endX: width, endY: height },
    { side: 'top', startX: x0, startY: 0, endX: x1, endY: y0 },
    { side: 'bottom', startX: x0, startY: y1, endX: x1, endY: height },
  ];
  return candidates.filter((region) => {
    const w = region.endX - region.startX;
    const h = region.endY - region.startY;
    return w >= MIN_SIDE * width && h >= MIN_SIDE * height;
  });
}

/**
 * Crops around SEVERAL faces (e.g. the main photo plus a small security "ghost" photo): starts from
 * the crops around the first face and cuts every other face box (plus its margin) out of them, so
 * no crop touches any face. With one face it gives exactly regionsAroundFace.
 */
export function regionsAroundFaces(faces: Box[], width: number, height: number): Region[] {
  if (!faces.length) return [];
  let regions = regionsAroundFace(faces[0], width, height);
  for (const face of faces.slice(1)) {
    const box = excludedBox(face, width, height);
    regions = regions.flatMap((region) => {
      if (!overlaps(region, box)) return [region];
      const pieces: Region[] = [
        { side: region.side, startX: region.startX, startY: region.startY, endX: Math.min(region.endX, box.x0), endY: region.endY },
        { side: region.side, startX: Math.max(region.startX, box.x1), startY: region.startY, endX: region.endX, endY: region.endY },
        { side: region.side, startX: Math.max(region.startX, box.x0), startY: region.startY, endX: Math.min(region.endX, box.x1), endY: Math.min(region.endY, box.y0) },
        { side: region.side, startX: Math.max(region.startX, box.x0), startY: Math.max(region.startY, box.y1), endX: Math.min(region.endX, box.x1), endY: region.endY },
      ];
      return pieces.filter((piece) => {
        const w = piece.endX - piece.startX;
        const h = piece.endY - piece.startY;
        return w >= MIN_SIDE * width && h >= MIN_SIDE * height;
      });
    });
  }
  return regions;
}

/** True when the two rectangles share any pixel. */
export function overlaps(region: Region, box: { x0: number; y0: number; x1: number; y1: number }) {
  return region.startX < box.x1 && region.endX > box.x0 && region.startY < box.y1 && region.endY > box.y0;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 of raw bytes (Hermes has no Buffer, and btoa needs a binary string). */
export function toBase64(bytes: Uint8Array) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? ALPHABET[n & 63] : '=';
  }
  return out;
}

/** Gray painted over the faces (opaque, neutral). */
export const MASK_GRAY = 0xbd;
/** Past this share of the image covered by faces there is too little card left to read. */
export const MAX_MASKED_SHARE = 0.7;

/** Every face box grown by its margin: what gets painted over. */
export function maskBoxes(faces: Box[], width: number, height: number) {
  return faces.map((face) => excludedBox(face, width, height));
}

/** Share of the image the boxes cover (overlaps counted once). */
export function coveredShare(boxes: { x0: number; y0: number; x1: number; y1: number }[], width: number, height: number) {
  if (!boxes.length || width <= 0 || height <= 0) return 0;
  // Exact union area on a coarse grid of the boxes' own edges.
  const xs = [...new Set(boxes.flatMap((b) => [b.x0, b.x1]))].sort((a, b) => a - b);
  const ys = [...new Set(boxes.flatMap((b) => [b.y0, b.y1]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cy = (ys[j] + ys[j + 1]) / 2;
      if (boxes.some((b) => cx > b.x0 && cx < b.x1 && cy > b.y0 && cy < b.y1)) {
        area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
      }
    }
  }
  return area / (width * height);
}

/**
 * Paints the boxes gray in raw 4-byte pixels (any channel order: gray is the same in all of
 * them; the alpha or padding byte is set to 255). Rows may be padded: the stride is taken from
 * the buffer length.
 */
export function paintBoxes(
  pixels: Uint8Array,
  width: number,
  height: number,
  pixelFormat: string,
  boxes: { x0: number; y0: number; x1: number; y1: number }[],
) {
  const stride = Math.floor(pixels.length / height);
  if (stride < width * 4) throw new Error(`unsupported pixel buffer: ${pixels.length} bytes for ${width}x${height}`);
  const alphaFirst = /^[AX]/.test(pixelFormat);
  for (const box of boxes) {
    for (let y = Math.max(0, box.y0); y < Math.min(height, box.y1); y++) {
      const row = y * stride;
      for (let x = Math.max(0, box.x0); x < Math.min(width, box.x1); x++) {
        const i = row + x * 4;
        pixels[i] = alphaFirst ? 255 : MASK_GRAY;
        pixels[i + 1] = MASK_GRAY;
        pixels[i + 2] = MASK_GRAY;
        pixels[i + 3] = alphaFirst ? MASK_GRAY : 255;
      }
    }
  }
}
