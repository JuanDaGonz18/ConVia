import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Ionicons from '@expo/vector-icons/Ionicons';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { Notice } from '@/components/ui/Notice';
import { toast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { localeTag } from '@/i18n';
import { type PaymentReceipt, subscriptionService } from '@/services/subscriptionService';
import {
  formatCop,
  paymentErrorMessage,
  pendingCount,
  PERIOD_LABEL,
  PERIOD_SUFFIX,
  type PaymentInfo,
  type PaymentInstructions,
  type PaymentPeriod,
  type PaymentRequest,
  yearlySaving,
} from '@/subscription/payments';
import { errorMessage, rawErrorMessage } from '@/utils/format';

type Props = Readonly<{
  info: Extract<PaymentInfo, { enabled: true }>;
  /** Called after "Ya pagué" so the screen can refresh the plan. */
  onSubmitted?: () => void;
}>;

const STATUS_TEXT: Record<PaymentRequest['status'], string> = {
  draft: 'Sin enviar',
  pending: 'En revisión',
  granted: 'Activado',
  rejected: 'No confirmado',
};

function dateText(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(localeTag(), { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

/**
 * ConVía+ paid by direct transfer (Bre-B): pick a period → unique reference, key and amount →
 * "Ya pagué" with an optional receipt → the team checks the bank and activates it.
 * Only rendered when the server says payments are enabled (get_plus_payment_info).
 */
export function PlusPayment({ info, onSubmitted }: Props) {
  const [period, setPeriod] = useState<PaymentPeriod>(info.prices[0].period);
  const [instructions, setInstructions] = useState<PaymentInstructions | null>(null);
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [busy, setBusy] = useState<'start' | 'confirm' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saving = yearlySaving(info.prices);
  const atLimit = pendingCount(requests) >= info.maxPending;

  const loadRequests = useCallback(() => {
    subscriptionService.myPayments().then(setRequests).catch(() => undefined);
  }, []);
  useEffect(loadRequests, [loadRequests]);

  const fail = (cause: unknown, fallback: string) => setError(paymentErrorMessage(rawErrorMessage(cause)) ?? errorMessage(cause, fallback));

  const start = async () => {
    setBusy('start');
    setError(null);
    try {
      setInstructions(await subscriptionService.startPayment(period));
      setReceipt(null);
    } catch (cause) {
      fail(cause, 'No pudimos generar tu referencia. Intenta de nuevo.');
    } finally {
      setBusy(null);
    }
  };

  const pickReceipt = async () => {
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: false, exif: false });
      const asset = picked.canceled ? null : picked.assets[0];
      if (asset?.uri) setReceipt({ uri: asset.uri, width: asset.width, height: asset.height });
    } catch {
      setError('No pudimos abrir tus fotos.');
    }
  };

  const confirm = async () => {
    if (!instructions) return;
    setBusy('confirm');
    setError(null);
    try {
      await subscriptionService.confirmPayment(instructions.reference, receipt);
      toast.success('Recibimos tu aviso de pago. Te avisamos cuando activemos ConVía+.');
      setInstructions(null);
      setReceipt(null);
      loadRequests();
      onSubmitted?.();
    } catch (cause) {
      fail(cause, 'No pudimos registrar tu pago. Intenta de nuevo.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Paga ConVía+ por transferencia</Text>

      {!instructions ? (
        <>
          <View style={styles.options}>
            {info.prices.map((price) => {
              const selected = price.period === period;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  key={price.period}
                  onPress={() => setPeriod(price.period)}
                  style={[styles.option, selected ? styles.optionSelected : null]}
                >
                  <Ionicons color={selected ? colors.primary : colors.border} name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} />
                  <View style={styles.flex}>
                    <Text style={styles.optionTitle}>{PERIOD_LABEL[price.period]}</Text>
                    <Text style={styles.optionText}>
                      {formatCop(price.amountCop)} {PERIOD_SUFFIX[price.period]}
                      {price.period === 'yearly' && saving > 0 ? ` · ahorras ${formatCop(saving)}` : ''}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.small}>Precios en pesos colombianos, impuestos incluidos. No se renueva solo: cuando venza, decides si pagas otra vez.</Text>
          {atLimit ? (
            <Notice tone="info">Ya tienes {info.maxPending} pagos en revisión. Te avisamos apenas los revisemos.</Notice>
          ) : (
            <ButtonPrimary icon="card-outline" loading={busy === 'start'} onPress={() => void start()} title="Continuar" />
          )}
        </>
      ) : (
        <>
          <View style={styles.steps}>
            <Text style={styles.step}>1. Desde la app de tu banco, transfiere con Bre-B:</Text>
            <View style={styles.detail}>
              <Text style={styles.detailLabel}>Llave Bre-B</Text>
              <Text selectable style={styles.detailValue}>{instructions.breBKey}</Text>
            </View>
            <View style={styles.detail}>
              <Text style={styles.detailLabel}>Titular</Text>
              <Text selectable style={styles.detailValue}>{instructions.payeeName}</Text>
            </View>
            <View style={styles.detail}>
              <Text style={styles.detailLabel}>Valor</Text>
              <Text selectable style={styles.detailValue}>{formatCop(instructions.amountCop)} · {PERIOD_LABEL[instructions.period]}</Text>
            </View>
            <Text style={styles.step}>2. Escribe esta referencia en la descripción de la transferencia:</Text>
            <Text accessibilityLabel={`Referencia ${instructions.reference.split('').join(' ')}`} selectable style={styles.reference}>
              {instructions.reference}
            </Text>
            <Text style={styles.step}>3. Toca «Ya pagué». Si quieres, adjunta el comprobante.</Text>
          </View>

          {receipt ? (
            <View style={styles.receipt}>
              <Image accessibilityLabel="Comprobante" resizeMode="contain" source={{ uri: receipt.uri }} style={styles.image} />
              <ButtonSecondary icon="close-outline" onPress={() => setReceipt(null)} title="Quitar comprobante" tone="danger" />
            </View>
          ) : (
            <ButtonSecondary icon="image-outline" onPress={() => void pickReceipt()} title="Adjuntar comprobante (opcional)" />
          )}

          <ButtonPrimary icon="checkmark-circle-outline" loading={busy === 'confirm'} onPress={() => void confirm()} title="Ya pagué" />
          <ButtonSecondary disabled={busy !== null} onPress={() => setInstructions(null)} title="Cambiar de plan" />
          <Text style={styles.small}>Revisamos el pago y activamos ConVía+ en máximo 24 horas hábiles. Te llega un aviso cuando quede activo.</Text>
        </>
      )}

      {error ? <Notice tone="error">{error}</Notice> : null}

      {requests.length ? (
        <View style={styles.history}>
          <Text style={styles.historyTitle}>Tus pagos</Text>
          {requests.map((request) => (
            <View key={request.reference} style={styles.historyRow}>
              <View style={styles.flex}>
                <Text style={styles.historyRef}>{request.reference} · {formatCop(request.amountCop)} · {PERIOD_LABEL[request.period]}</Text>
                <Text style={styles.optionText}>
                  {request.status === 'granted' && request.periodEnd ? `Activado hasta el ${dateText(request.periodEnd)}`
                    : request.status === 'rejected' ? `No confirmado${request.rejectReason ? `: ${request.rejectReason}` : ''}`
                      : `${STATUS_TEXT[request.status]}${request.submittedAt ? ` desde el ${dateText(request.submittedAt)}` : ''}`}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderColor: colors.lightGray, borderRadius: radius.radiusLarge, borderWidth: 1, gap: spacing[12], padding: spacing[16] },
  title: { ...typography.headingM, color: colors.text },
  flex: { flex: 1 },
  options: { gap: spacing[8] },
  option: {
    alignItems: 'center',
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing[12],
    padding: spacing[12],
  },
  optionSelected: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  optionTitle: { ...typography.bodyMedium, color: colors.text },
  optionText: { ...typography.bodySmall, color: colors.textSecondary },
  small: { ...typography.caption, color: colors.textSecondary },
  steps: { gap: spacing[8] },
  step: { ...typography.bodySmall, color: colors.text },
  detail: { backgroundColor: colors.surfaceMuted, borderRadius: radius.radiusLarge, paddingHorizontal: spacing[12], paddingVertical: spacing[8] },
  detailLabel: { ...typography.caption, color: colors.textSecondary },
  detailValue: { ...typography.bodyMedium, color: colors.text },
  reference: {
    ...typography.headingL,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusLarge,
    color: colors.primary,
    letterSpacing: 2,
    paddingVertical: spacing[12],
    textAlign: 'center',
  },
  receipt: { gap: spacing[8] },
  image: { borderRadius: radius.radiusLarge, height: 180, width: '100%' },
  history: { borderTopColor: colors.lightGray, borderTopWidth: 1, gap: spacing[8], paddingTop: spacing[12] },
  historyTitle: { ...typography.label, color: colors.textSecondary },
  historyRow: { flexDirection: 'row', gap: spacing[8] },
  historyRef: { ...typography.bodySmall, color: colors.text, fontWeight: '600' },
});
