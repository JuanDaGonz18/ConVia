import { useFrameOutput } from 'react-native-vision-camera';
import { useFaceDetector } from 'react-native-vision-camera-face-detector';
import { runOnJS } from 'react-native-worklets';

import { FaceObservation } from '@/services/livenessService';

type FaceProcessorCallbacks = {
  onFrame: (faces: FaceObservation[], rgb: Uint8Array) => void;
};

export function useFaceProcessor({ onFrame: onFrameCallback }: FaceProcessorCallbacks) {
  const detector = useFaceDetector({
    cameraFacing: 'front',
    performanceMode: 'fast',
    runClassifications: true,
    runLandmarks: true,
    trackingEnabled: true,
  });

  return useFrameOutput({
    targetResolution: { width: 480, height: 480 },
    pixelFormat: 'yuv',  // Back to yuv—supports more devices
    dropFramesWhileBusy: true,
    onFrame(frame) {
      'worklet';

      const faces = detector.detectFaces(frame) as FaceObservation[];
      // YUV doesn't have toRGBBuffer; pass empty for now or handle conversion
      const rgb = new Uint8Array(480 * 480 * 3);

      runOnJS(onFrameCallback)(faces, rgb);
      frame.dispose();
    },
  });
}