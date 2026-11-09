import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Link, router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { authService } from '@/services/authService';
import { useAppStore } from '@/store/appStore';
import { errorMessage } from '@/utils/format';

type MicrosoftSignInButtonProps = {
  /** "Continuar con Microsoft" on the login screen, "Crear cuenta con Microsoft" on sign-up. */
  title: string;
  /** Text of the divider above the button. */
  dividerText?: string;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onError: (message: string | null) => void;
};

/**
 * Microsoft sign-in, shared by the login and sign-up screens. Sign-up is open:
 * any Microsoft account works, and the first sign-in also creates the account,
 * so both screens use the same flow.
 * Render it only when isMicrosoftAuthEnabled is true.
 */
export function MicrosoftSignInButton({ title, dividerText = 'o', disabled = false, onBusyChange, onError }: Readonly<MicrosoftSignInButtonProps>) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);

  const setBusy = (busy: boolean) => {
    setLoading(busy);
    onBusyChange?.(busy);
  };

  const handlePress = async () => {
    onError(null);
    setBusy(true);
    try {
      const user = await authService.signInWithMicrosoft();
      if (!user) {
        // Web: the page is on its way to Microsoft; keep the button busy.
        if (Platform.OS === 'web') return;
        // Phone: the person closed the Microsoft window.
        setBusy(false);
        return;
      }
      setCurrentUser(user);
      router.replace('/(tabs)');
    } catch (microsoftError) {
      onError(errorMessage(microsoftError, t('auth.microsoft.failed')));
      setBusy(false);
    }
  };

  return (
    <>
      <View style={styles.divider}>
        <View style={styles.line} />
        <Text style={styles.dividerText}>{dividerText}</Text>
        <View style={styles.line} />
      </View>
      <ButtonSecondary
        disabled={disabled}
        icon="logo-microsoft"
        loading={loading}
        onPress={() => void handlePress()}
        title={title}
      />
      <Text style={styles.terms}>
        {t('auth.microsoft.terms')}{' '}
        <Link href="/legal" style={styles.termsLink}>{t('auth.microsoft.readMore')}</Link>
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  divider: { alignItems: 'center', flexDirection: 'row', gap: spacing[12] },
  line: { backgroundColor: colors.lightGray, flex: 1, height: 1 },
  dividerText: { ...typography.caption, color: colors.textSecondary },
  terms: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  termsLink: { color: colors.primary, fontWeight: '700' },
});
