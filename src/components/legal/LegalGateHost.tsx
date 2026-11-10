import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { LEGAL_VERSION } from '@/content/legal';
import { isSupabaseEnabled } from '@/lib/supabase';
import { authService } from '@/services/authService';
import { useLegalGate } from '@/services/legalGate';
import { legalService } from '@/services/legalService';
import { useAppStore } from '@/store/appStore';

const CHANGES = [
  { key: 'ai', icon: 'sparkles-outline' },
  { key: 'pickup', icon: 'videocam-outline' },
  { key: 'card', icon: 'card-outline' },
  { key: 'signup', icon: 'person-add-outline' },
] as const;

/**
 * Blocking modal after login when the person accepted an older version of the
 * Terms and the Privacy Policy (or an AI Edge Function answered LEGAL_OUTDATED).
 * They accept explicitly, or sign out, or go delete their account. It steps
 * aside on the legal screen (to read the documents) and while the account
 * deletion dialog is open. Rendered once, in the root layout.
 */
export function LegalGateHost() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const userId = useAppStore((state) => state.currentUser?.id ?? null);
  const logoutStore = useAppStore((state) => state.logout);
  const status = useLegalGate((state) => state.status);
  const suspended = useLegalGate((state) => state.suspended);
  const [step, setStep] = useState<'review' | 'reject'>('review');
  const [busy, setBusy] = useState<'accept' | 'logout' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Each signed-in person is checked once; a failed check doesn't block (the server still refuses the AI features).
  useEffect(() => {
    if (!isSupabaseEnabled) return;
    if (!userId) {
      legalService.reset();
      return;
    }
    void legalService.check().catch((checkError) => console.warn('[Legal] Could not read the accepted version', checkError));
  }, [userId]);

  // Leaving the profile screen (after reaching it) ends the pause for the deletion dialog.
  const reachedProfile = useRef(false);
  useEffect(() => {
    if (!suspended) {
      reachedProfile.current = false;
      return;
    }
    if (pathname === '/profile') reachedProfile.current = true;
    else if (reachedProfile.current) useLegalGate.getState().resume();
  }, [pathname, suspended]);

  if (!userId || status !== 'outdated' || pathname === '/legal' || suspended) return null;

  const accept = async () => {
    setBusy('accept');
    setError(null);
    try {
      await legalService.accept();
      setStep('review');
    } catch {
      setError(t('legalGate.acceptFailed'));
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => {
    setBusy('logout');
    try {
      await authService.logout();
    } catch (logoutError) {
      console.warn('[Legal] Sign-out failed', logoutError);
    } finally {
      setBusy(null);
      setStep('review');
      legalService.reset();
      logoutStore();
      router.replace('/(auth)/login');
    }
  };

  const deleteAccount = () => {
    setStep('review');
    useLegalGate.getState().suspend();
    router.navigate({ pathname: '/(tabs)/profile', params: { delete: '1' } });
  };

  const openDocument = (doc: 'terms' | 'privacy') => router.push({ pathname: '/legal', params: { doc } });

  return (
    <Modal animationType="fade" onRequestClose={() => undefined} statusBarTranslucent transparent visible>
      <View style={styles.overlay}>
        <View accessibilityRole="alert" accessibilityViewIsModal style={styles.dialog}>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.iconCircle}>
              <Ionicons color={colors.primary} name="document-text-outline" size={28} />
            </View>

            {step === 'review' ? (
              <>
                <Text style={styles.title}>{t('legalGate.title')}</Text>
                <Text style={styles.body}>{t('legalGate.intro', { version: LEGAL_VERSION })}</Text>
                <View style={styles.changes}>
                  {CHANGES.map(({ key, icon }) => (
                    <View key={key} style={styles.change}>
                      <Ionicons color={colors.primary} name={icon} size={18} style={styles.changeIcon} />
                      <Text style={styles.changeText}>{t(`legalGate.changes.${key}`)}</Text>
                    </View>
                  ))}
                </View>
                <View style={styles.links}>
                  <Pressable accessibilityRole="link" onPress={() => openDocument('terms')}>
                    <Text style={styles.link}>{t('legalGate.readTerms')}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="link" onPress={() => openDocument('privacy')}>
                    <Text style={styles.link}>{t('legalGate.readPrivacy')}</Text>
                  </Pressable>
                </View>
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <View style={styles.actions}>
                  <ButtonPrimary
                    disabled={busy !== null}
                    icon="checkmark-circle-outline"
                    loading={busy === 'accept'}
                    onPress={() => void accept()}
                    title={t('legalGate.accept', { version: LEGAL_VERSION })}
                  />
                  <ButtonSecondary disabled={busy !== null} onPress={() => setStep('reject')} title={t('legalGate.reject')} />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.title}>{t('legalGate.rejectTitle')}</Text>
                <Text style={styles.body}>{t('legalGate.rejectBody')}</Text>
                <View style={styles.actions}>
                  <ButtonPrimary
                    disabled={busy !== null}
                    icon="log-out-outline"
                    loading={busy === 'logout'}
                    onPress={() => void signOut()}
                    title={t('legalGate.signOut')}
                  />
                  <ButtonPrimary
                    disabled={busy !== null}
                    icon="trash-outline"
                    onPress={deleteAccount}
                    title={t('legalGate.deleteAccount')}
                    tone="danger"
                  />
                  <ButtonSecondary disabled={busy !== null} onPress={() => setStep('review')} title={t('legalGate.back')} />
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(16, 24, 40, 0.5)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing[16],
  },
  dialog: {
    backgroundColor: colors.white,
    borderRadius: radius.radiusXL,
    maxHeight: '90%',
    maxWidth: 440,
    width: '100%',
  },
  content: { alignItems: 'center', gap: spacing[12], padding: spacing[24] },
  iconCircle: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusFull,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  title: { ...typography.headingM, color: colors.text, textAlign: 'center' },
  body: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  changes: { alignSelf: 'stretch', gap: spacing[8] },
  change: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing[8] },
  changeIcon: { marginTop: 2 },
  changeText: { ...typography.body, color: colors.text, flex: 1 },
  links: { alignItems: 'center', gap: spacing[8] },
  link: { ...typography.bodyMedium, color: colors.primary, textDecorationLine: 'underline' },
  error: { ...typography.caption, color: colors.error, textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: spacing[8], marginTop: spacing[4] },
});
