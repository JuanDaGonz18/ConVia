import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Avatar } from '@/components/ui/Avatar';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Divider } from '@/components/ui/Divider';
import { ListItem } from '@/components/ui/ListItem';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { radius } from '@/constants/radius';
import { useAppStore } from '@/store/appStore';
import { authService } from '@/services/authService';

export default function ProfileScreen() {
  const currentUser = useAppStore((state) => state.currentUser);
  const logoutStore = useAppStore((state) => state.logout);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const userName = currentUser?.name || 'Usuario WheelsApp';
  const userEmail = currentUser?.email || 'usuario@wheelsapp.com';
  const isDriver = currentUser?.role === 'driver';

  const handleConfirmLogout = async () => {
    setShowLogoutModal(false);
    await authService.logout();
    logoutStore();
    router.replace('/(auth)/login');
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Profile Header */}
        <View style={styles.headerCard}>
          <Avatar name={userName} size={72} />
          <Text style={styles.name}>{userName}</Text>
          <Text style={styles.email}>{userEmail}</Text>

          <View style={styles.badge}>
            <Ionicons
              color={colors.primary}
              name={isDriver ? 'car-sport' : 'person'}
              size={16}
            />
            <Text style={styles.badgeText}>
              {isDriver ? 'Conductor Registrado' : 'Pasajero Activo'}
            </Text>
          </View>
        </View>

        {/* Quick Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>18</Text>
            <Text style={styles.statLabel}>Viajes</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statValue}>⭐ 4.9</Text>
            <Text style={styles.statLabel}>Calificación</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{isDriver ? '4' : 'CO'}</Text>
            <Text style={styles.statLabel}>{isDriver ? 'Asientos' : 'Bogotá'}</Text>
          </View>
        </View>

        {/* Settings Menu */}
        <View style={styles.menuCard}>
          <ListItem
            icon="person-outline"
            onPress={() => alert('Información personal')}
            subtitle="Nombre, teléfono y documento"
            title="Información Personal"
          />
          <Divider />
          <ListItem
            icon={isDriver ? 'car-outline' : 'card-outline'}
            onPress={() => alert(isDriver ? 'Vehículo registrado' : 'Métodos de pago')}
            subtitle={isDriver ? 'Placas, modelo y SOAT' : 'Tarjetas y billetera'}
            title={isDriver ? 'Mi Vehículo' : 'Métodos de Pago'}
          />
          <Divider />
          <ListItem
            icon="notifications-outline"
            onPress={() => alert('Notificaciones')}
            subtitle="Alertas de viaje y chat"
            title="Notificaciones"
          />
          <Divider />
          <ListItem
            icon="shield-checkmark-outline"
            onPress={() => alert('Seguridad y privacidad')}
            subtitle="Contraseña y permisos"
            title="Seguridad"
          />
          <Divider />
          <ListItem
            icon="help-circle-outline"
            onPress={() => alert('Centro de ayuda WheelsApp')}
            subtitle="Preguntas frecuentes y soporte"
            title="Ayuda y Soporte"
          />
        </View>

        {/* Logout Action */}
        <View style={styles.logoutContainer}>
          <ButtonSecondary
            onPress={() => setShowLogoutModal(true)}
            title="Cerrar Sesión"
          />
        </View>
      </ScrollView>

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
  badge: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusFull,
    flexDirection: 'row',
    gap: spacing[8],
    marginTop: spacing[4],
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[8],
  },
  badgeText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
  statsRow: {
    backgroundColor: colors.white,
    borderColor: colors.lightGray,
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing[16],
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
    gap: spacing[4],
  },
  statValue: {
    ...typography.headingM,
    color: colors.primary,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  statDivider: {
    backgroundColor: colors.lightGray,
    width: 1,
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
    marginTop: spacing[8],
  },
});
