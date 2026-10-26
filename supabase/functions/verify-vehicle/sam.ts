/**
 * Reads SAM 3.1 output for a single image. The model answers with one line of
 * special tokens, one box + one mask per match:
 *   <0f>0<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..[;c=..]|><|mask;...|>,1<|box;...|>...
 * Zero matches is an empty string. Only boxes are needed here, so masks are skipped.
 * https://dev.meta.ai/docs/sam/reading-segmentation
 */

export type SamBox = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Image size the coordinates refer to. */
  w: number;
  h: number;
  /** 0–1, present when the request sets metadata.include_confidence = "true". */
  confidence: number | null;
};

const BOX_TOKEN = /<\|box;([^|]*)\|>/g;

export function parseSamBoxes(text: string): SamBox[] {
  const boxes: SamBox[] = [];
  for (const match of text.matchAll(BOX_TOKEN)) {
    // Fields are parsed by key, not position.
    const fields = new Map<string, number>();
    for (const pair of match[1].split(';')) {
      const [key, value] = pair.split('=');
      if (key && value !== undefined && Number.isFinite(Number(value))) fields.set(key.trim(), Number(value));
    }
    const [x1, y1, x2, y2, w, h] = ['x1', 'y1', 'x2', 'y2', 'w', 'h'].map((key) => fields.get(key));
    if ([x1, y1, x2, y2, w, h].some((value) => value === undefined) || !w || !h) continue;
    boxes.push({ x1: x1!, y1: y1!, x2: x2!, y2: y2!, w: w!, h: h!, confidence: fields.get('c') ?? null });
  }
  return boxes;
}

/** Share of the image the box covers, 0–1. */
export function boxArea(box: SamBox) {
  return Math.max(0, box.x2 - box.x1) * Math.max(0, box.y2 - box.y1) / (box.w * box.h);
}
