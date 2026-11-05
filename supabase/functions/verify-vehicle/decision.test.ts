/**
 * verify-vehicle decision rules and SAM parsing.
 * Run with `npm run test:functions`.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { brandMatches, checkDetections, colorMatches, decide, normalizeReadPlate, type VisionReport } from './decision.ts';
import { parseSamBoxes, type SamBox } from './sam.ts';

const box = (x1: number, y1: number, x2: number, y2: number, confidence: number | null = 0.9): SamBox => ({ x1, y1, x2, y2, w: 1000, h: 800, confidence });
const CAR = box(100, 100, 900, 700);
const PLATE = box(400, 550, 600, 620);
const REGISTERED = { plate: 'ABC123', brand: 'Chevrolet Spark', color: 'Gris' };

function report(overrides: Partial<VisionReport> = {}): VisionReport {
  return {
    plate_text: 'ABC 123',
    plate_readable: true,
    brand: 'chevrolet',
    line: 'spark',
    color: 'plata',
    image_quality: 'good',
    looks_like_screen_or_printout: false,
    confidence: 0.92,
    ...overrides,
  };
}

describe('parseSamBoxes', () => {
  test('reads boxes from the documented format and skips masks', () => {
    const text = '<0f>0<|box;x1=353;y1=382;x2=453;y2=427;w=537;h=561|><|mask;x=0;y=0;data=46,101,~abc|>,1<|box;x1=260;y1=382;x2=340;y2=427;w=537;h=561;c=0.81|><|mask;x=0;y=0;c=0.81;data=46,81,~xyz|>';
    const boxes = parseSamBoxes(text);
    assert.equal(boxes.length, 2);
    assert.deepEqual(boxes[0], { x1: 353, y1: 382, x2: 453, y2: 427, w: 537, h: 561, confidence: null });
    assert.equal(boxes[1].confidence, 0.81);
  });

  test('zero matches is an empty string', () => {
    assert.deepEqual(parseSamBoxes(''), []);
  });

  test('ignores malformed boxes', () => {
    assert.deepEqual(parseSamBoxes('<0f>0<|box;x1=1;y1=2|>'), []);
  });
});

describe('checkDetections', () => {
  test('one car with its plate continues', () => {
    assert.equal(checkDetections({ cars: [CAR], plates: [PLATE] }), null);
  });

  test('no car, two cars, far car or no plate ask to retry', () => {
    assert.equal(checkDetections({ cars: [], plates: [PLATE] })?.reason, 'no_car');
    assert.equal(checkDetections({ cars: [CAR, box(50, 50, 700, 600)], plates: [PLATE] })?.reason, 'multiple_cars');
    assert.equal(checkDetections({ cars: [box(10, 10, 150, 120)], plates: [box(60, 90, 90, 100)] })?.reason, 'car_too_far');
    assert.equal(checkDetections({ cars: [CAR], plates: [] })?.reason, 'no_plate');
    assert.equal(checkDetections({ cars: [], plates: [] })?.status, 'retry');
  });

  test('a small parked car in the background is fine', () => {
    assert.equal(checkDetections({ cars: [CAR, box(920, 50, 990, 100)], plates: [PLATE] }), null);
  });

  test('a plate outside the main car does not count', () => {
    assert.equal(checkDetections({ cars: [CAR], plates: [box(920, 720, 990, 760)] })?.reason, 'no_plate');
  });

  test('low-confidence matches are ignored', () => {
    assert.equal(checkDetections({ cars: [CAR], plates: [box(400, 550, 600, 620, 0.1)] })?.reason, 'no_plate');
  });
});

describe('normalizeReadPlate', () => {
  test('removes spaces and hyphens and fixes OCR confusions by position', () => {
    assert.equal(normalizeReadPlate('abc-123'), 'ABC123');
    assert.equal(normalizeReadPlate('A8C 1Z3'), 'ABC123');
    assert.equal(normalizeReadPlate('0SO 5O1'), 'OSO501');
  });
});

describe('decide', () => {
  test('matching plate is verified', () => {
    const decision = decide(report(), REGISTERED);
    assert.equal(decision.status, 'verified');
    assert.equal(decision.plateRead, 'ABC123');
    assert.equal(decision.brandMatch, true);
    assert.equal(decision.colorMatch, true);
  });

  test('matching plate with unknown brand is still verified', () => {
    assert.equal(decide(report({ brand: 'desconocida', color: 'azul' }), REGISTERED).status, 'verified');
  });

  test('matching plate on a clearly different car fails', () => {
    assert.equal(decide(report({ brand: 'mazda', color: 'rojo' }), REGISTERED).reason, 'vehicle_mismatch');
  });

  test('different plate fails with both plates in the message', () => {
    const decision = decide(report({ plate_text: 'XYZ 987' }), REGISTERED);
    assert.equal(decision.status, 'failed');
    assert.match(decision.message, /XYZ987/);
    assert.match(decision.message, /ABC123/);
  });

  test('one wrong character read with low confidence asks to retry', () => {
    assert.equal(decide(report({ plate_text: 'ABC 128', confidence: 0.7 }), REGISTERED).reason, 'plate_uncertain');
    assert.equal(decide(report({ plate_text: 'ABC 128', confidence: 0.95 }), REGISTERED).reason, 'plate_mismatch');
  });

  test('unreadable plate, poor photo, screen photo or low confidence ask to retry', () => {
    assert.equal(decide(report({ plate_readable: false }), REGISTERED).reason, 'plate_unreadable');
    assert.equal(decide(report({ plate_text: 'AB 12' }), REGISTERED).reason, 'plate_unreadable');
    assert.equal(decide(report({ image_quality: 'poor' }), REGISTERED).reason, 'poor_quality');
    assert.equal(decide(report({ looks_like_screen_or_printout: true }), REGISTERED).reason, 'not_live_photo');
    assert.equal(decide(report({ confidence: 0.3 }), REGISTERED).reason, 'low_confidence');
  });
});

describe('supporting signals', () => {
  test('brands', () => {
    assert.equal(brandMatches('Chevrolet Spark GT', 'chevrolet'), true);
    assert.equal(brandMatches('VW Gol', 'volkswagen'), true);
    assert.equal(brandMatches('Renault Logan', 'mazda'), false);
    assert.equal(brandMatches('Renault Logan', 'desconocida'), null);
  });

  test('colors group shades', () => {
    assert.equal(colorMatches('Gris plata', 'plateado'), true);
    assert.equal(colorMatches('Blanco', 'negro'), false);
    assert.equal(colorMatches('Personalizado', 'rojo'), null);
  });
});
