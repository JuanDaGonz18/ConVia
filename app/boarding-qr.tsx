import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { tripService, TripRequestRecord } from '@/services/tripService';
import { errorMessage } from '@/utils/format';

export default function BoardingQrScreen() {
  const { requestId } = useLocalSearchParams<{ requestId?: string }>();
  const [request, setRequest] = useState<TripRequestRecord>();
  const [error, setError] = useState<string | null>(requestId ? null : 'No se indicó una solicitud.');

  useEffect(() => {
    if (!requestId) return;
    void tripService.getPassengerRequests().then((items) => {
      const found = items.find((item) => item.id === requestId);
      if (!found) setError('No se encontró la solicitud.');
      else setRequest(found);
    }).catch((loadError) => setError(errorMessage(loadError, 'No se pudo cargar el QR.')));
  }, [requestId]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityLabel="Volver" onPress={() => router.back()} style={styles.back}>
          <Ionicons color={colors.text} name="arrow-back" size={24} />
        </Pressable>
        <Text style={styles.kicker}>ABORDAJE</Text>
        <Text style={styles.title}>Código QR</Text>
        <Text style={styles.subtitle}>Muéstrale este código al conductor al subir al vehículo.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!request && !error ? <Text style={styles.subtitle}>Cargando...</Text> : null}
        {request?.estado === 'aceptado' ? <QRCode value={request.qr_token} size={240} backgroundColor={colors.white} color={colors.text} /> : null}
        {request?.estado === 'abordado' ? <Text style={styles.success}>Ya abordaste este viaje.</Text> : null}
        {request && request.estado !== 'aceptado' && request.estado !== 'abordado' ? (
          <Text style={styles.error}>El QR solo está disponible cuando el conductor acepta tu solicitud.</Text>
        ) : null}
        {request?.tripLabel ? <Text style={styles.meta}>{request.tripLabel}</Text> : null}
        {request ? <Text style={styles.meta}>Recogida: {request.direccion}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { alignItems: 'center', gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  back: { alignSelf: 'flex-start', padding: spacing[4] },
  kicker: { ...typography.label, color: colors.primary },
  title: { ...typography.headingXL, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  meta: { ...typography.body, color: colors.text },
  error: { ...typography.bodySmall, color: colors.error, textAlign: 'center' },
  success: { ...typography.headingM, color: colors.success, textAlign: 'center' },
});
