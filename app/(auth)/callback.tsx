import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';

import { colors } from '@/constants/colors';
import { authService } from '@/services/authService';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/appStore';

export default function AuthCallbackScreen() {
  const { code, error: callbackError } = useLocalSearchParams<{ code?: string; error?: string }>();
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const [error, setError] = useState<string | null>(
    callbackError ?? (code ? null : 'El enlace de confirmación no es válido o ya fue usado.'),
  );
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (!code || callbackError) return;
    void supabase.auth.exchangeCodeForSession(code).then(async ({ error: exchangeError }) => {
      if (exchangeError) {
        setError(exchangeError.message);
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
      setError(exchangeError instanceof Error ? exchangeError.message : 'No se pudo confirmar el correo.');
    });
  }, [callbackError, code, setCurrentUser]);

  if (complete) return <Redirect href="/(tabs)" />;

  return (
    <View style={styles.container}>
      {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.primary} size="large" />}
      <Text style={styles.message}>{error ? 'Regresa a iniciar sesión para continuar.' : 'Confirmando tu correo...'}</Text>
      {error ? <ButtonPrimary onPress={() => router.replace('/(auth)/login')} title="Ir a iniciar sesión" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', backgroundColor: colors.background, flex: 1, gap: 16, justifyContent: 'center', padding: 24 },
  error: { color: colors.error, textAlign: 'center' },
  message: { color: colors.textSecondary, textAlign: 'center' },
});