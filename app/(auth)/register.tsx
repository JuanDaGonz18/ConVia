import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { MicrosoftSignInButton } from '@/components/auth/MicrosoftSignInButton';
import { FaceVerificationModal } from '@/components/face/FaceVerificationModal';
import { FieldError } from '@/components/forms/FieldError';
import { PasswordChecklist, PasswordField } from '@/components/forms/PasswordField';
import { TextField } from '@/components/forms/TextField';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { Checkbox } from '@/components/ui/Checkbox';
import { Notice } from '@/components/ui/Notice';
import { PressableScale } from '@/components/ui/PressableScale';
import { InstitutionDomainHint } from '@/components/auth/InstitutionDomainHint';
import { EMAIL_PATTERN } from '@/utils/emailDomain';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import i18n from '@/i18n';
import { authService, isMicrosoftAuthEnabled } from '@/services/authService';
import { useAppStore } from '@/store/appStore';
import { UserRole } from '@/types';
import { errorMessage, rawErrorMessage } from '@/utils/format';
import { missingPasswordRules, passwordMeetsRules } from '@/utils/password';


type Field = 'name' | 'email' | 'password' | 'confirm' | 'terms';

function registerErrorMessage(error: unknown) {
  const raw = rawErrorMessage(error);
  if (raw.includes('DOMINIO_NO_PERMITIDO')) return i18n.t('auth.register.errors.domain');
  if (raw.includes('CONFIRMACION_DE_CORREO_REQUERIDA')) return i18n.t('auth.register.errors.confirmationSent');
  if (/already registered/i.test(raw)) return i18n.t('auth.register.errors.alreadyRegistered');
  if (/password/i.test(raw)) return i18n.t('auth.register.errors.weakPassword');
  return errorMessage(error, i18n.t('auth.register.errors.generic'));
}

/** Every problem with the form, so all of them are shown at once. */
function validate(values: { name: string; email: string; password: string; confirm: string; acceptedTerms: boolean }) {
  const errors: Partial<Record<Field, string>> = {};
  if (values.name.trim().length < 3) errors.name = i18n.t('auth.register.errors.name');
  if (!values.email.trim()) errors.email = i18n.t('auth.emailRequired');
  else if (!EMAIL_PATTERN.test(values.email.trim())) errors.email = i18n.t('auth.emailInvalid');
  if (!values.password) errors.password = i18n.t('auth.register.errors.passwordEmpty');
  else if (!passwordMeetsRules(values.password)) {
    errors.password = i18n.t('password.errors.missing', { rules: missingPasswordRules(values.password).join(', ') });
  }
  if (!values.confirm) errors.confirm = i18n.t('password.errors.confirmEmpty');
  else if (values.confirm !== values.password) errors.confirm = i18n.t('password.errors.mismatch');
  if (!values.acceptedTerms) errors.terms = i18n.t('auth.register.errors.terms');
  return errors;
}

export default function RegisterScreen() {
  const { t } = useTranslation();
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
  const [microsoftLoading, setMicrosoftLoading] = useState(false);
  const [showFaceVerification, setShowFaceVerification] = useState(false);
  const [registeredUserId, setRegisteredUserId] = useState<string | null>(null);

  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const useSupabase = process.env.EXPO_PUBLIC_USE_SUPABASE === 'true';
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
    setError(t('auth.register.faceRequired'));
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
            kicker={t(registeredUserId ? 'auth.register.step2' : 'auth.register.step1')}
            subtitle={t(registeredUserId ? 'auth.register.verifySubtitle' : 'auth.register.subtitle')}
            title={t(registeredUserId ? 'auth.register.verifyTitle' : 'auth.register.title')}
          />
          <ProgressBar progress={registeredUserId ? 1 : 0.5} />

          <View style={styles.card}>
            {error ? <Notice onDismiss={() => setError(null)} tone="error">{error}</Notice> : null}

            {registeredUserId ? (
              <View style={styles.stepTwo}>
                <View style={styles.stepTwoIcon}>
                  <Ionicons color={colors.primary} name="scan-outline" size={36} />
                </View>
                <Text style={styles.stepTwoTitle}>{t('auth.register.readyTitle')}</Text>
                <Text style={styles.stepTwoText}>{t('auth.register.readyText')}</Text>
              </View>
            ) : (
              <>
                {useSupabase && isMicrosoftAuthEnabled ? (
                  <View style={styles.microsoft}>
                    <Text style={styles.microsoftTitle}>{t('auth.register.microsoftTitle')}</Text>
                    <MicrosoftSignInButton
                      disabled={loading}
                      dividerText={t('auth.register.microsoftDivider')}
                      onBusyChange={setMicrosoftLoading}
                      onError={setError}
                      title={t('auth.register.microsoftButton')}
                    />
                    <View style={styles.orDivider}>
                      <View style={styles.orLine} />
                      <Text style={styles.orText}>{t('auth.register.orEmail')}</Text>
                      <View style={styles.orLine} />
                    </View>
                  </View>
                ) : null}

                {missing.length ? (
                  <Notice title={missing.length === 1 ? t('auth.register.missingOne') : t('auth.register.missingMany', { count: missing.length })} tone="warning">
                    <View style={styles.missingList}>
                      {missing.map((field) => (
                        <Text key={field} style={styles.missingItem}>• {t(`auth.register.fields.${field}`)}: {errors[field]}</Text>
                      ))}
                    </View>
                  </Notice>
                ) : null}

                <TextField
                  autoCapitalize="words"
                  autoComplete="name"
                  error={errors.name}
                  label={t('auth.register.nameLabel')}
                  onChangeText={(text) => {
                    setName(text);
                    refresh({ name: text });
                  }}
                  placeholder={t('auth.register.namePlaceholder')}
                  value={name}
                />
                <TextField
                  autoCapitalize="none"
                  autoComplete="email"
                  error={errors.email}
                  hint={t('auth.register.emailHint')}
                  keyboardType="email-address"
                  label={t('auth.emailLabel')}
                  onChangeText={(text) => {
                    setEmail(text);
                    refresh({ email: text });
                  }}
                  placeholder={t('auth.emailPlaceholder')}
                  value={email}
                />
                <InstitutionDomainHint email={email} />
                <PasswordField
                  autoComplete="new-password"
                  error={errors.password}
                  label={t('auth.register.passwordLabel')}
                  onChangeText={(text) => {
                    setPassword(text);
                    refresh({ password: text });
                  }}
                  placeholder={t('auth.register.passwordPlaceholder')}
                  textContentType="newPassword"
                  value={password}
                />
                <PasswordField
                  autoComplete="new-password"
                  error={errors.confirm}
                  label={t('auth.register.confirmLabel')}
                  onChangeText={(text) => {
                    setConfirm(text);
                    refresh({ confirm: text });
                  }}
                  placeholder={t('auth.register.confirmPlaceholder')}
                  textContentType="newPassword"
                  value={confirm}
                />
                <PasswordChecklist confirm={confirm} password={password} />

                <View style={styles.roleSection}>
                  <Text style={styles.roleTitle}>{t('auth.register.roleTitle')}</Text>
                  <Text style={styles.roleHint}>{t('auth.register.roleHint')}</Text>
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
                            {t(role === 'driver' ? 'auth.register.driver' : 'auth.register.passenger')}
                          </Text>
                          <Text style={styles.roleDesc}>{t(role === 'driver' ? 'auth.register.driverDesc' : 'auth.register.passengerDesc')}</Text>
                        </PressableScale>
                      );
                    })}
                  </View>
                  {selectedRole === 'driver' ? (
                    <Text style={styles.roleHint}>{t('auth.register.driverNext')}</Text>
                  ) : null}
                </View>

                <View>
                  <Checkbox
                    checked={acceptedTerms}
                    label={t('auth.register.terms')}
                    onChange={(checked) => {
                      setAcceptedTerms(checked);
                      refresh({ acceptedTerms: checked });
                    }}
                  />
                  {errors.terms ? <View style={styles.termsError}><FieldError message={errors.terms} /></View> : null}
                  <Pressable
                    accessibilityHint={t('auth.register.termsHint')}
                    accessibilityRole="link"
                    hitSlop={6}
                    onPress={() => router.push('/legal')}
                    style={styles.readMore}
                  >
                    <Ionicons color={colors.primary} name="document-text-outline" size={16} />
                    <Text style={styles.readMoreText}>{t('auth.register.readMore')}</Text>
                  </Pressable>
                </View>
              </>
            )}

            <ButtonPrimary
              disabled={microsoftLoading}
              icon={registeredUserId ? 'scan-outline' : undefined}
              loading={loading}
              loadingTitle={t('auth.register.submitting')}
              onPress={() => void handleRegister()}
              title={t(registeredUserId ? 'auth.register.verifyButton' : 'auth.register.submit')}
            />
            {registeredUserId ? (
              <ButtonSecondary onPress={() => router.replace('/(tabs)')} title={t('auth.register.later')} />
            ) : (
              <ButtonSecondary onPress={() => router.back()} title={t('auth.register.haveAccount')} />
            )}
          </View>

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
  microsoft: { gap: spacing[12] },
  microsoftTitle: { ...typography.label, color: colors.text, textAlign: 'center' },
  orDivider: { alignItems: 'center', flexDirection: 'row', gap: spacing[12], marginTop: spacing[4] },
  orLine: { backgroundColor: colors.lightGray, flex: 1, height: 1 },
  orText: { ...typography.caption, color: colors.textSecondary },
  missingList: { gap: 2 },
  missingItem: { ...typography.bodySmall, color: colors.warningText },
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
  readMore: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: 6, marginLeft: 30, paddingVertical: spacing[4] },
  readMoreText: { ...typography.bodySmall, color: colors.primary, fontWeight: '600', textDecorationLine: 'underline' },
  termsError: { marginLeft: 30 },
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
