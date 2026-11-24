import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { excludedBox, overlaps, regionsAroundFace, regionsAroundFaces, toBase64 } from './studentCard.ts';

describe('crops around the face', () => {
  test('a typical card (photo on the left) gives text on the right and around it', () => {
    const face = { x: 60, y: 120, width: 220, height: 280 };
    const regions = regionsAroundFace(face, 1600, 1000);
    assert.ok(regions.some((region) => region.side === 'right'));
    assert.ok(regions.every((region) => region.endX > region.startX && region.endY > region.startY));
  });

  test('no crop ever overlaps the face box plus its margin, wherever the face is', () => {
    const sizes = [[1600, 1000], [1000, 1600], [800, 800]];
    for (const [width, height] of sizes) {
      for (let x = 0; x < width; x += width / 8) {
        for (let y = 0; y < height; y += height / 8) {
          for (const side of [80, 200, 400]) {
            const face = { x, y, width: Math.min(side, width - x), height: Math.min(side * 1.25, height - y) };
            const box = excludedBox(face, width, height);
            for (const region of regionsAroundFace(face, width, height)) {
              assert.ok(!overlaps(region, box), JSON.stringify({ width, height, face, region }));
              assert.ok(region.startX >= 0 && region.startY >= 0 && region.endX <= width && region.endY <= height);
            }
          }
        }
      }
    }
  });

  test('the face itself is never inside a crop', () => {
    const face = { x: 700, y: 300, width: 200, height: 260 };
    for (const region of regionsAroundFace(face, 1600, 1000)) {
      assert.ok(!overlaps(region, { x0: face.x, y0: face.y, x1: face.x + face.width, y1: face.y + face.height }));
    }
  });

  test('a face filling the photo leaves nothing to send', () => {
    assert.deepEqual(regionsAroundFace({ x: 50, y: 50, width: 900, height: 900 }, 1000, 1000), []);
  });
});

describe('toBase64', () => {
  test('matches the standard encoding, with padding', () => {
    for (const text of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar', 'ConVía ✨']) {
      const bytes = new TextEncoder().encode(text);
      assert.equal(toBase64(bytes), Buffer.from(bytes).toString('base64'), text);
    }
  });
});

describe('crops around several faces', () => {
  test('with one face it is the same as regionsAroundFace', () => {
    const face = { x: 150, y: 300, width: 350, height: 450 };
    assert.deepEqual(regionsAroundFaces([face], 1600, 1000), regionsAroundFace(face, 1600, 1000));
  });

  test('no crop touches any face (main photo + small ghost photo)', () => {
    const main = { x: 150, y: 300, width: 350, height: 450 };
    const ghost = { x: 1250, y: 650, width: 150, height: 190 };
    const regions = regionsAroundFaces([main, ghost], 1600, 1000);
    assert.ok(regions.length > 0);
    for (const face of [main, ghost]) {
      const box = excludedBox(face, 1600, 1000);
      for (const region of regions) assert.equal(overlaps(region, box), false);
    }
  });
});

describe('painting the faces over', () => {
  test('paints every pixel of the box gray and nothing outside it (RGBA and ARGB)', async () => {
    const { paintBoxes, MASK_GRAY } = await import('./studentCard.ts');
    for (const format of ['RGBA', 'ARGB']) {
      const w = 10;
      const h = 6;
      const pixels = new Uint8Array(w * h * 4).fill(7);
      paintBoxes(pixels, w, h, format, [{ x0: 2, y0: 1, x1: 5, y1: 4 }]);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const inside = x >= 2 && x < 5 && y >= 1 && y < 4;
          const px = [...pixels.slice(i, i + 4)];
          if (!inside) assert.deepEqual(px, [7, 7, 7, 7]);
          else if (format === 'RGBA') assert.deepEqual(px, [MASK_GRAY, MASK_GRAY, MASK_GRAY, 255]);
          else assert.deepEqual(px, [255, MASK_GRAY, MASK_GRAY, MASK_GRAY]);
        }
      }
    }
  });

  test('handles padded rows', async () => {
    const { paintBoxes, MASK_GRAY } = await import('./studentCard.ts');
    const w = 3;
    const h = 2;
    const stride = 16; // 12 bytes of pixels + 4 of padding
    const pixels = new Uint8Array(stride * h);
    paintBoxes(pixels, w, h, 'RGBA', [{ x0: 0, y0: 1, x1: 3, y1: 2 }]);
    assert.equal(pixels[stride], MASK_GRAY);
    assert.equal(pixels[stride + 11], 255);
    assert.equal(pixels[stride + 12], 0);
    assert.equal(pixels[0], 0);
  });

  test('covered share counts overlaps once', async () => {
    const { coveredShare } = await import('./studentCard.ts');
    assert.equal(coveredShare([{ x0: 0, y0: 0, x1: 50, y1: 100 }], 100, 100), 0.5);
    assert.equal(coveredShare([{ x0: 0, y0: 0, x1: 50, y1: 100 }, { x0: 25, y0: 0, x1: 75, y1: 100 }], 100, 100), 0.75);
    assert.equal(coveredShare([], 100, 100), 0);
  });
});
