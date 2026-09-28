import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { TextField } from '@/components/forms/TextField';
import { Checkbox } from '@/components/ui/Checkbox';
import { SavedUsersPanel } from '@/dev/SavedUsersPanel';
import { savedUsers } from '@/dev/savedUsers';
import { credentialStore } from '@/services/credentialStore';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { radius } from '@/constants/radius';
import { useAppStore } from '@/store/appStore';
import { authService } from '@/services/authService';
import { errorMessage } from '@/utils/format';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    if (!email.trim()) {
      setError('Por favor ingresa tu correo electrónico');
      return;
    }
    if (!password.trim()) {
      setError('Por favor ingresa tu contraseña');
      return;
    }

    setError(null);
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
      const message = loginError instanceof Error ? loginError.message : '';
      if (/invalid login credentials/i.test(message)) setError('Correo o contraseña incorrectos.');
      else if (/email not confirmed/i.test(message)) setError('Confirma tu correo antes de iniciar sesión.');
      else if (message.includes('SUPABASE_ENV_MISSING')) setError('La app no está configurada con Supabase.');
      else if (message.includes('PERFIL_NO_ENCONTRADO')) setError('Tu cuenta existe pero no tiene perfil en WheelsApp. Contacta al administrador.');
      else setError(errorMessage(loginError, 'No se pudo iniciar sesión. Revisa tu conexión e inténtalo de nuevo.'));
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = async (role: 'client' | 'driver') => {
    setError(null);
    setLoading(true);
    try {
      const demoUser = {
        id: role === 'driver' ? 'mock-driver-rita-c' : 'mock-user-current',
        name: role === 'driver' ? 'Rita Conductora' : 'Merchito Pasajero',
        email: role === 'driver' ? 'rita@wheelsapp.com' : 'merchito@wheelsapp.com',
        role,
      };
      setCurrentUser(demoUser);
      router.replace('/(tabs)');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <Ionicons color={colors.primary} name="car-sport" size={40} />
            </View>
            <Text style={styles.brandTitle}>WheelsApp</Text>
            <Text style={styles.subtitle}>
              Viajes compartidos seguros, económicos y confiables
            </Text>
          </View>

          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Iniciar sesión</Text>

            {error ? (
              <View style={styles.errorBox}>
                <Ionicons color={colors.error} name="alert-circle-outline" size={20} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <TextField
              autoCapitalize="none"
              keyboardType="email-address"
              label="Correo institucional"
              onChangeText={(text) => {
                setEmail(text);
                if (error) setError(null);
              }}
              placeholder="nombre@unisabana.edu.co"
              value={email}
            />

            <TextField
              label="Contraseña"
              onChangeText={(text) => {
                setPassword(text);
                if (error) setError(null);
              }}
              placeholder="••••••••"
              secureTextEntry
              value={password}
            />

            <Checkbox
              checked={rememberMe}
              label="Recordarme en este teléfono"
              onChange={setRememberMe}
            />

            <View style={styles.actions}>
              <ButtonPrimary
                loading={loading}
                onPress={handleLogin}
                title="Iniciar sesión"
              />
              <ButtonSecondary
                onPress={() => router.push('/(auth)/register')}
                title="Crear cuenta nueva"
              />
            </View>
          </View>

          {/* TEMPORARY: development-only account switcher (src/dev). */}
          <SavedUsersPanel
            onSelect={(savedEmail, savedPassword) => {
              setEmail(savedEmail);
              setPassword(savedPassword ?? '');
              setRememberMe(savedPassword !== null);
              setError(savedPassword ? null : 'Escribe la contraseña de esta cuenta (no se guardó con "Recordarme").');
            }}
          />

          {!useSupabase ? (
            <View style={styles.quickAccessSection}>
              <Text style={styles.quickAccessTitle}>Acceso rápido (demo)</Text>
              <View style={styles.quickButtons}>
                <ButtonSecondary
                  onPress={() => handleQuickLogin('client')}
                  title="Entrar como Pasajero"
                />
                <ButtonSecondary
                  onPress={() => handleQuickLogin('driver')}
                  title="Entrar como Conductor"
                />
              </View>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    gap: spacing[24],
    paddingBottom: spacing[40],
    paddingHorizontal: dimensions.screenPadding,
    paddingTop: spacing[24],
  },
  header: {
    alignItems: 'center',
    gap: spacing[8],
  },
  iconContainer: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusFull,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  brandTitle: {
    ...typography.headingXL,
    color: colors.primary,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  formCard: {
    backgroundColor: colors.white,
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    gap: spacing[16],
    padding: spacing[20],
  },
  formTitle: {
    ...typography.headingM,
    color: colors.text,
  },
  actions: {
    gap: spacing[12],
    marginTop: spacing[8],
  },
  errorBox: {
    alignItems: 'center',
    backgroundColor: '#FFEAEA',
    borderRadius: radius.radiusMedium,
    flexDirection: 'row',
    gap: spacing[8],
    padding: spacing[12],
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.error,
    flex: 1,
  },
  quickAccessSection: {
    gap: spacing[12],
  },
  quickAccessTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  quickButtons: {
    gap: spacing[12],
  },
});
