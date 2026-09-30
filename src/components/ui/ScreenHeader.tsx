import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

type ScreenHeaderProps = Readonly<{
  /** Small uppercase context line, e.g. "CONDUCTOR". */
  kicker?: string;
  title: string;
  subtitle?: string;
  /** Hide the back button on root screens. */
  back?: boolean;
  onBack?: () => void;
  /** Extra element on the right of the back row. */
  right?: ReactNode;
}>;

/** Consistent top of every stacked screen: back, context, title and a short explanation. */
export function ScreenHeader({ kicker, title, subtitle, back = true, onBack, right }: ScreenHeaderProps) {
  const goBack = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/(tabs)')));
  return (
    <View style={styles.container}>
      {back || right ? (
        <View style={styles.row}>
          {back ? (
            <Pressable accessibilityLabel="Volver" accessibilityRole="button" hitSlop={8} onPress={goBack} style={styles.back}>
              <Ionicons color={colors.text} name="chevron-back" size={24} />
            </Pressable>
          ) : <View />}
          {right}
        </View>
      ) : null}
      {kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing[4] },
  row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing[8] },
  back: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.radiusFull,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  kicker: { ...typography.caption, color: colors.primary, fontWeight: '700', letterSpacing: 1 },
  title: { ...typography.headingL, color: colors.text },
  subtitle: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
});
