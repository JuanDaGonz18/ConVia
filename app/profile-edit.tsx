import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';

import { PasswordChecklist, PasswordField } from '@/components/forms/PasswordField';
import { TextField } from '@/components/forms/TextField';
import { Avatar } from '@/components/ui/Avatar';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { Notice } from '@/components/ui/Notice';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { toast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { isSupabaseEnabled } from '@/lib/supabase';
import { profileService } from '@/services/profileService';
import { useAppStore } from '@/store/appStore';
import { errorMessage, rawErrorMessage } from '@/utils/format';
import { passwordFieldErrors } from '@/utils/password';

const PHONE_PATTERN = /^\+?[\d\s-]{7,20}$/;

function passwordErrorMessage(error: unknown) {
  const raw = rawErrorMessage(error);
  if (/different from the old/i.test(raw)) return 'La nueva contraseña debe ser diferente a la actual.';
  if (/reauthentication|recent/i.test(raw)) return 'Por seguridad, cierra sesión, vuelve a entrar y cambia la contraseña de inmediato.';
  if (/weak|at least|characters/i.test(raw)) return 'La contraseña es muy débil. Revisa los requisitos.';
  return errorMessage(error, 'No pudimos cambiar tu contraseña. Inténtalo de nuevo.');
}

export default function ProfileEditScreen() {
  const currentUser = useAppStore((state) => state.currentUser);
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const [name, setName] = useState(currentUser?.name ?? '');
  const [phone, setPhone] = useState('');
  const [profileErrors, setProfileErrors] = useState<{ name?: string; phone?: string }>({});
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<{ password?: string; confirm?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(!isSupabaseEnabled);
  const [saving, setSaving] = useState<'profile' | 'password' | null>(null);
  const [uploading, setUploading] = useState(false);
  const userId = currentUser?.id;

  // Load the stored phone so saving the form never blanks it.
  useEffect(() => {
    if (!isSupabaseEnabled || !userId) return;
    let active = true;
    void profileService.getProfile(userId).then((profile) => {
      if (!active) return;
      setName(profile.name);
      setPhone(profile.phone);
      setProfileLoaded(true);
    }).catch((loadError) => {
      if (active) setError(errorMessage(loadError, 'No pudimos cargar tu perfil.'));
    });
    return () => { active = false; };
  }, [userId]);

  const pickAvatar = async () => {
    if (!currentUser || !isSupabaseEnabled) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setError(null);
    setUploading(true);
    try {
      const avatarUrl = await profileService.uploadAvatar(currentUser.id, asset.uri, asset.mimeType ?? 'image/jpeg');
      setCurrentUser({ ...currentUser, avatarUrl });
      toast.success('Foto de perfil actualizada');
    } catch (uploadError) {
      setError(errorMessage(uploadError, 'No pudimos subir la foto. Inténtalo con otra imagen.'));
    } finally {
      setUploading(false);
    }
  };

  const saveProfile = async () => {
    const errors: { name?: string; phone?: string } = {};
    if (name.trim().length < 3) errors.name = 'Escribe tu nombre y apellido.';
    if (phone.trim() && !PHONE_PATTERN.test(phone.trim())) errors.phone = 'Escribe un número de teléfono válido, solo con números.';
    setProfileErrors(errors);
    if (Object.keys(errors).length || !currentUser) return;
    setError(null);
    setSaving('profile');
    try {
      await profileService.updateProfile(currentUser.id, { name: name.trim(), phone: phone.trim() });
      setCurrentUser({ ...currentUser, name: name.trim() });
      toast.success('Datos guardados');
    } catch (saveError) {
      setError(errorMessage(saveError, 'No pudimos guardar tus datos.'));
    } finally {
      setSaving(null);
    }
  };

  const changePassword = async () => {
    const errors = passwordFieldErrors(password, confirm);
    setPasswordErrors(errors);
    if (errors.password || errors.confirm) return;
    setError(null);
    setSaving('password');
    try {
      await profileService.changePassword(password);
      setPassword('');
      setConfirm('');
      toast.success('Contraseña actualizada');
    } catch (changeError) {
      setError(passwordErrorMessage(changeError));
    } finally {
      setSaving(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader kicker="TU CUENTA" subtitle={currentUser?.email} title="Información personal" />
          {error ? <Notice onDismiss={() => setError(null)} tone="error">{error}</Notice> : null}

          <View style={styles.card}>
            <View style={styles.avatarRow}>
              <Avatar imageUrl={currentUser?.avatarUrl} name={name || 'Usuario'} size={72} />
              <View style={styles.flex}>
                <ButtonSecondary icon="camera-outline" loading={uploading} onPress={() => void pickAvatar()} title="Cambiar foto" />
              </View>
            </View>
            <TextField
              autoCapitalize="words"
              error={profileErrors.name}
              label="Nombre completo"
              onChangeText={(text) => {
                setName(text);
                if (profileErrors.name) setProfileErrors((current) => ({ ...current, name: undefined }));
              }}
              value={name}
            />
            <TextField
              error={profileErrors.phone}
              hint="Opcional. Solo lo ven los integrantes de tus viajes."
              keyboardType="phone-pad"
              label="Teléfono"
              onChangeText={(text) => {
                setPhone(text);
                if (profileErrors.phone) setProfileErrors((current) => ({ ...current, phone: undefined }));
              }}
              placeholder="Tu número de celular"
              value={phone}
            />
            <ButtonPrimary
              disabled={!profileLoaded}
              loading={saving === 'profile'}
              loadingTitle="Guardando…"
              onPress={() => void saveProfile()}
              title="Guardar datos"
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Cambiar contraseña</Text>
            <Text style={styles.sectionHint}>Escribe la nueva contraseña dos veces. La usarás la próxima vez que inicies sesión.</Text>
            <PasswordField
              autoComplete="new-password"
              error={passwordErrors?.password}
              label="Nueva contraseña"
              onChangeText={(text) => {
                setPassword(text);
                // After the first attempt, errors update (and disappear) as the user types.
                if (passwordErrors) setPasswordErrors(passwordFieldErrors(text, confirm));
              }}
              placeholder="Crea una contraseña"
              textContentType="newPassword"
              value={password}
            />
            <PasswordField
              autoComplete="new-password"
              error={passwordErrors?.confirm}
              label="Confirma la nueva contraseña"
              onChangeText={(text) => {
                setConfirm(text);
                if (passwordErrors) setPasswordErrors(passwordFieldErrors(password, text));
              }}
              placeholder="Escribe la contraseña otra vez"
              textContentType="newPassword"
              value={confirm}
            />
            {password || confirm ? <PasswordChecklist confirm={confirm} password={password} /> : null}
            <ButtonSecondary
              icon="lock-closed-outline"
              loading={saving === 'password'}
              onPress={() => void changePassword()}
              title="Actualizar contraseña"
            />
          </View>

          <ButtonSecondary onPress={() => router.back()} title="Volver al perfil" />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.surfaceMuted, flex: 1 },
  flex: { flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  card: {
    backgroundColor: colors.white,
    borderColor: colors.lightGray,
    borderRadius: radius.radiusXL,
    borderWidth: 1,
    gap: spacing[16],
    padding: spacing[20],
  },
  avatarRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[16] },
  sectionTitle: { ...typography.headingM, color: colors.text },
  sectionHint: { ...typography.bodySmall, color: colors.textSecondary, marginTop: -spacing[8] },
});
