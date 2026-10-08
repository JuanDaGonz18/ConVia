import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { create } from 'zustand';

import { PlusBadge } from '@/components/subscription/PlusBadge';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { getPlan } from '@/subscription/usePlan';
import { CAPABILITIES, Capability, LIMIT_INFO, PLAN_LIMITS, PlanLimit } from '@/subscription/plans';

/** What the user tried to use: an on/off feature or a limit they reached. */
export type PlusReason = { capability: Capability } | { limit: PlanLimit };

const useGateStore = create<{ reason: PlusReason | null; close: () => void }>((set) => ({
  reason: null,
  close: () => set({ reason: null }),
}));

/**
 * Explains a ConVía+ feature and offers the upgrade path, without blocking
 * anything else. Call from anywhere; rendered once by <PlusGateHost />.
 */
export function requirePlus(reason: PlusReason) {
  useGateStore.setState({ reason });
}

function describe(reason: PlusReason) {
  if ('capability' in reason) {
    const info = CAPABILITIES[reason.capability];
    return { icon: info.icon, title: info.title, body: info.description, current: null };
  }
  const info = LIMIT_INFO[reason.limit];
  const current = getPlan().limits[reason.limit];
  return {
    icon: info.icon,
    title: info.title,
    body: info.plusText(PLAN_LIMITS.plus[reason.limit]),
    current: current === null ? null : info.freeText(current),
  };
}

export function PlusGateHost() {
  const reason = useGateStore((state) => state.reason);
  const close = useGateStore((state) => state.close);
  if (!reason) return null;
  const { icon, title, body, current } = describe(reason);

  return (
    <Modal animationType="fade" onRequestClose={close} statusBarTranslucent transparent visible>
      <Pressable accessibilityLabel="Cerrar" onPress={close} style={styles.overlay}>
        <Pressable accessibilityRole="alert" onPress={() => undefined} style={styles.dialog}>
          <View style={styles.iconCircle}>
            <Ionicons color={colors.primary} name={icon} size={28} />
          </View>
          <PlusBadge />
          <Text style={styles.title}>{title}</Text>
          {current ? <Text style={styles.current}>{current}</Text> : null}
          <Text style={styles.body}>{body}</Text>
          <Text style={styles.note}>Todo lo demás de ConVía sigue disponible en tu plan gratis.</Text>
          <View style={styles.actions}>
            <ButtonPrimary
              icon="sparkles-outline"
              onPress={() => {
                close();
                router.push('/plus');
              }}
              title="Conocer ConVía+"
            />
            <ButtonSecondary onPress={close} title="Ahora no" />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(16, 24, 40, 0.5)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing[24],
  },
  dialog: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.radiusXL,
    gap: spacing[8],
    maxWidth: 420,
    padding: spacing[24],
    width: '100%',
  },
  iconCircle: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusFull,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  title: { ...typography.headingM, color: colors.text, textAlign: 'center' },
  current: { ...typography.bodyMedium, color: colors.text, textAlign: 'center' },
  body: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  note: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: spacing[8], marginTop: spacing[8] },
});
