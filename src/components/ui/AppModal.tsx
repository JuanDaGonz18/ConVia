import { Modal, StyleSheet, View } from 'react-native';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';

type AppModalProps = {
  visible: boolean;
  children: React.ReactNode;
  onRequestClose?: () => void;
};

export function AppModal({ visible, children, onRequestClose }: AppModalProps) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onRequestClose}
      transparent
      visible={visible}
    >
      <View style={styles.overlay}>
        <View style={styles.panel}>{children}</View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: 'rgba(31, 32, 36, 0.28)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  panel: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.radiusXL,
    borderTopRightRadius: radius.radiusXL,
    padding: spacing[24],
  },
});
