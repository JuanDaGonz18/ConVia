import { Ionicons } from '@expo/vector-icons';
import type { ErrorBoundaryProps } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

/**
 * What the user sees instead of a blank screen (web) or a crash (phone) when a screen throws
 * while rendering. Exported as the root layout's ErrorBoundary, so it replaces the whole app
 * shell: it brings its own SafeAreaProvider. "Try again" re-renders the screen; the error text
 * is shown only in development builds.
 */
export function AppErrorFallback({ error, retry }: ErrorBoundaryProps) {
  const { t } = useTranslation();
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <View accessibilityRole="alert" style={styles.content}>
          <Ionicons color={colors.error} name="alert-circle-outline" size={48} />
          <Text style={styles.title}>{t('errorBoundary.title')}</Text>
          <Text style={styles.body}>{t('errorBoundary.body')}</Text>
          {__DEV__ ? <Text style={styles.detail}>{error.message}</Text> : null}
          <ButtonPrimary icon="refresh" onPress={() => void retry()} title={t('errorBoundary.retry')} />
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing[16], padding: spacing[24], maxWidth: 480, width: '100%', alignSelf: 'center' },
  title: { ...typography.headingM, color: colors.text, textAlign: 'center' },
  body: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  detail: { ...typography.caption, color: colors.error, textAlign: 'center' },
});
