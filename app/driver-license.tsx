import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { FaceVerificationModal } from '@/components/face/FaceVerificationModal';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { isSupabaseEnabled, supabase } from '@/lib/supabase';
import { DriverProfile, driverService } from '@/services/driverService';
import { preloadFaceModel } from '@/services/faceRecognition';
import { faceVerificationService } from '@/services/faceVerificationService';
import { useAppStore } from '@/store/appStore';
import { DriverStatus } from '@/types';
import { errorMessage } from '@/utils/format';

const PHOTO_TIPS = [
  'Captura la licencia completa, por el lado de la foto.',
  'Mantén la licencia plana, sobre una superficie.',
  'Evita brillos y reflejos sobre la foto.',
  'Asegúrate de que tu foto se vea clara.',
  'Usa buena luz.',
  'Evita fotos borrosas: enfoca antes de capturar.',
];

type StepState = 'done' | 'active' | 'failed' | 'todo';

/** 'processing' while the phone analyses the photo; 'failed' keeps the reason on screen. */
type PhotoState = { kind: 'none' } | { kind: 'processing' } | { kind: 'failed'; message: string };

export default function DriverLicenseScreen() {
  const currentUser = useAppStore((state) => state.currentUser);
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [photo, setPhoto] = useState<PhotoState>({ kind: 'none' });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const [showSelfie, setShowSelfie] = useState(false);
  const userId = currentUser?.id;

  const updateStatus = useCallback((status: DriverStatus) => {
    const user = useAppStore.getState().currentUser;
    if (user) setCurrentUser({ ...user, driverStatus: status });
  }, [setCurrentUser]);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const driver = await driverService.getDriverProfile(userId);
      setProfile(driver);
      if (driver) updateStatus(driver.status);
    } catch (loadError) {
      setError(errorMessage(loadError, 'No se pudo cargar tu permiso de conductor.'));
    } finally {
      setLoaded(true);
    }
  }, [updateStatus, userId]);

  useEffect(() => {
    preloadFaceModel();
    const timer = setTimeout(() => void load(), 0);
    if (!isSupabaseEnabled || !userId) return () => clearTimeout(timer);
    // Suspensions happen in the dashboard; reflect them right away.
    const channel = supabase
      .channel(`driver-profile-${userId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'driver_profiles', filter: `user_id=eq.${userId}` }, () => void load())
      .subscribe();
    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [load, userId]);

  const processPhoto = async (uri: string) => {
    setPhoto({ kind: 'processing' });
    const result = await faceVerificationService.submitLicensePhoto(uri);
    if (!result.ok) {
      setPhoto({ kind: 'failed', message: result.message });
      return;
    }
    setPhoto({ kind: 'none' });
    setMessage('Foto de la licencia procesada. Ahora confirma que eres tú con una selfie.');
    await load();
  };

  const pick = async (source: 'camera' | 'library') => {
    setError(null);
    setMessage(null);
    setCameraBlocked(false);
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setCameraBlocked(!permission.canAskAgain);
          setError('Necesitamos acceso a la cámara para fotografiar tu licencia. También puedes subir una foto que ya tengas.');
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: false, exif: false };
      const picked = source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (picked.canceled || !picked.assets?.[0]?.uri) return;
      await processPhoto(picked.assets[0].uri);
    } catch (pickError) {
      setPhoto({ kind: 'none' });
      setError(errorMessage(pickError, 'No se pudo abrir la cámara o la galería.'));
    }
  };

  const status = profile?.status ?? null;
  const licenseStored = !!profile?.submittedAt;
  const verified = status === 'aprobado' && !!profile?.identityVerifiedAt;
  const processing = photo.kind === 'processing';

  const steps: { label: string; state: StepState; detail?: string }[] = [
    {
      label: 'Foto de la licencia cargada',
      state: processing || photo.kind === 'failed' || licenseStored ? 'done' : 'todo',
    },
    {
      label: 'Rostro detectado',
      state: processing ? 'active' : photo.kind === 'failed' ? 'failed' : licenseStored ? 'done' : 'todo',
      detail: photo.kind === 'failed' ? photo.message : undefined,
    },
    {
      label: verified ? 'Identidad de conductor verificada' : 'Verificación de identidad lista',
      state: verified ? 'done' : licenseStored && photo.kind === 'none' ? 'active' : 'todo',
      detail: licenseStored && !verified && photo.kind === 'none' ? 'Falta tomarte una selfie para compararla con tu licencia.' : undefined,
    },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      {userId ? (
        <FaceVerificationModal
          onClose={() => setShowSelfie(false)}
          onFailure={() => undefined}
          onSuccess={() => {
            setShowSelfie(false);
            setMessage('Tu identidad coincide con la foto de tu licencia.');
            updateStatus('aprobado');
            void load();
          }}
          trigger="driver_identity"
          userId={userId}
          visible={showSelfie}
        />
      ) : null}
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityLabel="Volver" onPress={() => router.back()} style={styles.back}>
          <Ionicons color={colors.text} name="arrow-back" size={24} />
        </Pressable>
        <Text style={styles.kicker}>CONDUCTOR</Text>
        <Text style={styles.title}>Licencia de conducción</Text>
        <Text style={styles.subtitle}>
          Comparamos tu rostro con la foto de tu licencia para confirmar que eres tú quien conduce. Esto no valida que la licencia sea
          auténtica ni consulta el RUNT u otra fuente oficial.
        </Text>

        {!loaded ? <ActivityIndicator color={colors.primary} /> : null}

        {status === 'suspendido' ? (
          <View style={[styles.statusCard, { borderColor: colors.error }]}>
            <Ionicons color={colors.error} name="ban" size={28} />
            <View style={styles.statusText}>
              <Text style={[styles.statusTitle, { color: colors.error }]}>Permiso suspendido</Text>
              <Text style={styles.statusBody}>Tu permiso de conductor está suspendido. Contacta al administrador de tu institución.</Text>
            </View>
          </View>
        ) : null}

        {verified ? (
          <View style={[styles.statusCard, { borderColor: colors.success }]}>
            <Ionicons color={colors.success} name="checkmark-circle" size={28} />
            <View style={styles.statusText}>
              <Text style={[styles.statusTitle, { color: colors.success }]}>Identidad de conductor verificada</Text>
              <Text style={styles.statusBody}>Tu identidad coincide con la foto de tu licencia. Ya puedes publicar viajes.</Text>
            </View>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {cameraBlocked ? <ButtonSecondary onPress={() => void Linking.openSettings()} title="Abrir ajustes del teléfono" /> : null}
        {message ? <Text style={styles.success}>{message}</Text> : null}

        {loaded && status !== 'suspendido' ? (
          <>
            <View style={styles.steps}>
              {steps.map((step) => (
                <View key={step.label} style={styles.step}>
                  <StepIcon state={step.state} />
                  <View style={styles.statusText}>
                    <Text style={[styles.stepLabel, step.state === 'todo' ? styles.stepTodo : null]}>{step.label}</Text>
                    {step.detail ? <Text style={step.state === 'failed' ? styles.stepError : styles.statusBody}>{step.detail}</Text> : null}
                  </View>
                </View>
              ))}
            </View>

            {licenseStored && !verified && !processing ? (
              <ButtonPrimary onPress={() => setShowSelfie(true)} title="Verificar mi identidad" />
            ) : null}

            <Text style={styles.section}>{licenseStored ? 'Cambiar la foto de tu licencia' : 'Licencia de conducción'}</Text>
            <View style={styles.tips}>
              {PHOTO_TIPS.map((tip) => (
                <View key={tip} style={styles.tip}>
                  <Ionicons color={colors.primary} name="checkmark" size={16} />
                  <Text style={styles.tipText}>{tip}</Text>
                </View>
              ))}
            </View>
            {processing ? (
              <View style={styles.processing}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.statusBody}>Buscando tu rostro en la licencia… la foto se analiza en el teléfono y luego se borra.</Text>
              </View>
            ) : (
              <View style={styles.actions}>
                <ButtonPrimary onPress={() => void pick('camera')} title="Tomar foto" />
                <ButtonSecondary onPress={() => void pick('library')} title="Subir foto" />
              </View>
            )}
            {licenseStored ? (
              <Text style={styles.note}>Si cambias la foto de tu licencia tendrás que verificar tu identidad de nuevo.</Text>
            ) : null}
            <Text style={styles.note}>
              No guardamos la foto de tu licencia: solo una representación numérica de tu rostro, que nunca sale del servidor.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function StepIcon({ state }: Readonly<{ state: StepState }>) {
  if (state === 'active') return <Ionicons color={colors.primary} name="ellipse-outline" size={22} />;
  if (state === 'done') return <Ionicons color={colors.success} name="checkmark-circle" size={22} />;
  if (state === 'failed') return <Ionicons color={colors.error} name="close-circle" size={22} />;
  return <Ionicons color={colors.border} name="ellipse-outline" size={22} />;
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  back: { alignSelf: 'flex-start', padding: spacing[4] },
  kicker: { ...typography.label, color: colors.primary },
  title: { ...typography.headingXL, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary },
  section: { ...typography.headingM, color: colors.text, marginTop: spacing[8] },
  statusCard: {
    alignItems: 'flex-start',
    backgroundColor: colors.white,
    borderRadius: radius.radiusLarge,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: spacing[12],
    padding: spacing[16],
  },
  statusText: { flex: 1, gap: spacing[4] },
  statusTitle: { ...typography.headingM },
  statusBody: { ...typography.bodySmall, color: colors.textSecondary },
  steps: { backgroundColor: colors.white, borderRadius: radius.radiusLarge, gap: spacing[12], padding: spacing[16] },
  step: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing[12] },
  stepLabel: { ...typography.bodyMedium, color: colors.text },
  stepTodo: { color: colors.textSecondary },
  stepError: { ...typography.bodySmall, color: colors.error },
  tips: { gap: spacing[8] },
  tip: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing[8] },
  tipText: { ...typography.bodySmall, color: colors.text, flex: 1 },
  actions: { gap: spacing[8] },
  processing: { alignItems: 'center', flexDirection: 'row', gap: spacing[12], padding: spacing[12] },
  note: { ...typography.caption, color: colors.textSecondary },
  error: { ...typography.bodySmall, backgroundColor: '#FFEAEA', color: colors.error, padding: spacing[12] },
  success: { ...typography.bodySmall, backgroundColor: colors.primaryLight, color: colors.primary, padding: spacing[12] },
});
