import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useLinkingURL } from 'expo-linking';
import { useTranslation } from 'react-i18next';

import { BrandLogo } from '@/components/brand/Brand';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { Notice } from '@/components/ui/Notice';

import { colors } from '@/constants/colors';
import { authService, EMAIL_LINK_TYPES, type EmailLinkType, exchangeAuthCode, RESET_PASSWORD_NEXT, verifyEmailLink } from '@/services/authService';
import { useAppStore } from '@/store/appStore';
import { authLinkErrorMessage, parseAuthLink } from '@/utils/authLink';
import { errorMessage } from '@/utils/format';

export default function AuthCallbackScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ code?: string; error?: string; error_code?: string; error_description?: string; next?: string; token_hash?: string; type?: string }>();
  // Links from ConVía e-mails carry token_hash + type and wait for a tap (see verifyEmailLink).
  const linkType = (EMAIL_LINK_TYPES as readonly string[]).includes(params.type ?? '') ? params.type as EmailLinkType : null;
  const tokenHash = linkType ? params.token_hash ?? null : null;
  // A password-reset link signs the user in, then they choose the new password.
  const resettingPassword = params.next === RESET_PASSWORD_NEXT || linkType === 'recovery';
  // Failures (expired or reused links) arrive in the URL fragment, which route params don't include.
  const link = parseAuthLink(useLinkingURL(), params);
  const code = link.code;
  const callbackError = link.errorCode ? authLinkErrorMessage(link) : null;
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const [error, setError] = useState<string | null>(
    callbackError ?? (code || tokenHash ? null : t('auth.callback.invalidLink')),
  );
  const [complete, setComplete] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const signedIn = async () => {
    const user = await authService.getCurrentUser();
    if (!user) {
      setError(t('auth.callback.noProfile'));
      return;
    }
    setCurrentUser(user);
    setComplete(true);
  };

  const confirmEmailLink = async () => {
    if (!tokenHash || !linkType) return;
    setConfirming(true);
    try {
      await verifyEmailLink(tokenHash, linkType);
      await signedIn();
    } catch (verifyError) {
      setError(errorMessage(verifyError, t('auth.callback.invalidOrUsed')));
    } finally {
      setConfirming(false);
    }
  };

  useEffect(() => {
    if (!code || callbackError) return;
    void exchangeAuthCode(code).then(signedIn).catch((exchangeError: unknown) => {
      setError(errorMessage(exchangeError, t('auth.callback.invalidOrUsed')));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signedIn only uses stable setters and these values
  }, [callbackError, code, setCurrentUser, t]);

  if (complete) return <Redirect href={resettingPassword ? '/(auth)/reset-password' : '/(tabs)'} />;

  // The link's own error wins: the URL (and its fragment) can arrive after the first render.
  const shownError = callbackError ?? error;

  if (tokenHash && linkType && !shownError) {
    return (
      <View style={styles.container}>
        <BrandLogo size="md" />
        <Text style={styles.title}>{t(`auth.callback.link.${linkType}.title`)}</Text>
        <Text style={styles.message}>{t(`auth.callback.link.${linkType}.text`)}</Text>
        <ButtonPrimary loading={confirming} onPress={() => void confirmEmailLink()} title={t(`auth.callback.link.${linkType}.button`)} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <BrandLogo size="md" />
      {shownError ? <Notice title={t('auth.callback.failedTitle')} tone="error">{shownError}</Notice> : <ActivityIndicator color={colors.primary} size="large" />}
      <Text style={styles.message}>
        {t(!shownError ? 'auth.callback.working' : 'auth.callback.retryLogin')}
      </Text>
      {shownError && resettingPassword ? <ButtonPrimary onPress={() => router.replace('/(auth)/forgot-password')} title={t('auth.callback.askAgain')} /> : null}
      {shownError ? <ButtonPrimary onPress={() => router.replace('/(auth)/login')} title={t('auth.callback.goToLogin')} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', backgroundColor: colors.background, flex: 1, gap: 16, justifyContent: 'center', padding: 24 },
  error: { color: colors.error, textAlign: 'center' },
  message: { color: colors.textSecondary, textAlign: 'center' },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', textAlign: 'center' },
});