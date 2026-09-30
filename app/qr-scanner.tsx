import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { EmptyState } from '@/components/ui/EmptyState';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { tripService } from '@/services/tripService';
import { errorMessage } from '@/utils/format';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ScanResult = { ok: boolean; title: string; text: string };

/** Driver's boarding scanner: one code at a time, with a clear result for each. */
export default function QrScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [boardedCount, setBoardedCount] = useState(0);

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permission}>
        <EmptyState
          icon="qr-code-outline"
          message="La usamos para leer el código que muestra cada pasajero al subir. Nada se graba ni se guarda."
          title="Necesitamos la cámara"
        />
        {permission.canAskAgain ? (
          <ButtonPrimary icon="camera-outline" onPress={() => void requestPermission()} title="Permitir cámara" />
        ) : (
          <ButtonPrimary icon="settings-outline" onPress={() => void Linking.openSettings()} title="Abrir ajustes del teléfono" />
        )}
        <ButtonSecondary onPress={() => router.back()} title="Volver" />
      </SafeAreaView>
    );
  }

  const scanAgain = () => {
    setResult(null);
    setScanned(false);
  };

  return (
    <View style={styles.container}>
      <CameraView
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : async ({ data }) => {
          // Pause until the driver taps "Escanear otro" so one code isn't sent on every frame.
          setScanned(true);
          const token = data.trim();
          if (!UUID_PATTERN.test(token)) {
            setResult({ ok: false, title: 'Este no es un código de WheelsApp', text: 'Pídele al pasajero que abra "Mi código de abordaje" en su app.' });
            return;
          }
          try {
            await tripService.boardPassenger(token);
            setBoardedCount((count) => count + 1);
            setResult({ ok: true, title: '¡Pasajero a bordo!', text: 'El código es válido. Ya puedes escanear al siguiente.' });
          } catch (scanError) {
            setResult({ ok: false, title: 'No pudimos validar este código', text: errorMessage(scanError, 'El código no corresponde a un pasajero aceptado en tu viaje en curso.') });
          }
        }}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.overlay}>
        <View style={styles.topRow}>
          {boardedCount ? (
            <View style={styles.counter}>
              <Ionicons color={colors.white} name="people" size={16} />
              <Text style={styles.counterText}>{boardedCount} a bordo</Text>
            </View>
          ) : <View />}
          <Pressable accessibilityLabel="Cerrar escáner" hitSlop={8} onPress={() => router.back()} style={styles.close}>
            <Ionicons color={colors.white} name="close" size={26} />
          </Pressable>
        </View>

        <Text style={styles.instruction}>Apunta al código del pasajero</Text>
        <View pointerEvents="none" style={[styles.frame, result ? (result.ok ? styles.frameOk : styles.frameError) : null]} />

        {scanned && !result ? (
          <View style={styles.resultCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.resultText}>Validando…</Text>
          </View>
        ) : null}

        {result ? (
          <View style={styles.resultCard}>
            <Ionicons color={result.ok ? colors.success : colors.error} name={result.ok ? 'checkmark-circle' : 'close-circle'} size={56} />
            <Text style={[styles.resultTitle, { color: result.ok ? '#067647' : '#B42318' }]}>{result.title}</Text>
            <Text style={styles.resultText}>{result.text}</Text>
            <ButtonPrimary icon="scan-outline" onPress={scanAgain} title="Escanear otro" />
          </View>
        ) : null}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#000', flex: 1 },
  permission: { backgroundColor: colors.background, flex: 1, gap: spacing[12], justifyContent: 'center', padding: spacing[24] },
  overlay: { flex: 1, gap: spacing[16], padding: spacing[24] },
  topRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  counter: {
    alignItems: 'center',
    backgroundColor: 'rgba(18,183,106,0.9)',
    borderRadius: radius.radiusFull,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing[12],
    paddingVertical: 6,
  },
  counterText: { ...typography.label, color: colors.white },
  close: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.radiusFull,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  instruction: { ...typography.headingM, color: colors.white, textAlign: 'center' },
  frame: { alignSelf: 'center', borderColor: colors.white, borderRadius: 28, borderWidth: 4, height: 250, width: 250 },
  frameOk: { borderColor: colors.success },
  frameError: { borderColor: colors.error },
  resultCard: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.radiusXL,
    gap: spacing[8],
    marginTop: 'auto',
    padding: spacing[20],
  },
  resultTitle: { ...typography.headingM, textAlign: 'center' },
  resultText: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing[8], textAlign: 'center' },
});
