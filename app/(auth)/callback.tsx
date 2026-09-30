import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useLinkingURL } from 'expo-linking';

import { BrandMark } from '@/components/brand/Brand';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { Notice } from '@/components/ui/Notice';

import { colors } from '@/constants/colors';
import { authService } from '@/services/authService';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/appStore';
import { authLinkErrorMessage, parseAuthLink } from '@/utils/authLink';
import { errorMessage } from '@/utils/format';

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{ code?: string; error?: string; error_code?: string; error_description?: string }>();
  // Failures (expired or reused links) arrive in the URL fragment, which route params don't include.
  const link = parseAuthLink(useLinkingURL(), params);
  const code = link.code;
  const callbackError = link.errorCode ? authLinkErrorMessage(link) : null;
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const [error, setError] = useState<string | null>(
    callbackError ?? (code ? null : 'El enlace de confirmación no es válido o ya fue usado.'),
  );
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (!code || callbackError) return;
    void supabase.auth.exchangeCodeForSession(code).then(async ({ error: exchangeError }) => {
      if (exchangeError) {
        setError(errorMessage(exchangeError, 'El enlace de confirmación no es válido o ya fue usado.'));
        return;
      }
      const user = await authService.getCurrentUser();
      if (!user) {
        setError('No se encontró el perfil después de confirmar el correo.');
        return;
      }
      setCurrentUser(user);
      setComplete(true);
    }).catch((exchangeError: unknown) => {
      setError(errorMessage(exchangeError, 'No se pudo confirmar el correo.'));
    });
  }, [callbackError, code, setCurrentUser]);

  if (complete) return <Redirect href="/(tabs)" />;

  // The link's own error wins: the URL (and its fragment) can arrive after the first render.
  const shownError = callbackError ?? error;

  return (
    <View style={styles.container}>
      <BrandMark size="lg" />
      {shownError ? <Notice title="No pudimos confirmar tu correo" tone="error">{shownError}</Notice> : <ActivityIndicator color={colors.primary} size="large" />}
      <Text style={styles.message}>{shownError ? 'Inicia sesión para continuar; si tu cuenta ya estaba confirmada, entrarás sin problema.' : 'Confirmando tu correo…'}</Text>
      {shownError ? <ButtonPrimary onPress={() => router.replace('/(auth)/login')} title="Ir a iniciar sesión" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', backgroundColor: colors.background, flex: 1, gap: 16, justifyContent: 'center', padding: 24 },
  error: { color: colors.error, textAlign: 'center' },
  message: { color: colors.textSecondary, textAlign: 'center' },
});