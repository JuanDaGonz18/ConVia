import { StyleSheet, View } from 'react-native';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';

type DrawerProps = {
  children: React.ReactNode;
};

export function Drawer({ children }: DrawerProps) {
  return (
    <View style={styles.drawer}>
      <View style={styles.handle} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  drawer: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.radiusXL,
    borderTopRightRadius: radius.radiusXL,
    gap: spacing[16],
    padding: spacing[24],
  },
  handle: {
    alignSelf: 'center',
    backgroundColor: colors.border,
    borderRadius: radius.radiusFull,
    height: 4,
    width: 48,
  },
});
