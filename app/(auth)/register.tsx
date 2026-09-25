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
import { faceVerificationService } from '@/services/faceVerificationService';
import { FaceVerificationResult, UserRole } from '@/types';

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

  const { setCurrentUser, markUserFaceVerified } = useAppStore();

  const handleRegister = async () => {
    if (!name.trim()) {
      setError('Por favor ingresa tu nombre completo');
      return;
    }
    if (!email.trim()) {
      setError('Por favor ingresa tu correo electrónico');
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
        email.trim(),
        selectedRole
      );
      setCurrentUser(newUser);
      // Abrir verificación facial para capturar foto de referencia
      setRegisteredUserId(newUser.id);
      setShowFaceVerification(true);
    } catch {
      setError('Ocurrió un error al registrar la cuenta.');
    } finally {
      setLoading(false);
    }
  };

  /** Éxito en verificación facial de registro */
  const handleFaceSuccess = async (result: FaceVerificationResult) => {
    setShowFaceVerification(false);
    if (!registeredUserId) {
      router.replace('/(tabs)');
      return;
    }
    try {
      // Registrar referencia facial en el backend
      const { faceReferenceId } = await faceVerificationService.registerFaceReference({
        userId: registeredUserId,
        imageBase64: result.sessionId ?? registeredUserId,
      });
      markUserFaceVerified(faceReferenceId);
    } catch {
      // No bloqueamos el registro si falla el guardado de referencia
      console.warn('[Register] No se pudo guardar la referencia facial');
    }
    router.replace('/(tabs)');
  };

  /** El usuario cerró o falló la verificación; navegamos igual */
  const handleFaceClose = () => {
    setShowFaceVerification(false);
    router.replace('/(tabs)');
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
          onFailure={handleFaceClose}
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
            <Text style={styles.stepTitle}>Registro</Text>
            <Text style={styles.title}>Crea una cuenta</Text>
            <ProgressBar progress={0.65} />
          </View>

          <View style={styles.formCard}>
            {error ? (
              <View style={styles.errorBox}>
                <Ionicons color={colors.error} name="alert-circle-outline" size={20} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

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
              label="Correo electrónico"
              onChangeText={(text) => {
                setEmail(text);
                if (error) setError(null);
              }}
              placeholder="ejemplo@correo.com"
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
              <Text style={styles.roleTitle}>Escoge tu rol:</Text>
              <View style={styles.roleCardsRow}>
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: selectedRole === 'client' }}
                  onPress={() => setSelectedRole('client')}
                  style={[
                    styles.roleCard,
                    selectedRole === 'client' ? styles.roleCardActive : null,
                  ]}
                >
                  <Ionicons
                    color={
                      selectedRole === 'client' ? colors.primary : colors.textSecondary
                    }
                    name="person"
                    size={28}
                  />
                  <Text
                    style={[
                      styles.roleCardLabel,
                      selectedRole === 'client' ? styles.roleCardLabelActive : null,
                    ]}
                  >
                    Pasajero
                  </Text>
                  <Text style={styles.roleCardDesc}>Buscar viajes</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: selectedRole === 'driver' }}
                  onPress={() => setSelectedRole('driver')}
                  style={[
                    styles.roleCard,
                    selectedRole === 'driver' ? styles.roleCardActive : null,
                  ]}
                >
                  <Ionicons
                    color={
                      selectedRole === 'driver' ? colors.primary : colors.textSecondary
                    }
                    name="car-sport"
                    size={28}
                  />
                  <Text
                    style={[
                      styles.roleCardLabel,
                      selectedRole === 'driver' ? styles.roleCardLabelActive : null,
                    ]}
                  >
                    Conductor
                  </Text>
                  <Text style={styles.roleCardDesc}>Ofrecer asientos</Text>
                </Pressable>
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

            <View style={styles.actions}>
              <ButtonPrimary
                loading={loading}
                onPress={handleRegister}
                title="Crear cuenta"
              />
              <ButtonSecondary
                onPress={() => router.back()}
                title="Ya tengo cuenta (Iniciar sesión)"
              />
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
});
