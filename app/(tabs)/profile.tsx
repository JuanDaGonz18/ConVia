import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Avatar } from '@/components/ui/Avatar';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FaceVerificationModal } from '@/components/face/FaceVerificationModal';
import { Divider } from '@/components/ui/Divider';
import { ListItem } from '@/components/ui/ListItem';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { radius } from '@/constants/radius';
import { useAppStore } from '@/store/appStore';
import { authService } from '@/services/authService';
import { driverService } from '@/services/driverService';
import { notificationService } from '@/services/notificationService';
import { profileService } from '@/services/profileService';
import { isSupabaseEnabled } from '@/lib/supabase';
import { UserRole } from '@/types';
import { errorMessage } from '@/utils/format';

const DRIVER_STATUS_LABELS = {
  pendiente: 'Falta verificar tu identidad',
  aprobado: 'Identidad verificada',
  rechazado: 'No aprobado, inténtalo de nuevo',
  suspendido: 'Suspendido',
} as const;

export default function ProfileScreen() {
  const currentUser = useAppStore((state) => state.currentUser);
  const logoutStore = useAppStore((state) => state.logout);
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const [switchingRole, setSwitchingRole] = useState(false);
  const markFaceVerified = useAppStore((state) => state.markFaceVerified);
  const savedPlacesCount = useAppStore((state) => state.savedPlaces.length);
  const favoriteCount = useAppStore((state) => state.favoriteDriverIds.length);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showVerification, setShowVerification] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean | null>(null);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = currentUser?.id;

  useEffect(() => {
    if (!isSupabaseEnabled || !userId) return;
    let active = true;
    void profileService.getProfile(userId).then((profile) => {
      if (active) setNotificationsEnabled(profile.notificationsEnabled);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [userId]);

  const toggleNotifications = async (enabled: boolean) => {
    if (!userId) return;
    setSavingNotifications(true);
    setError(null);
    try {
      const applied = await notificationService.setEnabled(userId, enabled);
      if (applied) setNotificationsEnabled(enabled);
      else setError('Activa el permiso de notificaciones para WheelsApp en los ajustes del teléfono.');
    } catch (toggleError) {
      setError(errorMessage(toggleError, 'No se pudo actualizar la preferencia de notificaciones.'));
    } finally {
      setSavingNotifications(false);
    }
  };

  const switchMode = async (role: UserRole) => {
    if (!currentUser || currentUser.role === role || switchingRole) return;
    // Driving is locked until the license check passes: go verify, staying a
    // passenger. The license screen switches to driver mode once approved.
    if (role === 'driver' && currentUser.driverStatus !== 'aprobado') {
      router.push('/driver-license');
      return;
    }
    setSwitchingRole(true);
    setError(null);
    try {
      await driverService.switchRole(role);
      setCurrentUser({ ...currentUser, role });
    } catch (switchError) {
      setError(errorMessage(switchError, 'No se pudo cambiar de modo.'));
    } finally {
      setSwitchingRole(false);
    }
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await authService.deleteAccount();
      setShowDeleteModal(false);
      logoutStore();
      router.replace('/(auth)/login');
    } catch (deleteError) {
      setShowDeleteModal(false);
      setError(errorMessage(deleteError, 'No se pudo eliminar la cuenta.'));
    } finally {
      setDeleting(false);
    }
  };

  const userName = currentUser?.name || 'Usuario WheelsApp';
  const userEmail = currentUser?.email ?? '';
  const isDriver = currentUser?.role === 'driver';
  const driverApproved = currentUser?.driverStatus === 'aprobado';
  const isVerified = currentUser?.faceVerified === true;

  const handleConfirmLogout = async () => {
    setShowLogoutModal(false);
    try {
      await authService.logout();
    } finally {
      logoutStore();
      router.replace('/(auth)/login');
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Profile Header */}
        <View style={styles.headerCard}>
          <Avatar imageUrl={currentUser?.avatarUrl} name={userName} size={72} />
          <Text style={styles.name}>{userName}</Text>
          <Text style={styles.email}>{userEmail}</Text>

          <View accessibilityRole="radiogroup" style={styles.modeToggle}>
            {(['client', 'driver'] as const).map((mode) => {
              const active = currentUser?.role === mode;
              // Driving stays locked until the license identity check is passed.
              const locked = mode === 'driver' && !driverApproved;
              return (
                <Pressable
                  accessibilityHint={locked ? 'Requiere verificar tu licencia de conducción' : undefined}
                  accessibilityLabel={mode === 'driver' ? 'Modo conductor' : 'Modo pasajero'}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active, disabled: switchingRole }}
                  disabled={switchingRole}
                  key={mode}
                  onPress={() => void switchMode(mode)}
                  style={[styles.modeOption, active ? styles.modeOptionActive : null]}
                >
                  <Ionicons color={active ? colors.white : colors.primary} name={mode === 'driver' ? 'car-sport' : 'person'} size={16} />
                  <Text style={[styles.modeText, active ? styles.modeTextActive : null]}>
                    {mode === 'driver' ? 'Conductor' : 'Pasajero'}
                  </Text>
                  {locked ? (
                    <Ionicons accessibilityLabel="Bloqueado" color={active ? colors.white : colors.primary} name="lock-closed" size={14} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          <View style={styles.verificationRow}>
            <Ionicons
              color={isVerified ? colors.success : colors.error}
              name={isVerified ? 'shield-checkmark' : 'shield-outline'}
              size={14}
            />
            <Text style={isVerified ? styles.verified : styles.unverified}>
              {isVerified ? 'Identidad verificada' : 'Identidad sin verificar'}
            </Text>
          </View>
        </View>

        {/* Settings Menu */}
        <View style={styles.menuCard}>
          <ListItem
            icon="person-outline"
            onPress={() => router.push('/profile-edit')}
            subtitle="Nombre, teléfono, foto y contraseña"
            title="Información personal"
          />
          <Divider />
          <ListItem
            icon="bookmark-outline"
            onPress={() => router.push('/saved-places')}
            subtitle={savedPlacesCount ? `${savedPlacesCount} guardado${savedPlacesCount === 1 ? '' : 's'}` : 'Casa, trabajo, universidad (opcional)'}
            title="Mis lugares"
          />
          <Divider />
          <ListItem
            icon="star-outline"
            onPress={() => router.push('/favorite-drivers')}
            subtitle={favoriteCount ? `${favoriteCount} favorito${favoriteCount === 1 ? '' : 's'}` : 'Destaca los viajes de quienes prefieres'}
            title="Conductores favoritos"
          />
          {isDriver ? (
            <>
              <Divider />
              <ListItem
                icon="id-card-outline"
                onPress={() => router.push('/driver-license')}
                subtitle={currentUser?.driverStatus ? DRIVER_STATUS_LABELS[currentUser.driverStatus] : 'Verifica tu identidad con tu licencia'}
                title="Permiso de conductor"
              />
            </>
          ) : null}
          {isDriver ? (
            <>
              <Divider />
              <ListItem
                icon="car-outline"
                onPress={() => router.push('/vehicles')}
                subtitle="Fotos, placas y puestos de tus vehículos"
                title="Mis vehículos"
              />
            </>
          ) : null}
          <Divider />
          <ListItem
            icon="document-text-outline"
            onPress={() => router.push('/requests')}
            subtitle={isDriver ? 'Solicitudes de tus pasajeros' : 'Estado de tus solicitudes y QR'}
            title="Solicitudes"
          />
          {!isVerified && currentUser ? (
            <>
              <Divider />
              <ListItem
                icon="shield-checkmark-outline"
                onPress={() => setShowVerification(true)}
                subtitle="Necesaria para publicar o solicitar viajes"
                title="Verificar identidad"
              />
            </>
          ) : null}
        </View>

        {notificationsEnabled !== null && notificationService.isAvailable() ? (
          <View style={[styles.menuCard, styles.switchRow]}>
            <View style={styles.switchText}>
              <Text style={styles.switchTitle}>Notificaciones</Text>
              <Text style={styles.switchSubtitle}>Solicitudes, respuestas y mensajes de tus viajes</Text>
            </View>
            <Switch
              accessibilityLabel="Notificaciones"
              disabled={savingNotifications}
              onValueChange={(value) => void toggleNotifications(value)}
              value={notificationsEnabled}
            />
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* Logout Action */}
        <View style={styles.logoutContainer}>
          <ButtonSecondary
            onPress={() => setShowLogoutModal(true)}
            title="Cerrar sesión"
          />
          {isSupabaseEnabled ? (
            <Pressable
              accessibilityRole="button"
              disabled={deleting}
              onPress={() => setShowDeleteModal(true)}
              style={styles.deleteButton}
            >
              <Text style={styles.deleteText}>{deleting ? 'Eliminando cuenta...' : 'Eliminar cuenta'}</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      {currentUser && !isVerified ? (
        <FaceVerificationModal
          onClose={() => setShowVerification(false)}
          onFailure={() => undefined}
          onSuccess={() => {
            setShowVerification(false);
            markFaceVerified();
          }}
          trigger="register"
          userId={currentUser.id}
          visible={showVerification}
        />
      ) : null}

      <ConfirmDialog
        cancelLabel="Cancelar"
        confirmLabel="Sí, eliminar"
        message="Se borrarán tu perfil, vehículo, viajes, solicitudes, mensajes y fotos. Esta acción no se puede deshacer."
        onCancel={() => setShowDeleteModal(false)}
        onConfirm={() => void handleConfirmDelete()}
        title="¿Eliminar tu cuenta?"
        visible={showDeleteModal}
      />

      {/* Confirmation Dialog */}
      <ConfirmDialog
        cancelLabel="Cancelar"
        confirmLabel="Sí, cerrar sesión"
        message="Tendrás que volver a ingresar tus credenciales para acceder a tu cuenta."
        onCancel={() => setShowLogoutModal(false)}
        onConfirm={handleConfirmLogout}
        title="¿Deseas cerrar sesión?"
        visible={showLogoutModal}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scrollContent: {
    gap: spacing[16],
    paddingBottom: dimensions.bottomNavigationHeight + spacing[32],
    paddingHorizontal: dimensions.screenPadding,
    paddingTop: spacing[16],
  },
  headerCard: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    gap: spacing[8],
    padding: spacing[24],
  },
  name: {
    ...typography.headingM,
    color: colors.text,
  },
  email: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  verificationRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing[4],
  },
  verified: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '600',
  },
  unverified: {
    ...typography.caption,
    color: colors.error,
    fontWeight: '600',
  },
  modeToggle: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusFull,
    flexDirection: 'row',
    marginTop: spacing[4],
    padding: 4,
  },
  modeOption: {
    alignItems: 'center',
    borderRadius: radius.radiusFull,
    flexDirection: 'row',
    gap: spacing[4],
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[8],
  },
  modeOptionActive: {
    backgroundColor: colors.primary,
  },
  modeText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
  modeTextActive: {
    color: colors.white,
  },
  menuCard: {
    backgroundColor: colors.white,
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[8],
  },
  logoutContainer: {
    gap: spacing[8],
    marginTop: spacing[8],
  },
  switchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing[12],
    paddingVertical: spacing[12],
  },
  switchText: {
    flex: 1,
    gap: 2,
  },
  switchTitle: {
    ...typography.bodyMedium,
    color: colors.text,
    fontWeight: '600',
  },
  switchSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  error: {
    ...typography.bodySmall,
    backgroundColor: '#FFEAEA',
    color: colors.error,
    padding: spacing[12],
  },
  deleteButton: {
    alignItems: 'center',
    padding: spacing[12],
  },
  deleteText: {
    ...typography.bodySmall,
    color: colors.error,
    fontWeight: '600',
  },
});
