import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { requirePlus } from '@/components/subscription/PlusGate';
import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { toast } from '@/components/ui/Toast';
import { FieldError } from '@/components/forms/FieldError';
import { TextField } from '@/components/forms/TextField';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { isValidPlate, MAX_SEATS, vehicleService } from '@/services/vehicleService';
import { planLimitFromError } from '@/subscription/plans';
import { usePlan } from '@/subscription/usePlan';
import { errorMessage, rawErrorMessage } from '@/utils/format';

type Photo = { uri: string; mimeType: string };

/** Problems found in the form, shown under each field. */
type FieldErrors = Partial<Record<'photo' | 'plate' | 'brand' | 'color', string>>;

/** Add a vehicle, or edit the one in `?id=`. Every vehicle needs a photo. */
export default function VehicleScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id;
  const [loaded, setLoaded] = useState(!editing);
  const [plate, setPlate] = useState('');
  const [brand, setBrand] = useState('');
  const [color, setColor] = useState('');
  const [seats, setSeats] = useState('4');
  const [savedPhotoUrl, setSavedPhotoUrl] = useState<string | undefined>();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const [saving, setSaving] = useState(false);
  // The server rejected a new vehicle because the plan's limit was reached.
  const [limitReached, setLimitReached] = useState(false);
  const { isPlus } = usePlan();

  useEffect(() => {
    if (!id) return;
    void vehicleService.getVehicle(id).then((saved) => {
      if (!saved) {
        setError('No se encontró el vehículo.');
        return;
      }
      setPlate(saved.plate);
      setBrand(saved.brand);
      setColor(saved.color ?? '');
      setSeats(String(Math.min(saved.seats ?? 1, MAX_SEATS)));
      setSavedPhotoUrl(saved.photoUrl);
    }).catch((loadError) => setError(errorMessage(loadError, 'No se pudo cargar el vehículo.')))
      .finally(() => setLoaded(true));
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
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [4, 3], quality: 0.7 };
      const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      const asset = result.canceled ? null : result.assets?.[0];
      if (asset?.uri) {
        setPhoto({ uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' });
        clearFieldError('photo');
      }
    } catch (pickError) {
      setError(errorMessage(pickError, 'No se pudo abrir la cámara o la galería.'));
    }
  };

  const clearFieldError = (key: keyof FieldErrors) => {
    setFieldErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };

  const save = async () => {
    const parsedSeats = Number(seats);
    const found: FieldErrors = {};
    if (!photo && !savedPhotoUrl) found.photo = 'Agrega una foto del vehículo. Los pasajeros la verán antes de pedir un cupo.';
    if (!plate.trim()) found.plate = 'Escribe la placa.';
    else if (!isValidPlate(plate)) found.plate = 'La placa debe tener 3 letras y 3 números (carro) o 3 letras, 2 números y 1 letra (moto).';
    if (!brand.trim()) found.brand = 'Escribe la marca y el modelo.';
    if (!color.trim()) found.color = 'Escribe el color.';
    setFieldErrors(found);
    if (Object.values(found).some(Boolean)) {
      setError(null);
      return;
    }
    setError(null);
    setLimitReached(false);
    setSaving(true);
    try {
      await vehicleService.saveVehicle({ plate, brand, color, seats: parsedSeats }, photo, id);
      toast.success(editing ? 'Vehículo actualizado' : '¡Vehículo agregado!');
      router.back();
    } catch (saveError) {
      setLimitReached(planLimitFromError(rawErrorMessage(saveError))?.key === 'vehicles');
      setError(/duplicate key|unique/i.test(rawErrorMessage(saveError))
        ? 'Esa placa ya está registrada en ConVía.'
        : errorMessage(saveError, 'No se pudo guardar el vehículo.'));
    } finally {
      setSaving(false);
    }
  };

  const previewUri = photo?.uri ?? savedPhotoUrl;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ScreenHeader kicker="CONDUCTOR" title={editing ? 'Editar vehículo' : 'Nuevo vehículo'} />
        <Text style={styles.subtitle}>Los pasajeros verán la foto, la placa y el color antes de pedir un cupo.</Text>
        {error ? (
          <Notice
            action={limitReached && !isPlus ? { label: 'Registra varios con ConVía+', onPress: () => requirePlus({ limit: 'vehicles' }) } : undefined}
            tone={limitReached ? 'warning' : 'error'}
          >
            {error}
          </Notice>
        ) : null}
        {cameraBlocked ? <ButtonSecondary onPress={() => void Linking.openSettings()} title="Abrir ajustes del teléfono" /> : null}

        {!loaded ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <Text style={styles.label}>Foto del vehículo</Text>
            {previewUri ? (
              <Image accessibilityLabel="Foto del vehículo" source={{ uri: previewUri }} style={styles.photo} />
            ) : (
              <View style={[styles.photo, styles.photoEmpty]}>
                <Ionicons color={colors.textSecondary} name="car-outline" size={48} />
                <Text style={styles.photoHint}>Toma la foto de lado, con buena luz. No hace falta que se vea la placa: los pasajeros la ven completa solo cuando los aceptas.</Text>
              </View>
            )}
            <FieldError message={fieldErrors.photo} />
            <View style={styles.photoActions}>
              <View style={styles.flex}>
                <ButtonSecondary onPress={() => void pickPhoto('camera')} title={previewUri ? 'Tomar otra' : 'Tomar foto'} />
              </View>
              <View style={styles.flex}>
                <ButtonSecondary onPress={() => void pickPhoto('library')} title="Subir foto" />
              </View>
            </View>

            <TextField
              autoCapitalize="characters"
              error={fieldErrors.plate}
              hint="Carro: 3 letras y 3 números. Moto: 3 letras, 2 números y 1 letra."
              label="Placa"
              maxLength={7}
              onChangeText={(text) => {
                setPlate(text);
                clearFieldError('plate');
              }}
              placeholder="Placa del vehículo"
              value={plate}
            />
            <TextField
              error={fieldErrors.brand}
              label="Marca y modelo"
              onChangeText={(text) => {
                setBrand(text);
                clearFieldError('brand');
              }}
              placeholder="Marca y modelo del vehículo"
              value={brand}
            />
            <TextField
              error={fieldErrors.color}
              label="Color"
              onChangeText={(text) => {
                setColor(text);
                clearFieldError('color');
              }}
              placeholder="Color del vehículo"
              value={color}
            />

            <Text style={styles.label}>Puestos para pasajeros</Text>
            <View accessibilityRole="radiogroup" style={styles.seatRow}>
              {Array.from({ length: MAX_SEATS }, (_, index) => String(index + 1)).map((value) => {
                const selected = seats === value;
                return (
                  <Pressable
                    accessibilityLabel={`${value} puesto${value === '1' ? '' : 's'}`}
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

            <ButtonPrimary loading={saving} onPress={save} title={editing ? 'Guardar cambios' : 'Agregar vehículo'} />
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
  seatTextSelected: { color: colors.white },
  error: { ...typography.bodySmall, backgroundColor: '#FFEAEA', color: colors.error, padding: spacing[12] },
});
