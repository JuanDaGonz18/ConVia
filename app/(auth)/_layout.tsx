import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';

export default function AuthLayout() {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      />
      {/* Language can be changed before signing in, on every auth screen. */}
      <LanguageToggle style={[styles.toggle, { top: insets.top + spacing[8] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  toggle: { position: 'absolute', right: spacing[16] },
});
