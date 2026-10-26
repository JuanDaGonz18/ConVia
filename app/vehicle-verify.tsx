import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { toast } from '@/components/ui/Toast';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { compressPhoto, PHOTO_MAX_SIDE } from '@/services/imageCompression';
import { vehicleService } from '@/services/vehicleService';
import { canVerifyPlate, type VehicleVerification, vehicleVerificationService } from '@/services/vehicleVerificationService';
import type { Vehicle } from '@/types';
import { errorMessage } from '@/utils/format';

type Photo = { uri: string; mimeType: string };

const TIPS = [
  'Encuadra el carro completo, sin cortarlo.',
  'La placa debe verse entera: toma la foto de frente o de atrás.',
  'Con buena luz y sin otros carros adelante.',
  'Solo el carro: no hace falta que aparezcas tú.',
];

const RESULT_UI = {
  verified: { tone: 'success', title: 'Vehículo verificado' },
  failed: { tone: 'error', title: 'No pudimos verificar el vehículo' },
  retry: { tone: 'warning', title: 'Toma otra foto' },
} as const;

/**
 * Verifies `?id=` with AI: the driver photographs the car with the plate
 * visible, and the verify-vehicle Edge Function compares it with the
 * registered vehicle. The photo is deleted after the check.
 */
export default function VehicleVerifyScreen() {
  const { id, fromNew } = useLocalSearchParams<{ id: string; fromNew?: string }>();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<VehicleVerification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraBlocked, setCameraBlocked] = useState(false);

  useEffect(() => {
    if (!id) return;
    void vehicleService.getVehicle(id)
      .then((saved) => (saved ? setVehicle(saved) : setError('No se encontró el vehículo.')))
      .catch((loadError) => setError(errorMessage(loadError, 'No se pudo cargar el vehículo.')))
      .finally(() => setLoading(false));
  }, [id]);

  const pickPhoto = async (source: 'camera' | 'library') => {
    setError(null);
    setCameraBlocked(false);
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setCameraBlocked(!permission.canAskAgain);
          setError('Necesitamos la cámara para fotografiar el vehículo. También puedes subir una foto.');
          return;
        }
      }
      // No cropping: it could cut off the plate.
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: false, quality: 0.8 };
      const picked = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      const asset = picked.canceled ? null : picked.assets?.[0];
      if (asset?.uri) {
        setPhoto(await compressPhoto(asset, PHOTO_MAX_SIDE.vehicle));
        setResult(null);
      }
    } catch (pickError) {
      setError(errorMessage(pickError, 'No se pudo abrir la cámara o la galería.'));
    }
  };

  const verify = async () => {
    if (!photo || !id) return;
    setError(null);
    setProcessing(true);
    try {
      const outcome = await vehicleVerificationService.verify(id, photo);
      setResult(outcome);
      if (outcome.status === 'verified') toast.success('¡Vehículo verificado!');
    } finally {
      setProcessing(false);
    }
  };

  const retake = () => {
    setPhoto(null);
    setResult(null);
    void pickPhoto('camera');
  };

  const supported = vehicle ? canVerifyPlate(vehicle.plate) : false;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader kicker="CONDUCTOR" title="Verificar vehículo" />
        {fromNew ? <Notice tone="success">Vehículo guardado. Ahora verifícalo para dar más confianza a tus pasajeros.</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {cameraBlocked ? <ButtonSecondary onPress={() => void Linking.openSettings()} title="Abrir ajustes del teléfono" /> : null}

        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : !vehicle ? null : !supported ? (
          <>
            <Notice tone="info">La verificación con IA está disponible solo para carros (placa de 3 letras y 3 números).</Notice>
            <ButtonSecondary onPress={() => router.back()} title="Volver" />
          </>
        ) : (
          <>
            <Text style={styles.subtitle}>
              Comprobamos con IA que la placa de la foto coincide con la de tu {vehicle.brand} ({vehicle.plate}). La foto se borra apenas termina la verificación.
            </Text>

            {photo ? (
              <Image accessibilityLabel="Foto para verificar el vehículo" source={{ uri: photo.uri }} style={styles.photo} />
            ) : (
              <View style={[styles.photo, styles.photoEmpty]}>
                <Ionicons color={colors.primary} name="scan-outline" size={56} />
                <Text style={styles.frameTitle}>Encuadra el carro completo con la placa visible</Text>
                {TIPS.map((tip) => (
                  <View key={tip} style={styles.tip}>
                    <Ionicons color={colors.textSecondary} name="checkmark-circle-outline" size={16} />
                    <Text style={styles.tipText}>{tip}</Text>
                  </View>
                ))}
              </View>
            )}

            {processing ? (
              <View accessibilityLiveRegion="polite" style={styles.processing}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.processingText}>Verificando el vehículo… Buscamos el carro y leemos la placa.</Text>
              </View>
            ) : null}

            {result && !processing ? (
              <Notice title={RESULT_UI[result.status].title} tone={RESULT_UI[result.status].tone}>
                <Text style={styles.resultText}>{result.message}</Text>
                {result.mock ? <Text style={styles.mock}>Modo de prueba: resultado simulado, sin IA real.</Text> : null}
              </Notice>
            ) : null}

            {result?.status === 'verified' ? (
              <ButtonPrimary icon="checkmark" onPress={() => router.back()} title="Listo" />
            ) : result?.status === 'failed' ? (
              <>
                <ButtonPrimary onPress={retake} title="Tomar otra foto" />
                <ButtonSecondary onPress={() => router.replace({ pathname: '/vehicle', params: { id: vehicle.id } })} title="Revisar datos del vehículo" />
              </>
            ) : result?.status === 'retry' ? (
              <ButtonPrimary icon="camera" onPress={retake} title="Tomar otra foto" />
            ) : photo ? (
              <>
                <ButtonPrimary loading={processing} loadingTitle="Verificando…" onPress={() => void verify()} title="Verificar vehículo" />
                <ButtonSecondary disabled={processing} onPress={retake} title="Tomar otra" />
              </>
            ) : (
              <View style={styles.photoActions}>
                <View style={styles.flex}>
                  <ButtonPrimary icon="camera" onPress={() => void pickPhoto('camera')} title="Tomar foto" />
                </View>
                <View style={styles.flex}>
                  <ButtonSecondary onPress={() => void pickPhoto('library')} title="Subir foto" />
                </View>
              </View>
            )}

            {!result || result.status !== 'verified' ? (
              <ButtonSecondary disabled={processing} onPress={() => router.back()} title="Verificar después" />
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  subtitle: { ...typography.body, color: colors.textSecondary },
  flex: { flex: 1 },
  photo: { aspectRatio: 4 / 3, backgroundColor: colors.lightGray, borderRadius: radius.radiusLarge, width: '100%' },
  photoEmpty: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    borderWidth: 2,
    gap: spacing[8],
    justifyContent: 'center',
    padding: spacing[16],
  },
  frameTitle: { ...typography.bodyMedium, color: colors.text, fontWeight: '600', textAlign: 'center' },
  tip: { alignItems: 'center', alignSelf: 'stretch', flexDirection: 'row', gap: spacing[8] },
  tipText: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },
  photoActions: { flexDirection: 'row', gap: spacing[8] },
  processing: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusMedium,
    flexDirection: 'row',
    gap: spacing[12],
    padding: spacing[16],
  },
  processingText: { ...typography.bodySmall, color: colors.primaryPressed, flex: 1 },
  resultText: { ...typography.bodySmall, color: colors.text },
  mock: { ...typography.caption, color: colors.textSecondary, marginTop: spacing[4] },
});
