import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { tripService } from '@/services/tripService';
import { errorMessage } from '@/utils/format';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function QrScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.centered}>
        <Ionicons color={colors.primary} name="qr-code-outline" size={56} style={styles.centerIcon} />
        <Text style={styles.title}>Necesitamos la cámara</Text>
        <Text style={styles.body}>La usamos para leer el código QR que muestra cada pasajero al subir.</Text>
        {permission.canAskAgain ? (
          <ButtonPrimary onPress={() => void requestPermission()} title="Permitir cámara" />
        ) : (
          <ButtonPrimary onPress={() => void Linking.openSettings()} title="Abrir ajustes del teléfono" />
        )}
        <ButtonSecondary onPress={() => router.back()} title="Volver" />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : async ({ data }) => {
          // Stay paused until the driver taps "Escanear otro" so one bad code
          // does not trigger a request on every camera frame.
          setScanned(true);
          const token = data.trim();
          if (!UUID_PATTERN.test(token)) {
            setMessage({ text: 'Este código no es un QR de abordaje de WheelsApp.', ok: false });
            return;
          }
          try {
            await tripService.boardPassenger(token);
            setMessage({ text: 'Pasajero validado correctamente.', ok: true });
          } catch (scanError) {
            setMessage({ text: errorMessage(scanError, 'El QR no es válido para este viaje.'), ok: false });
          }
        }}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.overlay}>
        <Pressable accessibilityLabel="Cerrar escáner" onPress={() => router.back()} style={styles.close}>
          <Ionicons color={colors.white} name="close" size={28} />
        </Pressable>
        <Text style={styles.instruction}>Escanea el QR del pasajero</Text>
        <View pointerEvents="none" style={styles.frame} />
        {scanned && !message ? <Text style={styles.message}>Validando…</Text> : null}
        {message ? <Text style={[styles.message, message.ok ? styles.messageOk : styles.messageError]}>{message.text}</Text> : null}
        {message ? <ButtonPrimary onPress={() => { setScanned(false); setMessage(null); }} title="Escanear otro" /> : null}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.text, flex: 1 },
  centered: { backgroundColor: colors.background, flex: 1, gap: spacing[16], justifyContent: 'center', padding: spacing[24] },
  overlay: { flex: 1, gap: spacing[16], padding: spacing[24] },
  close: { alignSelf: 'flex-end', padding: spacing[8] },
  instruction: { color: colors.white, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  message: { backgroundColor: colors.white, color: colors.text, padding: spacing[16], textAlign: 'center' },
  messageOk: { color: colors.success, fontWeight: '700' },
  messageError: { color: colors.error },
  title: { ...typography.headingM, color: colors.text, textAlign: 'center' },
  body: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  centerIcon: { alignSelf: 'center' },
  frame: {
    alignSelf: 'center',
    borderColor: colors.white,
    borderRadius: 24,
    borderWidth: 3,
    height: 240,
    marginVertical: spacing[16],
    width: 240,
  },
});
