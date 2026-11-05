import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';

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
import { compressPhoto, PHOTO_MAX_SIDE } from '@/services/imageCompression';
import { profileService } from '@/services/profileService';
import { useAppStore } from '@/store/appStore';
import { errorMessage } from '@/utils/format';
import { passwordErrorMessage, passwordFieldErrors } from '@/utils/password';

const PHONE_PATTERN = /^\+?[\d\s-]{7,20}$/;

export default function ProfileEditScreen() {
  const { t } = useTranslation();
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
      if (active) setError(errorMessage(loadError, t('profileEdit.loadFailed')));
    });
    return () => { active = false; };
  }, [userId, t]);

  const pickAvatar = async () => {
    if (!currentUser || !isSupabaseEnabled) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setError(null);
    setUploading(true);
    try {
      // A 512 px JPEG instead of the full photo: less Storage and egress.
      const photo = await compressPhoto(asset, PHOTO_MAX_SIDE.avatar);
      const avatarUrl = await profileService.uploadAvatar(currentUser.id, photo.uri, photo.mimeType);
      setCurrentUser({ ...currentUser, avatarUrl });
      toast.success(t('profileEdit.photoUpdated'));
    } catch (uploadError) {
      setError(errorMessage(uploadError, t('profileEdit.photoFailed')));
    } finally {
      setUploading(false);
    }
  };

  const saveProfile = async () => {
    const errors: { name?: string; phone?: string } = {};
    if (name.trim().length < 3) errors.name = t('profileEdit.nameRequired');
    if (phone.trim() && !PHONE_PATTERN.test(phone.trim())) errors.phone = t('profileEdit.phoneInvalid');
    setProfileErrors(errors);
    if (Object.keys(errors).length || !currentUser) return;
    setError(null);
    setSaving('profile');
    try {
      await profileService.updateProfile(currentUser.id, { name: name.trim(), phone: phone.trim() });
      setCurrentUser({ ...currentUser, name: name.trim() });
      toast.success(t('profileEdit.saved'));
    } catch (saveError) {
      setError(errorMessage(saveError, t('profileEdit.saveFailed')));
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
      toast.success(t('profileEdit.passwordUpdated'));
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
          <ScreenHeader kicker={t('profileEdit.kicker')} subtitle={currentUser?.email} title={t('profileEdit.title')} />
          {error ? <Notice onDismiss={() => setError(null)} tone="error">{error}</Notice> : null}

          <View style={styles.card}>
            <View style={styles.avatarRow}>
              <Avatar imageUrl={currentUser?.avatarUrl} name={name || t('profileEdit.user')} size={72} />
              <View style={styles.flex}>
                <ButtonSecondary icon="camera-outline" loading={uploading} onPress={() => void pickAvatar()} title={t('profileEdit.changePhoto')} />
              </View>
            </View>
            <TextField
              autoCapitalize="words"
              error={profileErrors.name}
              label={t('profileEdit.name')}
              onChangeText={(text) => {
                setName(text);
                if (profileErrors.name) setProfileErrors((current) => ({ ...current, name: undefined }));
              }}
              value={name}
            />
            <TextField
              error={profileErrors.phone}
              hint={t('profileEdit.phoneHint')}
              keyboardType="phone-pad"
              label={t('profileEdit.phone')}
              onChangeText={(text) => {
                setPhone(text);
                if (profileErrors.phone) setProfileErrors((current) => ({ ...current, phone: undefined }));
              }}
              placeholder={t('profileEdit.phonePlaceholder')}
              value={phone}
            />
            <ButtonPrimary
              disabled={!profileLoaded}
              loading={saving === 'profile'}
              loadingTitle={t('profileEdit.saving')}
              onPress={() => void saveProfile()}
              title={t('profileEdit.save')}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('profileEdit.passwordTitle')}</Text>
            <Text style={styles.sectionHint}>{t('profileEdit.passwordHint')}</Text>
            <PasswordField
              autoComplete="new-password"
              error={passwordErrors?.password}
              label={t('profileEdit.newPassword')}
              onChangeText={(text) => {
                setPassword(text);
                // After the first attempt, errors update (and disappear) as the user types.
                if (passwordErrors) setPasswordErrors(passwordFieldErrors(text, confirm));
              }}
              placeholder={t('profileEdit.newPasswordPlaceholder')}
              textContentType="newPassword"
              value={password}
            />
            <PasswordField
              autoComplete="new-password"
              error={passwordErrors?.confirm}
              label={t('profileEdit.confirmPassword')}
              onChangeText={(text) => {
                setConfirm(text);
                if (passwordErrors) setPasswordErrors(passwordFieldErrors(password, text));
              }}
              placeholder={t('profileEdit.confirmPasswordPlaceholder')}
              textContentType="newPassword"
              value={confirm}
            />
            {password || confirm ? <PasswordChecklist confirm={confirm} password={password} /> : null}
            <ButtonSecondary
              icon="lock-closed-outline"
              loading={saving === 'password'}
              onPress={() => void changePassword()}
              title={t('profileEdit.updatePassword')}
            />
          </View>

          <ButtonSecondary onPress={() => router.back()} title={t('profileEdit.back')} />
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
