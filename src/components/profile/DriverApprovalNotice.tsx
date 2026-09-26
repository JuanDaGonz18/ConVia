import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { DriverStatus } from '@/types';

const COPY: Record<DriverStatus | 'none', { title: string; body: string; action?: string }> = {
  none: { title: 'Verifica tu identidad de conductor', body: 'Para publicar viajes, toma una foto de tu licencia y una selfie para confirmar que eres tú.', action: 'Verificar identidad' },
  pendiente: { title: 'Falta verificar tu identidad', body: 'Sube la foto de tu licencia y tómate una selfie. Podrás publicar viajes cuando tu rostro coincida con la licencia.', action: 'Continuar' },
  rechazado: { title: 'Verificación no aprobada', body: 'Sube de nuevo la foto de tu licencia y verifica tu identidad.', action: 'Intentar de nuevo' },
  suspendido: { title: 'Permiso suspendido', body: 'Tu permiso de conductor está suspendido. Contacta al administrador de tu institución.' },
  aprobado: { title: '', body: '' },
};

/** Shown instead of publishing actions while the driver permission is not approved. */
export function DriverApprovalNotice({ status }: Readonly<{ status: DriverStatus | null | undefined }>) {
  const copy = COPY[status ?? 'none'];
  const blocked = status === 'suspendido' || status === 'rechazado';
  return (
    <View style={[styles.card, blocked ? styles.cardBlocked : null]}>
      <View style={styles.row}>
        <Ionicons color={blocked ? colors.error : colors.primary} name={status === 'pendiente' ? 'time-outline' : 'id-card-outline'} size={22} />
        <View style={styles.text}>
          <Text style={[styles.title, blocked ? styles.titleBlocked : null]}>{copy.title}</Text>
          <Text style={styles.body}>{copy.body}</Text>
        </View>
      </View>
      {copy.action ? <ButtonSecondary onPress={() => router.push('/driver-license')} title={copy.action} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusLarge,
    gap: spacing[12],
    padding: spacing[16],
  },
  cardBlocked: { backgroundColor: '#FFEAEA' },
  row: { flexDirection: 'row', gap: spacing[12] },
  text: { flex: 1, gap: spacing[4] },
  title: { ...typography.bodyMedium, color: colors.primary, fontWeight: '700' },
  titleBlocked: { color: colors.error },
  body: { ...typography.bodySmall, color: colors.text },
});
