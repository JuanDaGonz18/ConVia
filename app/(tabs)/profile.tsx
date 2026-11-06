import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useMembership } from '@/services/membershipService';
import { PlusBadge } from '@/components/subscription/PlusBadge';
import { Notice } from '@/components/ui/Notice';
import { BrandLogo } from '@/components/brand/Brand';
import { Avatar } from '@/components/ui/Avatar';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FaceVerificationModal } from '@/components/face/FaceVerificationModal';
import { Divider } from '@/components/ui/Divider';
import { ListItem } from '@/components/ui/ListItem';
import { ModeSwitch } from '@/components/profile/ModeSwitch';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { radius } from '@/constants/radius';
import { useAppStore } from '@/store/appStore';
import { authService } from '@/services/authService';
import { useLegalGate } from '@/services/legalGate';
import { notificationService } from '@/services/notificationService';
import { profileService } from '@/services/profileService';
import { isSupabaseEnabled } from '@/lib/supabase';
import { usePlan } from '@/subscription/usePlan';
import { errorMessage } from '@/utils/format';
import i18n from '@/i18n';

/** The driver's approval status in the current language (driverStatus.*). */
const driverStatusLabel = (status: string) => i18n.t(`driverStatus.${status}`);

export default function ProfileScreen() {
  const { t } = useTranslation();
  const membership = useMembership();
  const currentUser = useAppStore((state) => state.currentUser);
  const logoutStore = useAppStore((state) => state.logout);
  const markFaceVerified = useAppStore((state) => state.markFaceVerified);
  const savedPlacesCount = useAppStore((state) => state.savedPlaces.length);
  const favoriteCount = useAppStore((state) => state.favoriteDriverIds.length);
  const routeCount = useAppStore((state) => state.savedRoutes.length);
  const alertCount = useAppStore((state) => state.savedRoutes.filter((route) => route.alert).length);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showVerification, setShowVerification] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // ?delete=1: the new-terms modal sent the person here to delete their account.
  // Opened while rendering (not in an effect); the param is cleared once handled, so it can come again.
  const { delete: deleteParam } = useLocalSearchParams<{ delete?: string }>();
  const [deleteParamHandled, setDeleteParamHandled] = useState(false);
  if (deleteParam === '1' && !deleteParamHandled) {
    setDeleteParamHandled(true);
    setShowDeleteModal(true);
  } else if (deleteParam !== '1' && deleteParamHandled) {
    setDeleteParamHandled(false);
  }
  useEffect(() => {
    if (deleteParam === '1') router.setParams({ delete: undefined });
  }, [deleteParam]);
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
      else setError(t('profile.notificationsPermission'));
    } catch (toggleError) {
      setError(errorMessage(toggleError, t('profile.notificationsFailed')));
    } finally {
      setSavingNotifications(false);
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
      useLegalGate.getState().resume();
      setError(errorMessage(deleteError, t('profile.deleteFailed')));
    } finally {
      setDeleting(false);
    }
  };

  const userName = currentUser?.name || t('profile.defaultName');
  const userEmail = currentUser?.email ?? '';
  const isDriver = currentUser?.role === 'driver';
  const { isPlus } = usePlan();
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
          <Avatar highlight={isPlus} imageUrl={currentUser?.avatarUrl} name={userName} size={72} />
          <Text style={styles.name}>{userName}</Text>
          <Text selectable style={styles.email}>{userEmail}</Text>
          {isPlus ? <PlusBadge /> : null}

          {isVerified ? (
            <View style={styles.verifiedBadge}>
              <Ionicons color={colors.successText} name="shield-checkmark" size={14} />
              <Text style={styles.verified}>{t('profile.verified')}</Text>
            </View>
          ) : null}
          <ModeSwitch />
        </View>

        {!isVerified && currentUser ? (
          <Notice
            action={{ label: t('profile.verifyNow'), onPress: () => setShowVerification(true) }}
            title={t('profile.verifyTitle')}
            tone="warning"
          >
            {t('profile.verifyText')}
          </Notice>
        ) : null}

        <Text style={styles.sectionLabel}>{t('profile.account')}</Text>
        <View style={styles.menuCard}>
          <ListItem
            icon="person-outline"
            onPress={() => router.push('/profile-edit')}
            subtitle={t('profile.personalSubtitle')}
            title={t('profile.personalTitle')}
          />
          <Divider />
          <ListItem
            icon={isPlus ? 'sparkles' : 'sparkles-outline'}
            onPress={() => router.push('/plus')}
            subtitle={isPlus ? t('profile.planActive') : t('profile.planFree')}
            title={t('profile.planTitle')}
          />
          <Divider />
          <ListItem
            icon="shield-checkmark-outline"
            onPress={() => router.push('/legal')}
            subtitle={t('profile.legalSubtitle')}
            title={t('profile.legalTitle')}
          />
        </View>

        <Text style={styles.sectionLabel}>{t('profile.trips')}</Text>
        <View style={styles.menuCard}>
          <ListItem
            icon="bookmark-outline"
            onPress={() => router.push('/saved-places')}
            subtitle={savedPlacesCount ? t('profile.places', { count: savedPlacesCount }) : t('profile.placesEmpty')}
            title={t('profile.placesTitle')}
          />
          <Divider />
          <ListItem
            icon="star-outline"
            onPress={() => router.push('/favorite-drivers')}
            subtitle={favoriteCount ? t('profile.favorites', { count: favoriteCount }) : t('profile.favoritesEmpty')}
            title={t('profile.favoritesTitle')}
          />
          <Divider />
          <ListItem
            icon="notifications-outline"
            onPress={() => router.push('/saved-routes')}
            subtitle={routeCount
              ? `${t('profile.routes', { count: routeCount })}${alertCount ? t('profile.routesAlerts', { count: alertCount }) : ''}`
              : t('profile.routesEmpty')}
            title={t('profile.routesTitle')}
          />
          <Divider />
          <ListItem
            icon="options-outline"
            onPress={() => router.push('/preferences')}
            subtitle={t('profile.preferencesSubtitle')}
            title={t('profile.preferencesTitle')}
          />
          <Divider />
          <ListItem
            icon="school-outline"
            onPress={() => router.push('/institution')}
            subtitle={membership ? (membership.status === 'verified' && membership.method ? t(`institution.method.${membership.method}`) : t(`institution.status.${membership.status}`)) : undefined}
            title={membership?.institution?.nombre ?? t('institution.title')}
          />
          <Divider />
          <ListItem
            icon="stats-chart-outline"
            onPress={() => router.push('/stats')}
            subtitle={t('profile.statsSubtitle')}
            title={t('profile.statsTitle')}
          />
          <Divider />
          <ListItem
            icon="document-text-outline"
            onPress={() => router.push('/requests')}
            subtitle={isDriver ? t('profile.requestsDriver') : t('profile.requestsPassenger')}
            title={t('profile.requestsTitle')}
          />
        </View>

        {isDriver ? (
          <>
            <Text style={styles.sectionLabel}>{t('profile.driver')}</Text>
            <View style={styles.menuCard}>
              <ListItem
                icon="id-card-outline"
                onPress={() => router.push('/driver-license')}
                subtitle={currentUser?.driverStatus ? driverStatusLabel(currentUser.driverStatus) : t('profile.licenseEmpty')}
                title={t('profile.licenseTitle')}
              />
              <Divider />
              <ListItem
                icon="car-outline"
                onPress={() => router.push('/vehicles')}
                subtitle={t('profile.vehiclesSubtitle')}
                title={t('profile.vehiclesTitle')}
              />
              <Divider />
              <ListItem
                icon="sync-outline"
                onPress={() => router.push('/recurring-trips')}
                subtitle={t('profile.recurringSubtitle')}
                title={t('profile.recurringTitle')}
              />
            </View>
          </>
        ) : null}

        {notificationsEnabled !== null && notificationService.isAvailable() ? (
          <View style={[styles.menuCard, styles.switchRow]}>
            <View style={styles.switchText}>
              <Text style={styles.switchTitle}>{t('profile.notifications')}</Text>
              <Text style={styles.switchSubtitle}>{t('profile.notificationsSubtitle')}</Text>
            </View>
            <Switch
              accessibilityLabel={t('profile.notifications')}
              disabled={savingNotifications}
              onValueChange={(value) => void toggleNotifications(value)}
              value={notificationsEnabled}
            />
          </View>
        ) : null}

        <View style={styles.menuCard}>
          <ListItem
            icon="color-palette-outline"
            onPress={() => router.push('/display')}
            subtitle={t('appearance.menuSubtitle')}
            title={t('appearance.menuTitle')}
          />
        </View>

        {error ? <Notice tone="error">{error}</Notice> : null}

        {/* Logout Action */}
        <View style={styles.logoutContainer}>
          <ButtonSecondary icon="log-out-outline" onPress={() => setShowLogoutModal(true)} title={t('profile.logout')} />
          {isSupabaseEnabled ? (
            <Pressable
              accessibilityRole="button"
              disabled={deleting}
              onPress={() => setShowDeleteModal(true)}
              style={styles.deleteButton}
            >
              <Text style={styles.deleteText}>{deleting ? t('profile.deleting') : t('profile.delete')}</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.footer}>
          <BrandLogo size="sm" />
          <Text style={styles.version}>{t('profile.version', { version: Constants.expoConfig?.version ?? '1.0.0' })}</Text>
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
        cancelLabel={t('common.cancel')}
        confirmLabel={t('profile.deleteConfirm')}
        icon="trash-outline"
        tone="danger"
        message={t('profile.deleteMessage')}
        onCancel={() => {
          setShowDeleteModal(false);
          // Came from the new-terms modal: it comes back.
          useLegalGate.getState().resume();
        }}
        onConfirm={() => void handleConfirmDelete()}
        title={t('profile.deleteTitle')}
        visible={showDeleteModal}
      />

      {/* Confirmation Dialog */}
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('profile.logoutConfirm')}
        icon="log-out-outline"
        message={t('profile.logoutMessage')}
        onCancel={() => setShowLogoutModal(false)}
        onConfirm={handleConfirmLogout}
        title={t('profile.logoutTitle')}
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
  // Full width + centered text: with a shrink-to-fit width, some Android fonts
  // (HyperOS at 0.9 font scale) draw wider than measured and the last line is clipped.
  name: {
    ...typography.headingM,
    alignSelf: 'stretch',
    color: colors.text,
    textAlign: 'center',
  },
  email: {
    ...typography.bodySmall,
    alignSelf: 'stretch',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  verificationRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing[4],
  },
  verifiedBadge: {
    alignItems: 'center',
    backgroundColor: colors.successLight,
    borderRadius: radius.radiusFull,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing[12],
    paddingVertical: 4,
  },
  sectionLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', letterSpacing: 0.8, marginBottom: -spacing[8], marginLeft: spacing[4], textTransform: 'uppercase' },
  footer: { alignItems: 'center', gap: 2, marginTop: spacing[8] },
  version: { ...typography.caption, color: colors.textSecondary, marginTop: 4 },
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
    backgroundColor: colors.errorLight,
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
