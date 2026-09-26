import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { preloadFaceModel } from '@/services/faceRecognition';
import { faceVerificationService } from '@/services/faceVerificationService';
import { useAppStore } from '@/store/appStore';
import {
  FaceVerificationFailureReason,
  FaceVerificationResult,
  FaceVerificationState,
  FaceVerificationTrigger,
} from '@/types';

export type FaceVerificationModalProps = Readonly<{
  visible: boolean;
  trigger: FaceVerificationTrigger;
  userId: string;
  onSuccess: (result: FaceVerificationResult) => void;
  onFailure: (reason: FaceVerificationFailureReason) => void;
  onClose: () => void;
}>;

const INITIAL_MESSAGE = 'Centra tu rostro, mira de frente y mantén una expresión neutral.';

const TITLES: Record<FaceVerificationTrigger, string> = {
  register: 'Registra tu rostro',
  trip_request: 'Confirma tu identidad para pedir el cupo',
  driver_activate: 'Confirma tu identidad para aceptar al pasajero',
  driver_identity: 'Confirma que eres la persona de tu licencia',
};

/**
 * Captures a selfie with expo-camera and verifies it on the device
 * (ML Kit + SFace); only the face embedding is sent to Supabase.
 */
export function FaceVerificationModal({ visible, trigger, userId, onSuccess, onFailure, onClose }: FaceVerificationModalProps) {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [state, setState] = useState<FaceVerificationState>('IDLE');
  const [message, setMessage] = useState(INITIAL_MESSAGE);
  const [processing, setProcessing] = useState(false);
  const setFaceVerificationState = useAppStore((store) => store.setFaceVerificationState);

  useEffect(() => setFaceVerificationState(state), [setFaceVerificationState, state]);

  useEffect(() => {
    if (!visible) return;
    // Load the model while the user frames the photo so verification is quick.
    preloadFaceModel();
    const timer = setTimeout(() => {
      setCameraReady(false);
      setProcessing(false);
      setState(permission?.granted ? 'FACE_DETECTED' : 'CAMERA_PERMISSION');
      setMessage(INITIAL_MESSAGE);
    }, 0);
    return () => clearTimeout(timer);
  }, [permission?.granted, visible]);

  const fail = (reason: FaceVerificationFailureReason, text: string) => {
    setProcessing(false);
    setState('FAILED');
    setMessage(text);
    onFailure(reason);
  };

  const retry = () => {
    setState('RETRY');
    setMessage(INITIAL_MESSAGE);
  };

  const capture = async () => {
    if (!cameraRef.current || !cameraReady || processing) return;
    setProcessing(true);
    setState('CAPTURING');
    setMessage('Capturando...');
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: false, quality: 0.85, exif: false });
      if (!photo?.uri) throw new Error('No se pudo capturar la foto.');
      setState('PROCESSING');
      setMessage('Analizando tu rostro en el teléfono...');
      const result = await faceVerificationService.verifyPhoto(userId, photo.uri, trigger);
      if (result.status !== 'verified') {
        fail(result.failureReason ?? 'face_mismatch', result.message ?? 'No pudimos verificar tu identidad. Busca buena luz e inténtalo de nuevo.');
        return;
      }
      setProcessing(false);
      setState('SUCCESS');
      setMessage(result.message ?? 'Verificación completada.');
      onSuccess(result);
    } catch (error) {
      fail('storage_error', error instanceof Error ? error.message : 'No se pudo completar la verificación.');
    }
  };

  const canCapture = state !== 'SUCCESS' && state !== 'FAILED';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.root}>
        {state === 'CAMERA_PERMISSION' ? (
          <View style={styles.centered}>
            <Text style={styles.title}>Necesitamos acceso a la cámara</Text>
            {permission && !permission.canAskAgain ? (
              <Text style={styles.body}>Activa el permiso de cámara para WheelsApp desde los ajustes del teléfono.</Text>
            ) : (
              <Pressable onPress={() => void requestPermission()} style={styles.primaryButton}><Text style={styles.primaryText}>Permitir cámara</Text></Pressable>
            )}
            <Pressable onPress={onClose} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancelar</Text></Pressable>
          </View>
        ) : (
          <>
            <CameraView facing="front" mode="picture" onCameraReady={() => setCameraReady(true)} ref={cameraRef} style={StyleSheet.absoluteFill} />
            <View style={styles.overlay}>
              <Pressable accessibilityLabel="Cerrar verificación facial" onPress={onClose} style={styles.close}><Text style={styles.closeText}>✕</Text></Pressable>
              <View style={styles.textBlock}>
                <Text style={styles.overlayTitle}>{TITLES[trigger]}</Text>
                <Text style={styles.instruction}>{message}</Text>
              </View>
              {processing ? <ActivityIndicator color={colors.white} size="large" /> : null}
              {canCapture ? (
                <Pressable accessibilityLabel="Capturar selfie" disabled={!cameraReady || processing} onPress={() => void capture()} style={styles.shutter}>
                  <View style={styles.shutterInner} />
                </Pressable>
              ) : null}
              {state === 'FAILED' ? (
                <View style={styles.actions}>
                  <Pressable onPress={retry} style={styles.primaryButton}><Text style={styles.primaryText}>Reintentar</Text></Pressable>
                  <Pressable onPress={onClose} style={styles.secondaryButton}><Text style={styles.closeText}>Cerrar</Text></Pressable>
                </View>
              ) : null}
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.text, flex: 1 },
  centered: { alignItems: 'center', backgroundColor: colors.background, flex: 1, gap: spacing[16], justifyContent: 'center', padding: spacing[24] },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  body: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  primaryButton: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 12, padding: spacing[16], width: '100%' },
  primaryText: { color: colors.white, fontWeight: '700' },
  secondaryButton: { alignItems: 'center', padding: spacing[12] },
  secondaryText: { color: colors.textSecondary },
  overlay: { alignItems: 'center', flex: 1, justifyContent: 'space-between', padding: spacing[24], paddingTop: 64 },
  close: { alignSelf: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 20, padding: spacing[8] },
  closeText: { color: colors.white, fontSize: 20 },
  textBlock: { alignItems: 'center', gap: spacing[8] },
  overlayTitle: { backgroundColor: 'rgba(0,0,0,0.5)', color: colors.white, fontSize: 18, fontWeight: '700', padding: spacing[8], textAlign: 'center' },
  instruction: { backgroundColor: 'rgba(0,0,0,0.5)', color: colors.white, padding: spacing[12], textAlign: 'center' },
  actions: { gap: spacing[8], marginBottom: spacing[24], width: '100%' },
  shutter: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.primary, borderRadius: 40, borderWidth: 4, height: 80, justifyContent: 'center', marginBottom: spacing[24], width: 80 },
  shutterInner: { backgroundColor: colors.primary, borderRadius: 28, height: 56, width: 56 },
});
