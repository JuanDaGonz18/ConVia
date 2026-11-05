import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import i18n from '@/i18n';
import { isSupabaseEnabled, supabase } from '@/lib/supabase';
import { tripService, TripRequestRecord } from '@/services/tripService';
import { errorMessage, formatDateTime } from '@/utils/format';

/** The passenger's boarding code; switches to "a bordo" the moment the driver scans it. */
export default function BoardingQrScreen() {
  const { t } = useTranslation();
  const { requestId } = useLocalSearchParams<{ requestId?: string }>();
  const [request, setRequest] = useState<TripRequestRecord>();
  const [error, setError] = useState<string | null>(requestId ? null : i18n.t('boardingQr.notFound'));

  useEffect(() => {
    if (!requestId) return;
    let previous: string | null = null;
    const load = () => tripService.getPassengerRequests().then((items) => {
      const found = items.find((item) => item.id === requestId);
      if (!found) {
        setError(i18n.t('boardingQr.notFoundCancelled'));
        return;
      }
      if (previous === 'aceptado' && found.estado === 'abordado') toast.success(i18n.t('boardingQr.boardedToast'));
      previous = found.estado;
      setRequest(found);
    }).catch((loadError) => setError(errorMessage(loadError, i18n.t('boardingQr.loadFailed'))));
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
          kicker={t('boardingQr.kicker')}
          subtitle={ready ? t('boardingQr.subtitle') : undefined}
          title={boarded ? t('boardingQr.titleBoarded') : t('boardingQr.title')}
        />
        {error ? <Notice tone="error">{error}</Notice> : null}

        {!request && !error ? (
          <View style={styles.qrCard}>
            <Skeleton height={240} width={240} />
          </View>
        ) : null}

        {ready ? (
          <View style={styles.qrCard}>
            <QRCode backgroundColor="#FFFFFF" color="#000000" quietZone={12} size={240} value={request.qr_token} />
            <View style={styles.hint}>
              <Ionicons color={colors.primary} name="sunny-outline" size={16} />
              <Text style={styles.hintText}>{t('boardingQr.brightness')}</Text>
            </View>
          </View>
        ) : null}

        {boarded ? (
          <View style={[styles.qrCard, styles.boardedCard]}>
            <Ionicons color={colors.success} name="checkmark-circle" size={88} />
            <Text style={styles.boardedTitle}>{t('boardingQr.boardedTitle')}</Text>
            <Text style={styles.boardedText}>{t('boardingQr.boardedText')}</Text>
          </View>
        ) : null}

        {request && !ready && !boarded ? (
          // No push in this build: the screen updates itself (realtime) when the driver accepts.
          <Notice tone="info">{t('boardingQr.waiting')}</Notice>
        ) : null}

        {request ? (
          <View style={styles.details}>
            {request.tripLabel ? <DetailRow icon="navigate-outline" text={request.tripLabel} /> : null}
            {request.tripDepartureAt ? <DetailRow icon="time-outline" text={formatDateTime(request.tripDepartureAt)} /> : null}
            <DetailRow icon="location-outline" text={t('boardingQr.pickup', { place: request.direccion })} />
          </View>
        ) : null}

        <ButtonSecondary onPress={() => router.back()} title={t('common.back')} />
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
  boardedCard: { backgroundColor: colors.successLight },
  boardedTitle: { ...typography.headingM, color: colors.successText, textAlign: 'center' },
  boardedText: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center' },
  details: { backgroundColor: colors.white, borderRadius: radius.radiusLarge, gap: spacing[12], padding: spacing[16] },
  detailRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing[12] },
  detailText: { ...typography.bodySmall, color: colors.text, flex: 1 },
});
