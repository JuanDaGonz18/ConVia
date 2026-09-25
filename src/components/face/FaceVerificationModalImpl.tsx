import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { FaceCameraOverlay } from '@/components/face/FaceCameraOverlay';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { useFaceProcessor } from '@/hooks/useFaceProcessor';
import { faceVerificationService } from '@/services/faceVerificationService';
import { createLivenessTracker, FaceObservation } from '@/services/livenessService';
import { useAppStore } from '@/store/appStore';
import { FaceVerificationFailureReason, FaceVerificationResult, FaceVerificationState } from '@/types';
import { FaceVerificationModalProps } from './FaceVerificationModal';

const MAX_RETRIES = 3;

export function FaceVerificationModalImpl({ visible, trigger, userId, onSuccess, onFailure, onClose }: FaceVerificationModalProps) {
  const device = useCameraDevice('front');
  const { hasPermission, requestPermission } = useCameraPermission();
  const [state, setState] = useState<FaceVerificationState>('IDLE');
  const [message, setMessage] = useState<string>();
  const [retryCount, setRetryCount] = useState(0);
  const [livenessConfidence, setLivenessConfidence] = useState(0);
  const processingRef = useRef(false);
  const trackerRef = useRef(createLivenessTracker());
  const { setFaceVerificationState } = useAppStore();

  useEffect(() => setFaceVerificationState(state), [setFaceVerificationState, state]);

  useEffect(() => {
    if (!visible) return;
    processingRef.current = false;
    trackerRef.current.reset();
    // Reset the native verification session when the modal opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRetryCount(0);
    setMessage(undefined);
    setState(hasPermission ? 'DETECTING_FACE' : 'CAMERA_PERMISSION');
  }, [hasPermission, visible]);

  const fail = useCallback((reason: FaceVerificationFailureReason) => {
    const count = retryCount + 1;
    setRetryCount(count);
    processingRef.current = false;
    if (count >= MAX_RETRIES) {
      setState('BLOCKED');
      setMessage('Se han agotado los intentos. Intenta más tarde.');
      setTimeout(() => onFailure('too_many_attempts'), 1200);
      return;
    }
    setState('RETRY');
    setMessage(reason === 'face_mismatch' ? 'El rostro no coincide con el registrado.' : 'No pudimos verificarte. Inténtalo de nuevo.');
  }, [onFailure, retryCount]);

  const complete = useCallback(async (rgb: Uint8Array) => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      setState('CAPTURING');
      setMessage('Capturando muestra segura…');
      setState('GENERATING_EMBEDDING');
      let verification: FaceVerificationResult;
      if (trigger === 'register') {
        const result = await faceVerificationService.registerEmbedding(userId, rgb);
        verification = { verified: true, livenessPassed: true, faceMatched: true, similarity: 1, faceReferenceId: result.faceReferenceId, sessionId: result.faceReferenceId };
      } else {
        verification = await faceVerificationService.verifyEmbedding(userId, rgb);
      }
      if (!verification.verified) {
        fail('face_mismatch');
        return;
      }
      setState('SUCCESS');
      setMessage(__DEV__ ? `Verificación local completada (${verification.similarity.toFixed(3)})` : '¡Verificación exitosa!');
      setTimeout(() => onSuccess(verification), 900);
    } catch (error) {
      const reason: FaceVerificationFailureReason = (error as Error).message === 'embedding_unavailable' ? 'embedding_unavailable' : 'storage_error';
      fail(reason);
    }
  }, [fail, onSuccess, trigger, userId]);

  const handleFrame = useCallback((faces: FaceObservation[], rgb: Uint8Array) => {
    if (processingRef.current) return;
    if (faces.length === 0) {
      setState('DETECTING_FACE');
      setMessage('Centra tu rostro en el óvalo');
      return;
    }
    if (faces.length > 1) {
      setState('RETRY');
      setMessage('Solo puede haber un rostro en cámara.');
      return;
    }
    const snapshot = trackerRef.current.observe(faces[0]);
    setState(snapshot.blinkDetected || snapshot.movementDetected ? 'LIVENESS' : 'FACE_DETECTED');
    setLivenessConfidence(snapshot.confidence);
    if (trackerRef.current.hasPassed()) void complete(rgb);
  }, [complete]);

  const frameOutput = useFaceProcessor({ onFrame: handleFrame });
  const showCamera = visible && state !== 'CAMERA_PERMISSION' && state !== 'BLOCKED' && !!device;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.root}>
        {state === 'CAMERA_PERMISSION' && <PermissionScreen onAllow={requestPermission} onCancel={onClose} />}
        {showCamera && device && (
          <View style={StyleSheet.absoluteFill}>
            <Camera style={StyleSheet.absoluteFill} device={device} isActive={visible} outputs={[frameOutput]} />
            <FaceCameraOverlay state={state} message={message ?? (livenessConfidence > 0 ? `Confianza de liveness: ${Math.round(livenessConfidence * 100)}%` : undefined)} />
            {(state === 'CAPTURING' || state === 'GENERATING_EMBEDDING') && <View style={styles.processingBadge}><ActivityIndicator color={colors.white} /><Text style={styles.processingText}>{message}</Text></View>}
            {state === 'RETRY' && <View style={styles.retryContainer}><Text style={styles.retryMessage}>{message}</Text><Pressable style={styles.retryBtn} onPress={() => { trackerRef.current.reset(); setState('DETECTING_FACE'); }}><Text style={styles.retryBtnText}>Reintentar</Text></Pressable></View>}
            <Pressable style={styles.closeBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Cerrar verificación facial"><Text style={styles.closeBtnText}>✕</Text></Pressable>
          </View>
        )}
        {state === 'BLOCKED' && <PermissionScreen onAllow={onClose} onCancel={onClose} title="Verificación temporalmente bloqueada" buttonLabel="Entendido" />}
      </View>
    </Modal>
  );
}

function PermissionScreen({ onAllow, onCancel, title = 'Se necesita acceso a la cámara', buttonLabel = 'Permitir cámara' }: Readonly<{ onAllow: () => void; onCancel: () => void; title?: string; buttonLabel?: string }>) {
  return <View style={styles.centeredScreen}><Text style={styles.permissionIcon}>📷</Text><Text style={styles.permissionTitle}>{title}</Text><Text style={styles.permissionBody}>La detección, el liveness y la representación facial se procesan en este dispositivo. No se guarda ninguna fotografía.</Text><Pressable style={styles.primaryBtn} onPress={onAllow}><Text style={styles.primaryBtnText}>{buttonLabel}</Text></Pressable><Pressable style={styles.secondaryBtn} onPress={onCancel}><Text style={styles.secondaryBtnText}>Cancelar</Text></Pressable></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.text },
  centeredScreen: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing[32], gap: spacing[16] },
  permissionIcon: { fontSize: 56, marginBottom: spacing[8] },
  permissionTitle: { fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center' },
  permissionBody: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  primaryBtn: { width: '100%', backgroundColor: colors.primary, paddingVertical: spacing[16], borderRadius: 12, alignItems: 'center', marginTop: spacing[8] },
  primaryBtnText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  secondaryBtn: { width: '100%', paddingVertical: spacing[12], alignItems: 'center' },
  secondaryBtnText: { color: colors.textSecondary, fontSize: 15, fontWeight: '500' },
  processingBadge: { position: 'absolute', bottom: '12%', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: spacing[8], backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: spacing[20], paddingVertical: spacing[12], borderRadius: 24 },
  processingText: { color: colors.white, fontSize: 14, fontWeight: '600' },
  retryContainer: { position: 'absolute', bottom: '10%', left: spacing[24], right: spacing[24], alignItems: 'center', gap: spacing[12] },
  retryMessage: { color: colors.white, fontSize: 15, fontWeight: '600', textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: spacing[16], paddingVertical: spacing[8], borderRadius: 12 },
  retryBtn: { backgroundColor: colors.primary, paddingHorizontal: spacing[40], paddingVertical: spacing[16], borderRadius: 14 },
  retryBtnText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  closeBtn: { position: 'absolute', top: 56, right: spacing[20], width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  closeBtnText: { color: colors.white, fontSize: 18, fontWeight: '600' },
});
