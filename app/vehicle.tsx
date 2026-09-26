import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { TextField } from '@/components/forms/TextField';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { vehicleService } from '@/services/vehicleService';
import { Vehicle } from '@/types';

export default function VehicleScreen() {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [plate, setPlate] = useState('');
  const [brand, setBrand] = useState('');
  const [color, setColor] = useState('');
  const [seats, setSeats] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void vehicleService.getMyVehicle().then((saved) => {
      if (!saved) return;
      setVehicle(saved);
      setPlate(saved.plate);
      setBrand(saved.brand);
      setColor(saved.color ?? '');
      setSeats(String(saved.seats ?? 1));
    }).catch(() => setError('No se pudo cargar el vehículo.'));
  }, []);

  const saveVehicle = async () => {
    const parsedSeats = Number(seats);
    if (!plate.trim() || !brand.trim() || !color.trim()) {
      setError('Completa la placa, marca y color.');
      return;
    }
    if (!Number.isInteger(parsedSeats) || parsedSeats < 1 || parsedSeats > 8) {
      setError('Los puestos deben ser un número entre 1 y 8.');
      return;
    }
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const input: Vehicle = {
        id: vehicle?.id ?? `vehicle-${Date.now()}`,
        ownerId: vehicle?.ownerId ?? '',
        brand: brand.trim(),
        model: brand.trim(),
        plate: plate.trim().toUpperCase(),
        color: color.trim(),
        seats: parsedSeats,
      };
      if (vehicle) {
        setVehicle(await vehicleService.updateVehicle(input));
        setMessage('Vehículo actualizado.');
      } else {
        setVehicle(await vehicleService.registerVehicle(input));
        router.replace('/create-trip');
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No se pudo guardar el vehículo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityLabel="Volver" onPress={() => router.back()} style={styles.back}>
          <Ionicons color={colors.text} name="arrow-back" size={24} />
        </Pressable>
        <Text style={styles.kicker}>CONDUCTOR</Text>
        <Text style={styles.title}>Mi vehículo</Text>
        <Text style={styles.subtitle}>Registra el vehículo que usarás para publicar viajes.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {message ? <Text style={styles.success}>{message}</Text> : null}
        <TextField label="Placa" autoCapitalize="characters" onChangeText={setPlate} placeholder="ABC123" value={plate} />
        <TextField label="Marca" onChangeText={setBrand} placeholder="Toyota" value={brand} />
        <TextField label="Color" onChangeText={setColor} placeholder="Blanco" value={color} />
        <TextField label="Puestos disponibles" keyboardType="number-pad" onChangeText={setSeats} placeholder="4" value={seats} />
        <ButtonPrimary loading={loading} onPress={saveVehicle} title={vehicle ? 'Actualizar vehículo' : 'Guardar vehículo'} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  back: { alignSelf: 'flex-start', padding: spacing[4] },
  kicker: { ...typography.label, color: colors.primary },
  title: { ...typography.headingXL, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary },
  error: { ...typography.bodySmall, backgroundColor: '#FFEAEA', color: colors.error, padding: spacing[12] },
  success: { ...typography.bodySmall, backgroundColor: colors.primaryLight, color: colors.primary, padding: spacing[12] },
});
