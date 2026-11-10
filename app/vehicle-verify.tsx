import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

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
import { canVerifyPlate, type VehicleVerification, vehicleVerificationService, verificationText } from '@/services/vehicleVerificationService';
import type { Vehicle } from '@/types';
import { errorMessage } from '@/utils/format';
import i18n from '@/i18n';

type Photo = { uri: string; mimeType: string };

/** Photo tips (vehicleVerify.tips.*). */
const TIPS = ['whole', 'plate', 'light', 'carOnly'] as const;

const RESULT_TONE = { verified: 'success', failed: 'error', retry: 'warning' } as const;

/**
 * Verifies `?id=` with AI: the driver photographs the car with the plate
 * visible, and the verify-vehicle Edge Function compares it with the
 * registered vehicle. The photo is deleted after the check.
 */
export default function VehicleVerifyScreen() {
  const { t } = useTranslation();
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
      .then((saved) => (saved ? setVehicle(saved) : setError(i18n.t('vehicle.notFound'))))
      .catch((loadError) => setError(errorMessage(loadError, i18n.t('vehicle.loadFailed'))))
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
          setError(t('vehicle.cameraNeeded'));
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
      setError(errorMessage(pickError, t('vehicle.pickFailed')));
    }
  };

  const verify = async () => {
    if (!photo || !id) return;
    setError(null);
    setProcessing(true);
    try {
      const outcome = await vehicleVerificationService.verify(id, photo);
      setResult(outcome);
      if (outcome.status === 'verified') toast.success(t('vehicleVerify.verifiedToast'));
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
        <ScreenHeader kicker={t('vehicle.kicker')} title={t('vehicleVerify.title')} />
        {fromNew ? <Notice tone="success">{t('vehicleVerify.saved')}</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {cameraBlocked ? <ButtonSecondary onPress={() => void Linking.openSettings()} title={t('vehicle.openSettings')} /> : null}

        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : !vehicle ? null : !supported ? (
          <>
            <Notice tone="info">{t('vehicleVerify.carsOnly')}</Notice>
            <ButtonSecondary onPress={() => router.back()} title={t('common.back')} />
          </>
        ) : (
          <>
            <Text style={styles.subtitle}>
              {t('vehicleVerify.subtitle', { brand: vehicle.brand, plate: vehicle.plate })}
            </Text>

            {photo ? (
              <Image accessibilityLabel={t('vehicleVerify.photoLabel')} source={{ uri: photo.uri }} style={styles.photo} />
            ) : (
              <View style={[styles.photo, styles.photoEmpty]}>
                <Ionicons color={colors.primary} name="scan-outline" size={56} />
                <Text style={styles.frameTitle}>{t('vehicleVerify.frameTitle')}</Text>
                {TIPS.map((tip) => (
                  <View key={tip} style={styles.tip}>
                    <Ionicons color={colors.textSecondary} name="checkmark-circle-outline" size={16} />
                    <Text style={styles.tipText}>{t(`vehicleVerify.tips.${tip}`)}</Text>
                  </View>
                ))}
              </View>
            )}

            {processing ? (
              <View accessibilityLiveRegion="polite" style={styles.processing}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.processingText}>{t('vehicleVerify.processing')}</Text>
              </View>
            ) : null}

            {result && !processing ? (
              <Notice title={t(`vehicleVerify.result.${result.status}`)} tone={RESULT_TONE[result.status]}>
                <Text style={styles.resultText}>{verificationText(result, vehicle?.plate ?? '')}</Text>
                {result.mock ? <Text style={styles.mock}>{t('vehicleVerify.mock')}</Text> : null}
              </Notice>
            ) : null}

            {result?.status === 'verified' ? (
              <ButtonPrimary icon="checkmark" onPress={() => router.back()} title={t('vehicleVerify.done')} />
            ) : result?.status === 'failed' ? (
              <>
                <ButtonPrimary onPress={retake} title={t('vehicleVerify.takeAnotherPhoto')} />
                <ButtonSecondary onPress={() => router.replace({ pathname: '/vehicle', params: { id: vehicle.id } })} title={t('vehicleVerify.reviewData')} />
              </>
            ) : result?.status === 'retry' ? (
              <ButtonPrimary icon="camera" onPress={retake} title={t('vehicleVerify.takeAnotherPhoto')} />
            ) : photo ? (
              <>
                <ButtonPrimary loading={processing} loadingTitle={t('vehicleVerify.verifying')} onPress={() => void verify()} title={t('vehicleVerify.title')} />
                <ButtonSecondary disabled={processing} onPress={retake} title={t('vehicle.takeAnother')} />
              </>
            ) : (
              <View style={styles.photoActions}>
                <View style={styles.flex}>
                  <ButtonPrimary icon="camera" onPress={() => void pickPhoto('camera')} title={t('vehicle.takePhoto')} />
                </View>
                <View style={styles.flex}>
                  <ButtonSecondary onPress={() => void pickPhoto('library')} title={t('vehicle.uploadPhoto')} />
                </View>
              </View>
            )}

            {!result || result.status !== 'verified' ? (
              <ButtonSecondary disabled={processing} onPress={() => router.back()} title={t('vehicleVerify.later')} />
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
