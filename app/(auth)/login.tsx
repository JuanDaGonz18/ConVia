import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandLogo } from '@/components/brand/Brand';
import { PasswordField } from '@/components/forms/PasswordField';
import { TextField } from '@/components/forms/TextField';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { Checkbox } from '@/components/ui/Checkbox';
import { Notice } from '@/components/ui/Notice';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { SavedUsersPanel } from '@/dev/SavedUsersPanel';
import { savedUsers } from '@/dev/savedUsers';
import { authService } from '@/services/authService';
import { credentialStore } from '@/services/credentialStore';
import { useAppStore } from '@/store/appStore';
import { errorMessage, rawErrorMessage } from '@/utils/format';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldErrors = { email?: string; password?: string };

function loginErrorMessage(error: unknown) {
  const raw = rawErrorMessage(error);
  if (/invalid login credentials/i.test(raw)) return 'El correo o la contraseña no coinciden. Revísalos e inténtalo de nuevo.';
  if (/email not confirmed/i.test(raw)) return 'Aún no has confirmado tu correo. Abre el enlace que te enviamos al registrarte.';
  if (raw.includes('PERFIL_NO_ENCONTRADO')) return 'Tu cuenta existe pero no tiene perfil en ConVía. Escríbele al administrador de tu institución.';
  return errorMessage(error, 'No pudimos iniciar sesión. Revisa tu conexión e inténtalo de nuevo.');
}

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const useSupabase = process.env.EXPO_PUBLIC_USE_SUPABASE === 'true';

  // Fill the form with the account saved with "Recordarme".
  useEffect(() => {
    let active = true;
    void credentialStore.getRemembered().then((saved) => {
      if (!active || !saved) return;
      setEmail((current) => current || saved.email);
      setPassword((current) => current || saved.password);
      setRememberMe(true);
    });
    return () => { active = false; };
  }, []);

  const handleLogin = async () => {
    // Every missing field at once, not one per attempt.
    const errors: FieldErrors = {};
    if (!email.trim()) errors.email = 'Escribe tu correo institucional.';
    else if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Ese correo no parece válido.';
    if (!password) errors.password = 'Escribe tu contraseña.';
    setFieldErrors(errors);
    setError(null);
    if (errors.email || errors.password) return;

    setLoading(true);
    try {
      const address = email.trim().toLowerCase();
      const user = await authService.login(address, password);
      // Only after a successful sign-in: never store credentials that don't work.
      if (rememberMe) await credentialStore.remember(address, password);
      else await credentialStore.forget(address);
      await savedUsers.add({ email: address, name: user.name, role: user.role }); // TEMPORARY (src/dev)
      setCurrentUser(user);
      router.replace('/(tabs)');
    } catch (loginError) {
      setError(loginErrorMessage(loginError));
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = (role: 'client' | 'driver') => {
    setCurrentUser({
      id: role === 'driver' ? 'mock-driver-rita-c' : 'mock-user-current',
      name: role === 'driver' ? 'Rita Conductora' : 'Merchito Pasajero',
      email: role === 'driver' ? 'rita@convia.app' : 'merchito@convia.app',
      role,
    });
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <BrandLogo size="lg" />
            <Text style={styles.tagline}>Comparte el camino con tu comunidad universitaria.</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Inicia sesión</Text>

            {error ? <Notice onDismiss={() => setError(null)} tone="error">{error}</Notice> : null}

            <TextField
              autoCapitalize="none"
              autoComplete="email"
              error={fieldErrors.email}
              keyboardType="email-address"
              label="Correo institucional"
              onChangeText={(text) => {
                setEmail(text);
                if (fieldErrors.email) setFieldErrors((current) => ({ ...current, email: undefined }));
              }}
              onSubmitEditing={() => passwordRef.current?.focus()}
              placeholder="nombre@unisabana.edu.co"
              returnKeyType="next"
              value={email}
            />
            <PasswordField
              autoComplete="current-password"
              error={fieldErrors.password}
              label="Contraseña"
              onChangeText={(text) => {
                setPassword(text);
                if (fieldErrors.password) setFieldErrors((current) => ({ ...current, password: undefined }));
              }}
              onSubmitEditing={() => void handleLogin()}
              placeholder="Tu contraseña"
              ref={passwordRef}
              returnKeyType="go"
              value={password}
            />
            {/* The web build never stores passwords (no secure keychain in browsers). */}
            {Platform.OS !== 'web' ? <Checkbox checked={rememberMe} label="Recordarme en este teléfono" onChange={setRememberMe} /> : null}

            <ButtonPrimary loading={loading} loadingTitle="Entrando…" onPress={() => void handleLogin()} title="Iniciar sesión" />
          </View>

          <View style={styles.divider}>
            <View style={styles.line} />
            <Text style={styles.dividerText}>¿Primera vez en ConVía?</Text>
            <View style={styles.line} />
          </View>
          <ButtonSecondary icon="person-add-outline" onPress={() => router.push('/(auth)/register')} title="Crear una cuenta" />

          {/* TEMPORARY: development-only account switcher (src/dev). */}
          <SavedUsersPanel
            onSelect={(savedEmail, savedPassword) => {
              setEmail(savedEmail);
              setPassword(savedPassword ?? '');
              setRememberMe(savedPassword !== null);
              setFieldErrors(savedPassword ? {} : { password: 'Escribe la contraseña de esta cuenta (no se guardó con "Recordarme").' });
            }}
          />

          {!useSupabase ? (
            <View style={styles.demo}>
              <Text style={styles.demoTitle}>Modo demostración</Text>
              <ButtonSecondary onPress={() => handleQuickLogin('client')} title="Entrar como pasajero" />
              <ButtonSecondary onPress={() => handleQuickLogin('driver')} title="Entrar como conductor" />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surfaceMuted, flex: 1 },
  flex: { flex: 1 },
  content: { gap: spacing[20], paddingBottom: spacing[40], paddingHorizontal: dimensions.screenPadding, paddingTop: spacing[32] },
  hero: { alignItems: 'center', gap: spacing[12] },
  tagline: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.radiusXL,
    elevation: 2,
    gap: spacing[16],
    padding: spacing[20],
    shadowColor: '#000',
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
  },
  cardTitle: { ...typography.headingM, color: colors.text },
  divider: { alignItems: 'center', flexDirection: 'row', gap: spacing[12] },
  line: { backgroundColor: colors.lightGray, flex: 1, height: 1 },
  dividerText: { ...typography.caption, color: colors.textSecondary },
  demo: { gap: spacing[8] },
  demoTitle: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', textTransform: 'uppercase' },
});
