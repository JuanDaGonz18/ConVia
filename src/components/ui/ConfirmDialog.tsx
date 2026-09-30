import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

type ConfirmDialogProps = Readonly<{
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** 'danger' for destructive actions: red button and warning icon. */
  tone?: 'default' | 'danger';
  icon?: keyof typeof Ionicons.glyphMap;
}>;

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  tone = 'default',
  icon,
}: ConfirmDialogProps) {
  const danger = tone === 'danger';
  return (
    <Modal animationType="fade" onRequestClose={onCancel} statusBarTranslucent transparent visible={visible}>
      {/* Tapping outside closes the dialog, like the back button. */}
      <Pressable accessibilityLabel={cancelLabel} onPress={onCancel} style={styles.overlay}>
        <Pressable accessibilityRole="alert" onPress={() => undefined} style={styles.dialog}>
          <View style={[styles.iconCircle, danger ? styles.iconDanger : null]}>
            <Ionicons
              color={danger ? colors.error : colors.primary}
              name={icon ?? (danger ? 'warning-outline' : 'help-circle-outline')}
              size={28}
            />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            <ButtonPrimary onPress={onConfirm} title={confirmLabel} tone={danger ? 'danger' : 'primary'} />
            <ButtonSecondary onPress={onCancel} title={cancelLabel} />
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
    gap: spacing[12],
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
  iconDanger: { backgroundColor: '#FEF3F2' },
  title: { ...typography.headingM, color: colors.text, textAlign: 'center' },
  message: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: spacing[8], marginTop: spacing[8] },
});
