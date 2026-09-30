import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { Ionicons } from '@expo/vector-icons';

import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { isSupabaseEnabled, supabase } from '@/lib/supabase';
import { tripService, TripRequestRecord } from '@/services/tripService';
import { errorMessage, formatDateTime } from '@/utils/format';

/** The passenger's boarding code; switches to "a bordo" the moment the driver scans it. */
export default function BoardingQrScreen() {
  const { requestId } = useLocalSearchParams<{ requestId?: string }>();
  const [request, setRequest] = useState<TripRequestRecord>();
  const [error, setError] = useState<string | null>(requestId ? null : 'No encontramos esta solicitud.');

  useEffect(() => {
    if (!requestId) return;
    let previous: string | null = null;
    const load = () => tripService.getPassengerRequests().then((items) => {
      const found = items.find((item) => item.id === requestId);
      if (!found) {
        setError('No encontramos esta solicitud. Puede que se haya cancelado.');
        return;
      }
      if (previous === 'aceptado' && found.estado === 'abordado') toast.success('¡Listo! Ya estás a bordo. Buen viaje');
      previous = found.estado;
      setRequest(found);
    }).catch((loadError) => setError(errorMessage(loadError, 'No pudimos cargar tu código.')));
    void load();
    if (!isSupabaseEnabled) return;
    const channel = supabase
      .channel(`boarding-${requestId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'trip_requests', filter: `id=eq.${requestId}` }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [requestId]);

  const boarded = request?.estado === 'abordado';
  const ready = request?.estado === 'aceptado';

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader
          kicker="ABORDAJE"
          subtitle={ready ? 'Muéstrale este código al conductor cuando subas al vehículo.' : undefined}
          title={boarded ? '¡Estás a bordo!' : 'Tu código de abordaje'}
        />
        {error ? <Notice tone="error">{error}</Notice> : null}

        {!request && !error ? (
          <View style={styles.qrCard}>
            <Skeleton height={240} width={240} />
          </View>
        ) : null}

        {ready ? (
          <View style={styles.qrCard}>
            <QRCode backgroundColor={colors.white} color={colors.text} size={240} value={request.qr_token} />
            <View style={styles.hint}>
              <Ionicons color={colors.primary} name="sunny-outline" size={16} />
              <Text style={styles.hintText}>Sube el brillo de la pantalla si el conductor no logra leerlo.</Text>
            </View>
          </View>
        ) : null}

        {boarded ? (
          <View style={[styles.qrCard, styles.boardedCard]}>
            <Ionicons color={colors.success} name="checkmark-circle" size={88} />
            <Text style={styles.boardedTitle}>El conductor validó tu código</Text>
            <Text style={styles.boardedText}>Ponte el cinturón y disfruta el trayecto.</Text>
          </View>
        ) : null}

        {request && !ready && !boarded ? (
          <Notice tone="info">El código aparece cuando el conductor acepta tu solicitud. Te avisaremos con una notificación.</Notice>
        ) : null}

        {request ? (
          <View style={styles.details}>
            {request.tripLabel ? <DetailRow icon="navigate-outline" text={request.tripLabel} /> : null}
            {request.tripDepartureAt ? <DetailRow icon="time-outline" text={formatDateTime(request.tripDepartureAt)} /> : null}
            <DetailRow icon="location-outline" text={`Recogida: ${request.direccion}`} />
          </View>
        ) : null}

        <ButtonSecondary onPress={() => router.back()} title="Volver" />
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailRow({ icon, text }: Readonly<{ icon: keyof typeof Ionicons.glyphMap; text: string }>) {
  return (
    <View style={styles.detailRow}>
      <Ionicons color={colors.textSecondary} name={icon} size={18} />
      <Text style={styles.detailText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surfaceMuted, flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  qrCard: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.radiusXL,
    elevation: 3,
    gap: spacing[16],
    padding: spacing[24],
    shadowColor: '#000',
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
  },
  hint: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  hintText: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  boardedCard: { backgroundColor: '#ECFDF3' },
  boardedTitle: { ...typography.headingM, color: '#067647', textAlign: 'center' },
  boardedText: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center' },
  details: { backgroundColor: colors.white, borderRadius: radius.radiusLarge, gap: spacing[12], padding: spacing[16] },
  detailRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing[12] },
  detailText: { ...typography.bodySmall, color: colors.text, flex: 1 },
});
