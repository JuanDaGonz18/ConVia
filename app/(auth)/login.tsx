import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, type TextInputInstance, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { MicrosoftSignInButton } from '@/components/auth/MicrosoftSignInButton';
import { BrandLogo } from '@/components/brand/Brand';
import { PasswordField } from '@/components/forms/PasswordField';
import { TextField } from '@/components/forms/TextField';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { Notice } from '@/components/ui/Notice';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { SavedUsersPanel } from '@/dev/SavedUsersPanel';
import { savedUsers } from '@/dev/savedUsers';
import i18n from '@/i18n';
import { authService, isMicrosoftAuthEnabled } from '@/services/authService';
import { useAppStore } from '@/store/appStore';
import { errorMessage, rawErrorMessage } from '@/utils/format';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldErrors = { email?: string; password?: string };

function loginErrorMessage(error: unknown) {
  const raw = rawErrorMessage(error);
  if (/invalid login credentials/i.test(raw)) return i18n.t('auth.login.errors.invalidCredentials');
  if (/email not confirmed/i.test(raw)) return i18n.t('auth.login.errors.emailNotConfirmed');
  if (raw.includes('PERFIL_NO_ENCONTRADO')) return i18n.t('auth.login.errors.profileMissing');
  return errorMessage(error, i18n.t('auth.login.errors.generic'));
}

export default function LoginScreen() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [microsoftLoading, setMicrosoftLoading] = useState(false);
  const passwordRef = useRef<TextInputInstance>(null);

  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const useSupabase = process.env.EXPO_PUBLIC_USE_SUPABASE === 'true';

  const handleLogin = async () => {
    // Every missing field at once, not one per attempt.
    const errors: FieldErrors = {};
    if (!email.trim()) errors.email = t('auth.emailRequired');
    else if (!EMAIL_PATTERN.test(email.trim())) errors.email = t('auth.emailInvalid');
    if (!password) errors.password = t('auth.login.passwordRequired');
    setFieldErrors(errors);
    setError(null);
    if (errors.email || errors.password) return;

    setLoading(true);
    try {
      const address = email.trim().toLowerCase();
      const user = await authService.login(address, password);
      // The password is never stored: the Supabase session (refresh token) keeps the user signed in.
      if (__DEV__) await savedUsers.add({ email: address, name: user.name, role: user.role }); // TEMPORARY (src/dev)
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
            <Text style={styles.tagline}>{t('auth.login.tagline')}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('auth.login.title')}</Text>

            {error ? <Notice onDismiss={() => setError(null)} tone="error">{error}</Notice> : null}

            <TextField
              autoCapitalize="none"
              autoComplete="email"
              error={fieldErrors.email}
              keyboardType="email-address"
              label={t('auth.emailLabel')}
              onChangeText={(text) => {
                setEmail(text);
                if (fieldErrors.email) setFieldErrors((current) => ({ ...current, email: undefined }));
              }}
              onSubmitEditing={() => passwordRef.current?.focus()}
              placeholder={t('auth.emailPlaceholder')}
              returnKeyType="next"
              value={email}
            />
            <PasswordField
              autoComplete="current-password"
              error={fieldErrors.password}
              label={t('auth.login.passwordLabel')}
              onChangeText={(text) => {
                setPassword(text);
                if (fieldErrors.password) setFieldErrors((current) => ({ ...current, password: undefined }));
              }}
              onSubmitEditing={() => void handleLogin()}
              placeholder={t('auth.login.passwordPlaceholder')}
              ref={passwordRef}
              returnKeyType="go"
              value={password}
            />
            <View style={styles.forgotRow}>
              <Pressable
                accessibilityRole="link"
                hitSlop={8}
                onPress={() => router.push({ pathname: '/(auth)/forgot-password', params: email.trim() ? { email: email.trim() } : {} })}
              >
                <Text style={styles.forgot}>{t('auth.login.forgot')}</Text>
              </Pressable>
            </View>

            <ButtonPrimary disabled={microsoftLoading} loading={loading} loadingTitle={t('auth.login.submitting')} onPress={() => void handleLogin()} title={t('auth.login.submit')} />

            {useSupabase && isMicrosoftAuthEnabled ? (
              <MicrosoftSignInButton
                disabled={loading}
                onBusyChange={setMicrosoftLoading}
                onError={setError}
                title={t('auth.login.microsoft')}
              />
            ) : null}
          </View>

          <View style={styles.divider}>
            <View style={styles.line} />
            <Text style={styles.dividerText}>{t('auth.login.firstTime')}</Text>
            <View style={styles.line} />
          </View>
          <ButtonSecondary icon="person-add-outline" onPress={() => router.push('/(auth)/register')} title={t('auth.login.createAccount')} />

          {/* TEMPORARY: development-only account switcher (src/dev); never in release builds. */}
          {__DEV__ ? (
            <SavedUsersPanel
              onSelect={(savedEmail) => {
                setEmail(savedEmail);
                setPassword('');
                setFieldErrors({});
                passwordRef.current?.focus();
              }}
            />
          ) : null}

          {!useSupabase ? (
            <View style={styles.demo}>
              <Text style={styles.demoTitle}>{t('auth.login.demoTitle')}</Text>
              <ButtonSecondary onPress={() => handleQuickLogin('client')} title={t('auth.login.demoPassenger')} />
              <ButtonSecondary onPress={() => handleQuickLogin('driver')} title={t('auth.login.demoDriver')} />
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
  forgotRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'flex-end' },
  forgot: { ...typography.bodySmall, color: colors.primary, fontWeight: '600' },
  demo: { gap: spacing[8] },
  demoTitle: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', textTransform: 'uppercase' },
});
