import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { TextField } from '@/components/forms/TextField';
import { Avatar } from '@/components/ui/Avatar';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { isSupabaseEnabled } from '@/lib/supabase';
import { profileService } from '@/services/profileService';
import { useAppStore } from '@/store/appStore';
import { errorMessage } from '@/utils/format';

const PHONE_PATTERN = /^\+?[\d\s-]{7,20}$/;

export default function ProfileEditScreen() {
  const currentUser = useAppStore((state) => state.currentUser);
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const [name, setName] = useState(currentUser?.name ?? '');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(!isSupabaseEnabled);
  const [loading, setLoading] = useState(false);
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
      if (active) setError(errorMessage(loadError, 'No se pudo cargar tu perfil.'));
    });
    return () => { active = false; };
  }, [userId]);

  const pickAvatar = async () => {
    if (!currentUser || !isSupabaseEnabled) {
      setError('Cambiar la foto requiere una sesión de Supabase.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setError(null);
    setMessage(null);
    setUploading(true);
    try {
      const avatarUrl = await profileService.uploadAvatar(currentUser.id, asset.uri, asset.mimeType ?? 'image/jpeg');
      setCurrentUser({ ...currentUser, avatarUrl });
      setMessage('Foto actualizada.');
    } catch (uploadError) {
      setError(errorMessage(uploadError, 'No se pudo subir la foto.'));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!name.trim()) {
      setError('El nombre no puede estar vacío.');
      return;
    }
    if (phone.trim() && !PHONE_PATTERN.test(phone.trim())) {
      setError('Ingresa un teléfono válido.');
      return;
    }
    if (password && password.length < 6) {
      setError('La nueva contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (password !== passwordConfirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    if (!isSupabaseEnabled || !currentUser) {
      setError('Esta edición requiere una sesión de Supabase.');
      return;
    }
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      await profileService.updateProfile(currentUser.id, { name: name.trim(), phone: phone.trim() });
      if (password) await profileService.changePassword(password);
      setCurrentUser({ ...currentUser, name: name.trim() });
      setPassword('');
      setPasswordConfirm('');
      setMessage(password ? 'Cambios y contraseña guardados.' : 'Cambios guardados.');
    } catch (saveError) {
      setError(errorMessage(saveError, 'No se pudieron guardar los cambios.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityLabel="Volver" onPress={() => router.back()} style={styles.back}>
          <Ionicons color={colors.text} name="arrow-back" size={24} />
        </Pressable>
        <Text style={styles.kicker}>CUENTA</Text>
        <Text style={styles.title}>Información personal</Text>
        <Text style={styles.subtitle}>{currentUser?.email}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {message ? <Text style={styles.success}>{message}</Text> : null}
        <View style={styles.avatarRow}>
          <Avatar imageUrl={currentUser?.avatarUrl} name={name || 'Usuario'} size={72} />
          <View style={styles.avatarButton}>
            <ButtonSecondary disabled={uploading} onPress={() => void pickAvatar()} title={uploading ? 'Subiendo...' : 'Cambiar foto'} />
          </View>
        </View>
        <TextField label="Nombre" onChangeText={setName} value={name} />
        <TextField label="Teléfono" keyboardType="phone-pad" onChangeText={setPhone} placeholder="300 000 0000" value={phone} />
        <Text style={styles.section}>Seguridad</Text>
        <TextField autoCapitalize="none" label="Nueva contraseña (opcional)" onChangeText={setPassword} placeholder="Mínimo 6 caracteres" secureTextEntry value={password} />
        {password ? (
          <TextField autoCapitalize="none" label="Confirmar contraseña" onChangeText={setPasswordConfirm} secureTextEntry value={passwordConfirm} />
        ) : null}
        <ButtonPrimary disabled={!profileLoaded} loading={loading} onPress={save} title="Guardar cambios" />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing[16], padding: dimensions.screenPadding, paddingBottom: spacing[40] },
  back: { alignSelf: 'flex-start', padding: spacing[4] },
  kicker: { ...typography.label, color: colors.primary },
  title: { ...typography.headingXL, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary },
  section: { ...typography.headingM, color: colors.text, marginTop: spacing[8] },
  avatarRow: { alignItems: 'center', flexDirection: 'row', gap: spacing[16] },
  avatarButton: { flex: 1 },
  error: { ...typography.bodySmall, backgroundColor: '#FFEAEA', color: colors.error, padding: spacing[12] },
  success: { ...typography.bodySmall, backgroundColor: colors.primaryLight, color: colors.primary, padding: spacing[12] },
});
