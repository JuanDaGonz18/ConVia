import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { PlusBadge } from '@/components/subscription/PlusBadge';
import { requirePlus } from '@/components/subscription/PlusGate';
import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { toast } from '@/components/ui/Toast';
import { FieldError } from '@/components/forms/FieldError';
import { TextField } from '@/components/forms/TextField';
import { type SuggestionState, VehicleSuggestionCard } from '@/components/vehicle/VehicleSuggestionCard';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { compressPhoto, PHOTO_MAX_SIDE } from '@/services/imageCompression';
import { isValidPlate, MAX_SEATS, vehicleService } from '@/services/vehicleService';
import { vehicleSuggestionService } from '@/services/vehicleSuggestionService';
import { canVerifyPlate, type VehicleVerification, vehicleVerificationService, verificationText } from '@/services/vehicleVerificationService';
import { planLimitFromError } from '@/subscription/plans';
import { usePlan } from '@/subscription/usePlan';
import { errorMessage, rawErrorMessage } from '@/utils/format';

type Photo = { uri: string; mimeType: string };

/** Problems found in the form, shown under each field. */
type FieldErrors = Partial<Record<'photo' | 'plate' | 'brand' | 'color', string>>;

/** Add a vehicle, or edit the one in `?id=`. Every vehicle needs a photo. */
export default function VehicleScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id;
  const [loaded, setLoaded] = useState(!editing);
  const [plate, setPlate] = useState('');
  const [brand, setBrand] = useState('');
  const [color, setColor] = useState('');
  const [seats, setSeats] = useState('4');
  const [savedPhotoUrl, setSavedPhotoUrl] = useState<string | undefined>();
  const [photo, setPhoto] = useState<Photo | null>(null);
  // The AI's proposal for the fields, from the latest photo (null = none to show).
  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null);
  const latestSuggestion = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const [saving, setSaving] = useState(false);
  // The server rejected a new vehicle because the plan's limit was reached.
  const [limitReached, setLimitReached] = useState(false);
  // Latest AI check of the saved vehicle (editing only); null when never verified with the current plate.
  const [verification, setVerification] = useState<VehicleVerification | null>(null);
  const [savedPlate, setSavedPlate] = useState('');
  const { isPlus, can } = usePlan();
  const canAutofill = can('vehicle_autofill');

  useEffect(() => {
    if (!id) return;
    void vehicleService.getVehicle(id).then((saved) => {
      if (!saved) {
        setError(t('vehicle.notFound'));
        return;
      }
      setPlate(saved.plate);
      setBrand(saved.brand);
      setColor(saved.color ?? '');
      setSeats(String(Math.min(saved.seats ?? 1, MAX_SEATS)));
      setSavedPhotoUrl(saved.photoUrl);
      setSavedPlate(saved.plate);
    }).catch((loadError) => setError(errorMessage(loadError, t('vehicle.loadFailed'))))
      .finally(() => setLoaded(true));
  }, [id, t]);

  // Refreshed on focus, so the result shows up when coming back from the verification screen.
  useFocusEffect(useCallback(() => {
    if (!id || !savedPlate) return;
    void vehicleVerificationService.getLatest(id, savedPlate).then(setVerification).catch(() => undefined);
  }, [id, savedPlate]));

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
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [4, 3], quality: 0.7 };
      const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      const asset = result.canceled ? null : result.assets?.[0];
      if (asset?.uri) {
        // Resized before upload (and before the preview) to save Storage and egress.
        const compressed = await compressPhoto(asset, PHOTO_MAX_SIDE.vehicle);
        setPhoto(compressed);
        clearFieldError('photo');
        if (canAutofill) void suggestFromPhoto(compressed.uri);
      }
    } catch (pickError) {
      setError(errorMessage(pickError, t('vehicle.pickFailed')));
    }
  };

  /** Asks the AI for brand, line, color and plate; only the newest photo's answer is shown. */
  const suggestFromPhoto = async (uri: string) => {
    const requestId = ++latestSuggestion.current;
    setSuggestion({ status: 'loading' });
    const result = await vehicleSuggestionService.suggest(uri);
    if (requestId !== latestSuggestion.current) return;
    if (result.status === 'locked') {
      // The server says the plan no longer includes it (e.g. ConVía+ expired).
      setSuggestion(null);
      requirePlus({ capability: 'vehicle_autofill' });
      return;
    }
    setSuggestion(result);
  };

  /** Fills only the fields the model was sure about; the driver can still edit all of them. */
  const applySuggestion = () => {
    if (suggestion?.status !== 'ok') return;
    const { brand: suggestedBrand, line, color: suggestedColor, plate: suggestedPlate } = suggestion.suggestion;
    if (suggestedBrand) setBrand([suggestedBrand, line].filter(Boolean).join(' '));
    if (suggestedColor) setColor(suggestedColor);
    if (suggestedPlate) setPlate(suggestedPlate);
    setFieldErrors((current) => ({
      ...current,
      brand: suggestedBrand ? undefined : current.brand,
      color: suggestedColor ? undefined : current.color,
      plate: suggestedPlate ? undefined : current.plate,
    }));
    setSuggestion(null);
    toast.info(t('vehicleSuggestion.applied'));
  };

  const clearFieldError = (key: keyof FieldErrors) => {
    setFieldErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };

  const save = async () => {
    const parsedSeats = Number(seats);
    const found: FieldErrors = {};
    if (!photo && !savedPhotoUrl) found.photo = t('vehicle.errors.photo');
    if (!plate.trim()) found.plate = t('vehicle.errors.plateEmpty');
    else if (!isValidPlate(plate)) found.plate = t('vehicle.errors.plateInvalid');
    if (!brand.trim()) found.brand = t('vehicle.errors.brand');
    if (!color.trim()) found.color = t('vehicle.errors.color');
    setFieldErrors(found);
    if (Object.values(found).some(Boolean)) {
      setError(null);
      return;
    }
    setError(null);
    setLimitReached(false);
    setSaving(true);
    try {
      const saved = await vehicleService.saveVehicle({ plate, brand, color, seats: parsedSeats }, photo, id);
      toast.success(editing ? t('vehicle.updated') : t('vehicle.added'));
      // New cars go straight to the AI verification step (it can be skipped).
      if (!editing && canVerifyPlate(saved.plate)) router.replace({ pathname: '/vehicle-verify', params: { id: saved.id, fromNew: '1' } });
      else router.back();
    } catch (saveError) {
      setLimitReached(planLimitFromError(rawErrorMessage(saveError))?.key === 'vehicles');
      setError(/duplicate key|unique/i.test(rawErrorMessage(saveError))
        ? t('vehicle.plateTaken')
        : errorMessage(saveError, t('vehicle.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const previewUri = photo?.uri ?? savedPhotoUrl;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ScreenHeader kicker={t('vehicle.kicker')} title={editing ? t('vehicle.titleEdit') : t('vehicle.titleNew')} />
        <Text style={styles.subtitle}>{t('vehicle.subtitle')}</Text>
        {error ? (
          <Notice
            action={limitReached && !isPlus ? { label: t('vehicle.limitAction'), onPress: () => requirePlus({ limit: 'vehicles' }) } : undefined}
            tone={limitReached ? 'warning' : 'error'}
          >
            {error}
          </Notice>
        ) : null}
        {cameraBlocked ? <ButtonSecondary onPress={() => void Linking.openSettings()} title={t('vehicle.openSettings')} /> : null}

        {!loaded ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            {editing && savedPlate && canVerifyPlate(savedPlate) ? (
              verification?.status === 'verified' ? (
                <Notice tone="success" title={t('vehicle.verifiedTitle')}>
                  {t('vehicle.verifiedText')}
                </Notice>
              ) : (
                <Notice
                  action={{ label: verification ? t('vehicle.verifyAgain') : t('vehicle.verifyWithAi'), onPress: () => router.push({ pathname: '/vehicle-verify', params: { id: id! } }) }}
                  tone={verification ? 'warning' : 'info'}
                  title={verification ? t('vehicle.verifyPendingTitle') : t('vehicle.verifyTitle')}
                >
                  {verification ? verificationText(verification, savedPlate) : t('vehicle.verifyText')}
                </Notice>
              )
            ) : null}
            <Text style={styles.label}>{t('vehicle.photoLabel')}</Text>
            {previewUri ? (
              <Image accessibilityLabel={t('vehicle.photoLabel')} source={{ uri: previewUri }} style={styles.photo} />
            ) : (
              <View style={[styles.photo, styles.photoEmpty]}>
                <Ionicons color={colors.textSecondary} name="car-outline" size={48} />
                <Text style={styles.photoHint}>{t('vehicle.photoHint')}</Text>
              </View>
            )}
            <FieldError message={fieldErrors.photo} />
            {suggestion ? (
              <VehicleSuggestionCard
                onApply={applySuggestion}
                onDismiss={() => {
                  latestSuggestion.current += 1;
                  setSuggestion(null);
                }}
                state={suggestion}
              />
            ) : null}
            {!canAutofill && !editing ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => requirePlus({ capability: 'vehicle_autofill' })}
                style={styles.autofillEntry}
              >
                <Ionicons color={colors.primary} name="sparkles-outline" size={18} />
                <Text style={styles.autofillText}>{t('vehicleSuggestion.plusEntry')}</Text>
                <PlusBadge compact />
              </Pressable>
            ) : null}
            <View style={styles.photoActions}>
              <View style={styles.flex}>
                <ButtonSecondary onPress={() => void pickPhoto('camera')} title={previewUri ? t('vehicle.takeAnother') : t('vehicle.takePhoto')} />
              </View>
              <View style={styles.flex}>
                <ButtonSecondary onPress={() => void pickPhoto('library')} title={t('vehicle.uploadPhoto')} />
              </View>
            </View>

            <TextField
              autoCapitalize="characters"
              error={fieldErrors.plate}
              hint={t('vehicle.plateHint')}
              label={t('vehicle.plateLabel')}
              maxLength={7}
              onChangeText={(text) => {
                setPlate(text);
                clearFieldError('plate');
              }}
              placeholder={t('vehicle.platePlaceholder')}
              value={plate}
            />
            <TextField
              error={fieldErrors.brand}
              label={t('vehicle.brandLabel')}
              onChangeText={(text) => {
                setBrand(text);
                clearFieldError('brand');
              }}
              placeholder={t('vehicle.brandPlaceholder')}
              value={brand}
            />
            <TextField
              error={fieldErrors.color}
              label={t('vehicle.colorLabel')}
              onChangeText={(text) => {
                setColor(text);
                clearFieldError('color');
              }}
              placeholder={t('vehicle.colorPlaceholder')}
              value={color}
            />

            <Text style={styles.label}>{t('vehicle.seatsLabel')}</Text>
            <View accessibilityRole="radiogroup" style={styles.seatRow}>
              {Array.from({ length: MAX_SEATS }, (_, index) => String(index + 1)).map((value) => {
                const selected = seats === value;
                return (
                  <Pressable
                    accessibilityLabel={t('vehicle.seats', { count: Number(value) })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    key={value}
                    onPress={() => setSeats(value)}
                    style={[styles.seat, selected ? styles.seatSelected : null]}
                  >
                    <Text style={[styles.seatText, selected ? styles.seatTextSelected : null]}>{value}</Text>
                  </Pressable>
                );
              })}
            </View>

            <ButtonPrimary loading={saving} onPress={save} title={editing ? t('vehicle.saveChanges') : t('vehicle.add')} />
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
  label: { ...typography.label, color: colors.text, marginBottom: -spacing[8] },
  flex: { flex: 1 },
  photo: { aspectRatio: 4 / 3, backgroundColor: colors.lightGray, borderRadius: radius.radiusLarge, width: '100%' },
  photoEmpty: { alignItems: 'center', gap: spacing[8], justifyContent: 'center', padding: spacing[24] },
  photoHint: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center' },
  photoActions: { flexDirection: 'row', gap: spacing[8] },
  autofillEntry: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusMedium,
    flexDirection: 'row',
    gap: spacing[8],
    padding: spacing[12],
  },
  autofillText: { ...typography.bodySmall, color: colors.text, flex: 1 },
  seatRow: { flexDirection: 'row', gap: spacing[8] },
  seat: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.radiusMedium,
    borderWidth: 1,
    flex: 1,
    height: 48,
    justifyContent: 'center',
  },
  seatSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  seatText: { ...typography.bodyMedium, color: colors.text, fontWeight: '600' },
  seatTextSelected: { color: colors.onPrimary },
  error: { ...typography.bodySmall, backgroundColor: colors.errorLight, color: colors.error, padding: spacing[12] },
});
