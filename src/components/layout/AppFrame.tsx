import type { ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';

/**
 * On the web the app is a centered, phone-width column, so on a computer
 * forms, photos and lists don't stretch across the whole screen. On phones it
 * renders its children as they are.
 */
export function AppFrame({ children }: Readonly<{ children: ReactNode }>) {
  if (Platform.OS !== 'web') return children;
  return (
    <View style={styles.page}>
      <View style={styles.column}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { alignItems: 'center', backgroundColor: colors.surfaceMuted, flex: 1 },
  column: {
    backgroundColor: colors.background,
    borderColor: colors.lightGray,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    flex: 1,
    maxWidth: dimensions.webMaxWidth,
    overflow: 'hidden',
    width: '100%',
  },
});
