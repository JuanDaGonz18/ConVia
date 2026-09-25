import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { FaceVerificationFailureReason, FaceVerificationResult, FaceVerificationTrigger } from '@/types';

export type FaceVerificationModalProps = Readonly<{
  visible: boolean;
  trigger: FaceVerificationTrigger;
  userId: string;
  onSuccess: (result: FaceVerificationResult) => void;
  onFailure: (reason: FaceVerificationFailureReason) => void;
  onClose: () => void;
}>;

type NativeModal = React.ComponentType<FaceVerificationModalProps>;

export function FaceVerificationModal(props: FaceVerificationModalProps) {
  const [NativeImplementation, setNativeImplementation] = useState<NativeModal | null>(null);
  const [nativeError, setNativeError] = useState(false);

  useEffect(() => {
    if (!props.visible || NativeImplementation || nativeError) return;

    void import('./FaceVerificationModalImpl')
      .then((module) => setNativeImplementation(() => module.FaceVerificationModalImpl))
      .catch(() => setNativeError(true));
  }, [NativeImplementation, nativeError, props.visible]);

  if (NativeImplementation) return <NativeImplementation {...props} />;
  if (!props.visible) return null;
  if (nativeError) return <DevelopmentBuildRequired onClose={props.onClose} />;

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen">
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.loadingText}>Preparando verificación local…</Text>
      </View>
    </Modal>
  );
}

function DevelopmentBuildRequired({ onClose }: Readonly<{ onClose: () => void }>) {
  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.screen}>
        <Text style={styles.icon}>⚙</Text>
        <Text style={styles.title}>Se necesita una Development Build</Text>
        <Text style={styles.body}>
          La verificación facial local usa módulos nativos y no está disponible en Expo Go. Instala el APK de desarrollo y vuelve a abrir la app.
        </Text>
        <Pressable style={styles.button} onPress={onClose}>
          <Text style={styles.buttonText}>Cerrar</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[16], backgroundColor: colors.background },
  loadingText: { color: colors.text, fontSize: 16 },
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[16], paddingHorizontal: spacing[32], backgroundColor: colors.background },
  icon: { fontSize: 52 },
  title: { color: colors.text, fontSize: 21, fontWeight: '700', textAlign: 'center' },
  body: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  button: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 12, paddingVertical: spacing[16], width: '100%' },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '700' },
});
