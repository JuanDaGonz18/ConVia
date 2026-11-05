import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { DriverStatus } from '@/types';

/** Statuses with a button to the license screen (texts in driverApproval.<status>). */
const WITH_ACTION = new Set<string>(['none', 'pendiente', 'rechazado']);

/** Shown instead of publishing actions while the driver permission is not approved. */
export function DriverApprovalNotice({ status }: Readonly<{ status: DriverStatus | null | undefined }>) {
  const { t } = useTranslation();
  const key = status ?? 'none';
  const blocked = status === 'suspendido' || status === 'rechazado';
  return (
    <View style={[styles.card, blocked ? styles.cardBlocked : null]}>
      <View style={styles.row}>
        <Ionicons color={blocked ? colors.error : colors.primary} name={status === 'pendiente' ? 'time-outline' : 'id-card-outline'} size={22} />
        <View style={styles.text}>
          <Text style={[styles.title, blocked ? styles.titleBlocked : null]}>{t(`driverApproval.${key}.title`)}</Text>
          <Text style={styles.body}>{t(`driverApproval.${key}.body`)}</Text>
        </View>
      </View>
      {WITH_ACTION.has(key) ? <ButtonSecondary onPress={() => router.push('/driver-license')} title={t(`driverApproval.${key}.action`)} /> : null}
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
