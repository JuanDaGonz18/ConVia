import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
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
import { Checkbox } from '@/components/ui/Checkbox';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { TextField } from '@/components/forms/TextField';
import { FaceVerificationModal } from '@/components/face/FaceVerificationModal';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { radius } from '@/constants/radius';
import { useAppStore } from '@/store/appStore';
import { authService } from '@/services/authService';
import { UserRole } from '@/types';
import { errorMessage, rawErrorMessage } from '@/utils/format';

function registerErrorMessage(error: unknown) {
  const raw = rawErrorMessage(error);
  if (raw.includes('DOMINIO_NO_PERMITIDO')) return 'Usa el correo de tu institución (por ejemplo @unisabana.edu.co).';
  if (raw.includes('CONFIRMACION_DE_CORREO_REQUERIDA')) return 'Te enviamos un correo de confirmación. Ábrelo desde este teléfono y luego inicia sesión.';
  if (/already registered/i.test(raw)) return 'Ya existe una cuenta con este correo. Inicia sesión.';
  if (/password/i.test(raw)) return 'La contraseña no cumple los requisitos de seguridad.';
  return errorMessage(error, 'Ocurrió un error al registrar la cuenta.');
}

export default function RegisterScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState<UserRole>('client');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Face verification state
  const [showFaceVerification, setShowFaceVerification] = useState(false);
  const [registeredUserId, setRegisteredUserId] = useState<string | null>(null);

  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const markFaceVerified = useAppStore((state) => state.markFaceVerified);

  const handleRegister = async () => {
    // The account already exists; only the identity check is pending.
    if (registeredUserId) {
      setError(null);
      setShowFaceVerification(true);
      return;
    }
    if (!name.trim()) {
      setError('Por favor ingresa tu nombre completo');
      return;
    }
    if (!email.trim()) {
      setError('Por favor ingresa tu correo electrónico');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Ingresa un correo electrónico válido');
      return;
    }
    if (!password.trim()) {
      setError('Por favor ingresa una contraseña');
      return;
    }
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    if (!acceptedTerms) {
      setError('Debes aceptar los términos y condiciones para continuar');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const newUser = await authService.register(
        name.trim(),
        email.trim().toLowerCase(),
        password,
        selectedRole
      );
      setCurrentUser(newUser);
      // Abrir verificación facial para capturar foto de referencia
      setRegisteredUserId(newUser.id);
      setShowFaceVerification(true);
    } catch (registerError) {
      setError(registerErrorMessage(registerError));
    } finally {
      setLoading(false);
    }
  };

  /** The server stored the registration selfie; the account is ready to use. */
  const handleFaceSuccess = () => {
    setShowFaceVerification(false);
    markFaceVerified();
    // A new driver still has to verify their license before publishing trips.
    router.replace(selectedRole === 'driver' ? '/driver-license' : '/(tabs)');
  };

  /** Keep the account out of the app until identity verification succeeds. */
  const handleFaceClose = () => {
    setShowFaceVerification(false);
    setError('La verificación facial es obligatoria para publicar o solicitar viajes. Puedes intentarlo de nuevo o hacerlo después desde tu perfil.');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Modal de verificación facial (se abre tras registro exitoso) */}
      {registeredUserId ? (
        <FaceVerificationModal
          visible={showFaceVerification}
          trigger="register"
          userId={registeredUserId}
          onSuccess={handleFaceSuccess}
          onFailure={() => undefined}
          onClose={handleFaceClose}
        />
      ) : null}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={styles.stepTitle}>{registeredUserId ? 'PASO 2 DE 2' : 'PASO 1 DE 2'}</Text>
            <Text style={styles.title}>{registeredUserId ? 'Verifica tu identidad' : 'Crea tu cuenta'}</Text>
            <ProgressBar progress={registeredUserId ? 1 : 0.5} />
          </View>

          <View style={styles.formCard}>
            {error ? (
              <View style={styles.errorBox}>
                <Ionicons color={colors.error} name="alert-circle-outline" size={20} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {registeredUserId ? (
              <View style={styles.stepTwo}>
                <Ionicons color={colors.primary} name="scan-circle-outline" size={48} />
                <Text style={styles.stepTwoText}>
                  Tu cuenta está creada. Tómate una selfie para registrar tu rostro: la usaremos para confirmar que eres tú antes de
                  cada viaje. La foto se analiza en tu teléfono y no se guarda.
                </Text>
              </View>
            ) : (
              <>
                <TextField
                  label="Nombre completo"
                  onChangeText={(text) => {
                    setName(text);
                    if (error) setError(null);
                  }}
                  placeholder="Ej. Juan Pérez"
                  value={name}
                />

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
                  placeholder="Mínimo 6 caracteres"
                  secureTextEntry
                  value={password}
                />

                <View style={styles.roleSection}>
                  <Text style={styles.roleTitle}>¿Cómo usarás WheelsApp?</Text>
                  <Text style={styles.roleHint}>Puedes cambiar de modo cuando quieras desde tu perfil.</Text>
                  <View style={styles.roleCardsRow}>
                    {(['client', 'driver'] as const).map((role) => {
                      const selected = selectedRole === role;
                      return (
                        <Pressable
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          key={role}
                          onPress={() => setSelectedRole(role)}
                          style={[styles.roleCard, selected ? styles.roleCardActive : null]}
                        >
                          <Ionicons
                            color={selected ? colors.primary : colors.textSecondary}
                            name={role === 'driver' ? 'car-sport' : 'person'}
                            size={28}
                          />
                          <Text style={[styles.roleCardLabel, selected ? styles.roleCardLabelActive : null]}>
                            {role === 'driver' ? 'Conductor' : 'Pasajero'}
                          </Text>
                          <Text style={styles.roleCardDesc}>{role === 'driver' ? 'Ofrecer cupos' : 'Buscar viajes'}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <Checkbox
                  checked={acceptedTerms}
                  label="Acepto los términos y condiciones de servicio y privacidad de WheelsApp"
                  onChange={(checked) => {
                    setAcceptedTerms(checked);
                    if (error) setError(null);
                  }}
                />
              </>
            )}

            <View style={styles.actions}>
              <ButtonPrimary
                loading={loading}
                onPress={handleRegister}
                title={registeredUserId ? 'Verificar identidad' : 'Crear cuenta'}
              />
              {registeredUserId ? (
                <ButtonSecondary
                  onPress={() => router.replace('/(tabs)')}
                  title="Verificar más tarde"
                />
              ) : (
                <ButtonSecondary
                  onPress={() => router.back()}
                  title="Ya tengo cuenta"
                />
              )}
            </View>
          </View>
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
    gap: spacing[20],
    paddingBottom: spacing[40],
    paddingHorizontal: dimensions.screenPadding,
    paddingTop: spacing[16],
  },
  header: {
    gap: spacing[8],
  },
  stepTitle: {
    ...typography.label,
    color: colors.primary,
  },
  title: {
    ...typography.headingXL,
    color: colors.text,
  },
  formCard: {
    backgroundColor: colors.white,
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    gap: spacing[16],
    padding: spacing[20],
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
  roleSection: {
    gap: spacing[8],
  },
  roleTitle: {
    ...typography.label,
    color: colors.text,
  },
  roleHint: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  roleCardsRow: {
    flexDirection: 'row',
    gap: spacing[12],
  },
  roleCard: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radius.radiusMedium,
    borderWidth: 1.5,
    flex: 1,
    gap: spacing[4],
    justifyContent: 'center',
    paddingVertical: spacing[16],
  },
  roleCardActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  roleCardLabel: {
    ...typography.bodyMedium,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  roleCardLabelActive: {
    color: colors.primary,
  },
  roleCardDesc: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  actions: {
    gap: spacing[12],
    marginTop: spacing[8],
  },
  stepTwo: {
    alignItems: 'center',
    gap: spacing[12],
    paddingVertical: spacing[8],
  },
  stepTwoText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
