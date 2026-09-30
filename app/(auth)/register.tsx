import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { CompanyCredit } from '@/components/brand/Brand';
import { FaceVerificationModal } from '@/components/face/FaceVerificationModal';
import { PasswordChecklist, PasswordField } from '@/components/forms/PasswordField';
import { TextField } from '@/components/forms/TextField';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { Checkbox } from '@/components/ui/Checkbox';
import { Notice } from '@/components/ui/Notice';
import { PressableScale } from '@/components/ui/PressableScale';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { authService } from '@/services/authService';
import { useAppStore } from '@/store/appStore';
import { UserRole } from '@/types';
import { errorMessage, rawErrorMessage } from '@/utils/format';
import { PASSWORD_RULES, passwordMeetsRules } from '@/utils/password';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Field = 'name' | 'email' | 'password' | 'confirm' | 'terms';

function registerErrorMessage(error: unknown) {
  const raw = rawErrorMessage(error);
  if (raw.includes('DOMINIO_NO_PERMITIDO')) return 'Ese correo no pertenece a una institución registrada. Usa tu correo institucional (por ejemplo @unisabana.edu.co).';
  if (raw.includes('CONFIRMACION_DE_CORREO_REQUERIDA')) return 'Te enviamos un correo de confirmación. Ábrelo desde este teléfono y luego inicia sesión.';
  if (/already registered/i.test(raw)) return 'Ya existe una cuenta con este correo. Inicia sesión con ella.';
  if (/password/i.test(raw)) return 'La contraseña no cumple los requisitos de seguridad.';
  return errorMessage(error, 'No pudimos crear tu cuenta. Revisa tu conexión e inténtalo de nuevo.');
}

/** Every problem with the form, so all of them are shown at once. */
function validate(values: { name: string; email: string; password: string; confirm: string; acceptedTerms: boolean }) {
  const errors: Partial<Record<Field, string>> = {};
  if (values.name.trim().length < 3) errors.name = 'Escribe tu nombre y apellido.';
  if (!values.email.trim()) errors.email = 'Escribe tu correo institucional.';
  else if (!EMAIL_PATTERN.test(values.email.trim())) errors.email = 'Ese correo no parece válido.';
  if (!values.password) errors.password = 'Crea una contraseña.';
  else if (!passwordMeetsRules(values.password)) {
    const failing = PASSWORD_RULES.filter((rule) => !rule.test(values.password)).map((rule) => rule.label.toLowerCase());
    errors.password = `Le falta: ${failing.join(', ')}.`;
  }
  if (!values.confirm) errors.confirm = 'Escribe la contraseña de nuevo para confirmarla.';
  else if (values.confirm !== values.password) errors.confirm = 'Las dos contraseñas no coinciden.';
  if (!values.acceptedTerms) errors.terms = 'Acepta los términos y condiciones.';
  return errors;
}

const FIELD_NAMES: Record<Field, string> = {
  name: 'Nombre completo',
  email: 'Correo institucional',
  password: 'Contraseña',
  confirm: 'Confirmación de la contraseña',
  terms: 'Términos y condiciones',
};

export default function RegisterScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [selectedRole, setSelectedRole] = useState<UserRole>('client');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showFaceVerification, setShowFaceVerification] = useState(false);
  const [registeredUserId, setRegisteredUserId] = useState<string | null>(null);

  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const markFaceVerified = useAppStore((state) => state.markFaceVerified);

  // After a first attempt, keep the list of problems in sync as the person fixes them.
  const refresh = (next: Partial<{ name: string; email: string; password: string; confirm: string; acceptedTerms: boolean }>) => {
    if (!submitted) return;
    setErrors(validate({ name, email, password, confirm, acceptedTerms, ...next }));
  };

  const handleRegister = async () => {
    // The account already exists; only the identity check is pending.
    if (registeredUserId) {
      setError(null);
      setShowFaceVerification(true);
      return;
    }
    const found = validate({ name, email, password, confirm, acceptedTerms });
    setSubmitted(true);
    setErrors(found);
    setError(null);
    if (Object.keys(found).length) return;

    setLoading(true);
    try {
      const newUser = await authService.register(name.trim(), email.trim().toLowerCase(), password, selectedRole);
      setCurrentUser(newUser);
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

  const handleFaceClose = () => {
    setShowFaceVerification(false);
    setError('Necesitas registrar tu rostro para pedir o publicar viajes. Puedes hacerlo ahora o más tarde desde tu perfil.');
  };

  const missing = Object.keys(errors) as Field[];

  return (
    <SafeAreaView style={styles.safeArea}>
      {registeredUserId ? (
        <FaceVerificationModal
          onClose={handleFaceClose}
          onFailure={() => undefined}
          onSuccess={handleFaceSuccess}
          trigger="register"
          userId={registeredUserId}
          visible={showFaceVerification}
        />
      ) : null}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader
            back={!registeredUserId}
            kicker={registeredUserId ? 'PASO 2 DE 2' : 'PASO 1 DE 2'}
            subtitle={registeredUserId ? 'Un último paso para viajar con tranquilidad.' : 'Solo te tomará un minuto.'}
            title={registeredUserId ? 'Verifica tu identidad' : 'Crea tu cuenta'}
          />
          <ProgressBar progress={registeredUserId ? 1 : 0.5} />

          <View style={styles.card}>
            {error ? <Notice onDismiss={() => setError(null)} tone="error">{error}</Notice> : null}

            {registeredUserId ? (
              <View style={styles.stepTwo}>
                <View style={styles.stepTwoIcon}>
                  <Ionicons color={colors.primary} name="scan-outline" size={36} />
                </View>
                <Text style={styles.stepTwoTitle}>¡Tu cuenta está lista!</Text>
                <Text style={styles.stepTwoText}>
                  Tómate una selfie para registrar tu rostro. La usamos para confirmar que eres tú antes de cada viaje, así todos
                  viajan más seguros. La foto se analiza en tu teléfono y no se guarda.
                </Text>
              </View>
            ) : (
              <>
                {missing.length ? (
                  <Notice title={`Te falta completar ${missing.length === 1 ? 'un dato' : `${missing.length} datos`}`} tone="warning">
                    <View style={styles.missingList}>
                      {missing.map((field) => (
                        <Text key={field} style={styles.missingItem}>• {FIELD_NAMES[field]}: {errors[field]}</Text>
                      ))}
                    </View>
                  </Notice>
                ) : null}

                <TextField
                  autoCapitalize="words"
                  autoComplete="name"
                  error={errors.name}
                  label="Nombre completo"
                  onChangeText={(text) => {
                    setName(text);
                    refresh({ name: text });
                  }}
                  placeholder="Ej. Laura Gómez"
                  value={name}
                />
                <TextField
                  autoCapitalize="none"
                  autoComplete="email"
                  error={errors.email}
                  hint="Solo correos de instituciones aliadas."
                  keyboardType="email-address"
                  label="Correo institucional"
                  onChangeText={(text) => {
                    setEmail(text);
                    refresh({ email: text });
                  }}
                  placeholder="nombre@unisabana.edu.co"
                  value={email}
                />
                <PasswordField
                  autoComplete="new-password"
                  error={errors.password}
                  label="Contraseña"
                  onChangeText={(text) => {
                    setPassword(text);
                    refresh({ password: text });
                  }}
                  placeholder="Crea una contraseña"
                  textContentType="newPassword"
                  value={password}
                />
                <PasswordField
                  autoComplete="new-password"
                  error={errors.confirm}
                  label="Confirma la contraseña"
                  onChangeText={(text) => {
                    setConfirm(text);
                    refresh({ confirm: text });
                  }}
                  placeholder="Escríbela de nuevo"
                  textContentType="newPassword"
                  value={confirm}
                />
                <PasswordChecklist confirm={confirm} password={password} />

                <View style={styles.roleSection}>
                  <Text style={styles.roleTitle}>¿Cómo usarás WheelsApp?</Text>
                  <Text style={styles.roleHint}>Con la misma cuenta puedes ser pasajero y conductor; cambias de modo cuando quieras.</Text>
                  <View style={styles.roleRow}>
                    {(['client', 'driver'] as const).map((role) => {
                      const selected = selectedRole === role;
                      return (
                        <PressableScale
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          key={role}
                          onPress={() => setSelectedRole(role)}
                          style={[styles.roleCard, selected ? styles.roleCardActive : null]}
                        >
                          {selected ? (
                            <Ionicons color={colors.primary} name="checkmark-circle" size={18} style={styles.roleCheck} />
                          ) : null}
                          <Ionicons color={selected ? colors.primary : colors.textSecondary} name={role === 'driver' ? 'car-sport' : 'person'} size={28} />
                          <Text style={[styles.roleLabel, selected ? styles.roleLabelActive : null]}>
                            {role === 'driver' ? 'Conductor' : 'Pasajero'}
                          </Text>
                          <Text style={styles.roleDesc}>{role === 'driver' ? 'Ofrece tus cupos' : 'Encuentra viajes'}</Text>
                        </PressableScale>
                      );
                    })}
                  </View>
                  {selectedRole === 'driver' ? (
                    <Text style={styles.roleHint}>Después del registro verificaremos tu licencia de conducción.</Text>
                  ) : null}
                </View>

                <View>
                  <Checkbox
                    checked={acceptedTerms}
                    label="Acepto los términos y condiciones y la política de privacidad de WheelsApp."
                    onChange={(checked) => {
                      setAcceptedTerms(checked);
                      refresh({ acceptedTerms: checked });
                    }}
                  />
                  {errors.terms ? <Text style={styles.termsError}>{errors.terms}</Text> : null}
                </View>
              </>
            )}

            <ButtonPrimary
              icon={registeredUserId ? 'scan-outline' : undefined}
              loading={loading}
              loadingTitle="Creando tu cuenta…"
              onPress={() => void handleRegister()}
              title={registeredUserId ? 'Verificar mi identidad' : 'Crear cuenta'}
            />
            {registeredUserId ? (
              <ButtonSecondary onPress={() => router.replace('/(tabs)')} title="Hacerlo más tarde" />
            ) : (
              <ButtonSecondary onPress={() => router.back()} title="Ya tengo una cuenta" />
            )}
          </View>

          <CompanyCredit />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surfaceMuted, flex: 1 },
  flex: { flex: 1 },
  content: { gap: spacing[16], paddingBottom: spacing[40], paddingHorizontal: dimensions.screenPadding, paddingTop: spacing[16] },
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
  missingList: { gap: 2 },
  missingItem: { ...typography.bodySmall, color: '#B54708' },
  roleSection: { gap: spacing[8] },
  roleTitle: { ...typography.label, color: colors.text },
  roleHint: { ...typography.caption, color: colors.textSecondary },
  roleRow: { flexDirection: 'row', gap: spacing[12] },
  roleCard: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.radiusLarge,
    borderWidth: 1.5,
    flex: 1,
    gap: spacing[4],
    paddingVertical: spacing[16],
  },
  roleCardActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  roleCheck: { position: 'absolute', right: 8, top: 8 },
  roleLabel: { ...typography.bodyMedium, color: colors.textSecondary, fontWeight: '700' },
  roleLabelActive: { color: colors.primary },
  roleDesc: { ...typography.caption, color: colors.textSecondary },
  termsError: { ...typography.caption, color: colors.error, marginLeft: 30 },
  stepTwo: { alignItems: 'center', gap: spacing[12], paddingVertical: spacing[8] },
  stepTwoIcon: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusFull,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  stepTwoTitle: { ...typography.headingM, color: colors.text },
  stepTwoText: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center' },
});
