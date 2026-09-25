export type FaceObservation = {
  bounds: { x: number; y: number; width: number; height: number };
  leftEyeOpenProbability?: number;
  rightEyeOpenProbability?: number;
  yawAngle?: number;
  pitchAngle?: number;
};

const EYE_OPEN_THRESHOLD = 0.65;
const EYE_CLOSED_THRESHOLD = 0.25;
const MIN_MOVEMENT = 5;

export type LivenessSnapshot = {
  blinkDetected: boolean;
  movementDetected: boolean;
  confidence: number;
};

export function createLivenessTracker() {
  let wasEyesOpen = false;
  let previousCenter: { x: number; y: number } | null = null;
  let blinkDetected = false;
  let movementDetected = false;

  return {
    observe(face: FaceObservation): LivenessSnapshot {
      const left = face.leftEyeOpenProbability;
      const right = face.rightEyeOpenProbability;
      const eyesOpen = left !== undefined && right !== undefined && left >= EYE_OPEN_THRESHOLD && right >= EYE_OPEN_THRESHOLD;
      const eyesClosed = left !== undefined && right !== undefined && left <= EYE_CLOSED_THRESHOLD && right <= EYE_CLOSED_THRESHOLD;
      if (eyesClosed) wasEyesOpen = true;
      if (wasEyesOpen && eyesOpen) blinkDetected = true;

      const center = { x: face.bounds.x + face.bounds.width / 2, y: face.bounds.y + face.bounds.height / 2 };
      if (previousCenter) {
        const distance = Math.hypot(center.x - previousCenter.x, center.y - previousCenter.y);
        if (distance >= MIN_MOVEMENT || Math.abs(face.yawAngle ?? 0) >= 8 || Math.abs(face.pitchAngle ?? 0) >= 8) movementDetected = true;
      }
      previousCenter = center;
      const checks = [blinkDetected, movementDetected];
      return { blinkDetected, movementDetected, confidence: checks.filter(Boolean).length / checks.length };
    },
    hasPassed() {
      return blinkDetected && movementDetected;
    },
    reset() {
      wasEyesOpen = false;
      previousCenter = null;
      blinkDetected = false;
      movementDetected = false;
    },
  };
}