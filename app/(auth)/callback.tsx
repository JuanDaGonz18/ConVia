import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useLinkingURL } from 'expo-linking';
import { useTranslation } from 'react-i18next';

import { BrandLogo } from '@/components/brand/Brand';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { Notice } from '@/components/ui/Notice';

import { colors } from '@/constants/colors';
import { acceptTermsIfNeeded, authService, exchangeAuthCode, MICROSOFT_CALLBACK_FLAG } from '@/services/authService';
import { useAppStore } from '@/store/appStore';
import { authLinkErrorMessage, microsoftErrorMessage, parseAuthLink } from '@/utils/authLink';
import { errorMessage } from '@/utils/format';

export default function AuthCallbackScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ code?: string; error?: string; error_code?: string; error_description?: string; via?: string }>();
  // Failures (expired or reused links) arrive in the URL fragment, which route params don't include.
  const link = parseAuthLink(useLinkingURL(), params);
  const code = link.code;
  // The web build comes back here from Microsoft (see authService.signInWithMicrosoft).
  const fromMicrosoft = params.via === MICROSOFT_CALLBACK_FLAG;
  const callbackError = link.errorCode ? (fromMicrosoft ? microsoftErrorMessage(link) : authLinkErrorMessage(link)) : null;
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const [error, setError] = useState<string | null>(
    callbackError ?? (code ? null : t('auth.callback.invalidLink')),
  );
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (!code || callbackError) return;
    void exchangeAuthCode(code).then(async () => {
      const user = await authService.getCurrentUser();
      if (!user) {
        setError(t(fromMicrosoft ? 'auth.callback.noProfileMicrosoft' : 'auth.callback.noProfile'));
        return;
      }
      if (fromMicrosoft) await acceptTermsIfNeeded(user.id);
      setCurrentUser(user);
      setComplete(true);
    }).catch((exchangeError: unknown) => {
      setError(errorMessage(exchangeError, t(fromMicrosoft ? 'auth.callback.microsoftFailed' : 'auth.callback.invalidOrUsed')));
    });
  }, [callbackError, code, fromMicrosoft, setCurrentUser, t]);

  if (complete) return <Redirect href="/(tabs)" />;

  // The link's own error wins: the URL (and its fragment) can arrive after the first render.
  const shownError = callbackError ?? error;

  return (
    <View style={styles.container}>
      <BrandLogo size="md" />
      {shownError ? <Notice title={t('auth.callback.failedTitle')} tone="error">{shownError}</Notice> : <ActivityIndicator color={colors.primary} size="large" />}
      <Text style={styles.message}>
        {t(!shownError ? 'auth.callback.working' : fromMicrosoft ? 'auth.callback.retryMicrosoft' : 'auth.callback.retryLogin')}
      </Text>
      {shownError ? <ButtonPrimary onPress={() => router.replace('/(auth)/login')} title={t('auth.callback.goToLogin')} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', backgroundColor: colors.background, flex: 1, gap: 16, justifyContent: 'center', padding: 24 },
  error: { color: colors.error, textAlign: 'center' },
  message: { color: colors.textSecondary, textAlign: 'center' },
});