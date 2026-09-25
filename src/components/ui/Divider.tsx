import { StyleSheet, View } from 'react-native';

import { colors } from '@/constants/colors';

export function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  divider: {
    backgroundColor: colors.lightGray,
    height: StyleSheet.hairlineWidth,
    width: '100%',
  },
});
