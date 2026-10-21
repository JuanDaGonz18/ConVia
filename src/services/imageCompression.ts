import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/** Longest side of the uploaded photo, by use. Enough for the screens that show them. */
export const PHOTO_MAX_SIDE = { avatar: 512, vehicle: 1280 } as const;

/**
 * Resizes (never enlarges) and re-encodes a picked photo as JPEG before it is
 * uploaded: a phone photo of several MB becomes a few hundred KB, which saves
 * Storage space and egress. `width`/`height` come from the image picker.
 */
export async function compressPhoto(
  photo: { uri: string; width?: number; height?: number },
  maxSide: number,
): Promise<{ uri: string; mimeType: 'image/jpeg' }> {
  const context = ImageManipulator.manipulate(photo.uri);
  const width = photo.width ?? 0;
  const height = photo.height ?? 0;
  if (Math.max(width, height) > maxSide || !width || !height) {
    context.resize(width >= height ? { width: maxSide } : { height: maxSide });
  }
  try {
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
    return { uri: saved.uri, mimeType: 'image/jpeg' };
  } finally {
    context.release();
  }
}
