import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { toast } from '@/components/ui/Toast';
import { TextField } from '@/components/forms/TextField';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { isValidPlate, MAX_SEATS, vehicleService } from '@/services/vehicleService';
import { errorMessage, rawErrorMessage } from '@/utils/format';

type Photo = { uri: string; mimeType: string };

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
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const [saving, setSaving] = useState(false);

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
      if (asset?.uri) setPhoto({ uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' });
    } catch (pickError) {
      setError(errorMessage(pickError, 'No se pudo abrir la cámara o la galería.'));
    }
  };

  const save = async () => {
    const parsedSeats = Number(seats);
    if (!plate.trim() || !brand.trim() || !color.trim()) {
      setError('Completa la placa, marca y color.');
      return;
    }
    if (!isValidPlate(plate)) {
      setError('La placa debe tener el formato ABC123 (carro) o ABC12D (moto).');
      return;
    }
    if (!photo && !savedPhotoUrl) {
      setError('Agrega una foto del vehículo. Los pasajeros la verán antes de pedir un cupo.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await vehicleService.saveVehicle({ plate, brand, color, seats: parsedSeats }, photo, id);
      toast.success(editing ? 'Vehículo actualizado' : '¡Vehículo agregado!');
      router.back();
    } catch (saveError) {
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
        {error ? <Notice tone="error">{error}</Notice> : null}
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
                <Text style={styles.photoHint}>Toma la foto de lado o de frente, con la placa visible y buena luz.</Text>
              </View>
            )}
            <View style={styles.photoActions}>
              <View style={styles.flex}>
                <ButtonSecondary onPress={() => void pickPhoto('camera')} title={previewUri ? 'Tomar otra' : 'Tomar foto'} />
              </View>
              <View style={styles.flex}>
                <ButtonSecondary onPress={() => void pickPhoto('library')} title="Subir foto" />
              </View>
            </View>

            <TextField autoCapitalize="characters" label="Placa" maxLength={7} onChangeText={setPlate} placeholder="ABC123" value={plate} />
            <TextField label="Marca y modelo" onChangeText={setBrand} placeholder="Ej. Mazda 3" value={brand} />
            <TextField label="Color" onChangeText={setColor} placeholder="Ej. Blanco" value={color} />

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
