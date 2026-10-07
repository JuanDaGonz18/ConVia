import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { PlusBadge } from '@/components/subscription/PlusBadge';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { toast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { subscriptionService } from '@/services/subscriptionService';
import { DEFAULT_PLANS, FEATURE_INFO, LIMIT_INFO, Plan, PlanFeature, PlanLimit, PlanTier } from '@/subscription/plans';
import { refreshPlan, usePlan } from '@/subscription/usePlan';

type Row = { label: string; free: string | boolean; plus: string | boolean };

/** Everything FREE already includes: the essential ConVía experience. */
const ESSENTIALS: Row[] = [
  { label: 'Buscar, pedir y publicar viajes', free: true, plus: true },
  { label: 'Chat, código QR y verificación de identidad', free: true, plus: true },
  { label: 'Mapa con búsqueda, rutas y viajes cercanos', free: true, plus: true },
];

function limitLabel(value: number | null) {
  return value === null ? 'Sin límite' : String(value);
}

/** Rows that differ between plans, built from what the server says each plan includes. */
function planRows(plans: Record<PlanTier, Plan>): Row[] {
  const rows: Row[] = [
    { label: 'Mapa', free: 'OpenStreetMap', plus: plans.plus.features.includes('google_maps') ? 'Google Maps' : 'OpenStreetMap' },
  ];
  (Object.keys(FEATURE_INFO) as PlanFeature[])
    .filter((feature) => feature !== 'google_maps')
    .forEach((feature) => rows.push({
      label: FEATURE_INFO[feature].title,
      free: plans.free.features.includes(feature),
      plus: plans.plus.features.includes(feature),
    }));
  (Object.keys(LIMIT_INFO) as PlanLimit[])
    .filter((key) => plans.free.limits[key] !== plans.plus.limits[key])
    .forEach((key) => rows.push({
      label: key === 'vehicles' ? 'Vehículos registrados' : LIMIT_INFO[key].title,
      free: limitLabel(plans.free.limits[key]),
      plus: limitLabel(plans.plus.limits[key]),
    }));
  return rows;
}

function Cell({ value, highlight }: Readonly<{ value: string | boolean; highlight?: boolean }>) {
  if (typeof value === 'boolean') {
    return value
      ? <Ionicons accessibilityLabel="Incluido" color={highlight ? colors.primary : colors.success} name="checkmark-circle" size={20} />
      : <Ionicons accessibilityLabel="No incluido" color={colors.border} name="remove-circle-outline" size={20} />;
  }
  return <Text style={[styles.cellText, highlight ? styles.cellPlus : null]}>{value}</Text>;
}

export default function PlusScreen() {
  const { plan, isPlus } = usePlan();
  const [plans, setPlans] = useState<Record<PlanTier, Plan>>(DEFAULT_PLANS);
  const [checking, setChecking] = useState(false);

  useFocusEffect(useCallback(() => {
    void refreshPlan();
    void subscriptionService.getPlans().then(setPlans).catch(() => undefined);
  }, []));

  const checkAgain = async () => {
    setChecking(true);
    await refreshPlan();
    setChecking(false);
    toast.info('Revisamos tu plan.');
  };

  const lapsed = !isPlus && (plan.status === 'expired' || plan.status === 'canceled' || plan.status === 'past_due');
  const until = plan.currentPeriodEnd
    ? new Date(plan.currentPeriodEnd).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader
          kicker="TU PLAN"
          subtitle="Más herramientas para quienes viajan seguido. El plan gratis sigue teniendo todo lo esencial para compartir viajes."
          title="ConVía+"
        />

        <View style={[styles.current, isPlus ? styles.currentPlus : null]}>
          <Ionicons color={colors.primary} name={isPlus ? 'sparkles' : 'person-circle-outline'} size={28} />
          <View style={styles.flex}>
            <Text style={styles.currentTitle}>{isPlus ? 'Tienes ConVía+' : 'Estás en el plan gratis'}</Text>
            <Text style={styles.currentText}>
              {isPlus
                ? until ? `Activo hasta el ${until}.` : 'Activo, sin fecha de vencimiento.'
                : lapsed ? 'Tu ConVía+ ya no está activo. Volviste al plan gratis sin perder tus datos.' : 'Puedes usar ConVía completo sin pagar.'}
            </Text>
          </View>
          {isPlus ? <PlusBadge /> : null}
        </View>

        <View style={styles.table}>
          <View style={[styles.row, styles.headerRow]}>
            <Text style={[styles.label, styles.headerText]}>Incluye</Text>
            <Text style={[styles.cell, styles.headerText]}>Gratis</Text>
            <View style={styles.cell}><PlusBadge /></View>
          </View>
          {[...ESSENTIALS, ...planRows(plans)].map((row) => (
            <View key={row.label} style={styles.row}>
              <Text style={styles.label}>{row.label}</Text>
              <View style={styles.cell}><Cell value={row.free} /></View>
              <View style={styles.cell}><Cell highlight value={row.plus} /></View>
            </View>
          ))}
        </View>

        {!isPlus ? (
          <Notice title="Muy pronto podrás suscribirte aquí" tone="info">
            Los pagos dentro de la app aún no están habilitados. Durante la etapa de pruebas, el equipo de ConVía activa ConVía+ directamente en tu cuenta.
          </Notice>
        ) : null}

        <ButtonSecondary
          icon="refresh"
          loading={checking}
          onPress={() => void checkAgain()}
          title={isPlus ? 'Actualizar mi plan' : 'Ya me activaron ConVía+'}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  flex: { flex: 1 },
  current: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.radiusLarge,
    flexDirection: 'row',
    gap: spacing[12],
    padding: spacing[16],
  },
  currentPlus: { backgroundColor: colors.primaryLight },
  currentTitle: { ...typography.headingM, color: colors.text },
  currentText: { ...typography.bodySmall, color: colors.textSecondary },
  table: { borderColor: colors.lightGray, borderRadius: radius.radiusLarge, borderWidth: 1, overflow: 'hidden' },
  row: {
    alignItems: 'center',
    borderTopColor: colors.lightGray,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing[8],
    minHeight: 48,
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[8],
  },
  headerRow: { backgroundColor: colors.surfaceMuted, borderTopWidth: 0 },
  headerText: { ...typography.label, color: colors.textSecondary },
  label: { ...typography.bodySmall, color: colors.text, flex: 1 },
  cell: { alignItems: 'center', textAlign: 'center', width: 84 },
  cellText: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center' },
  cellPlus: { color: colors.primary, fontWeight: '700' },
});
