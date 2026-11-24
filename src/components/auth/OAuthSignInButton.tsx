import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Link, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Svg, { Path } from 'react-native-svg';

import { ButtonSecondary } from '@/components/ui/ButtonSecondary';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { authService } from '@/services/authService';
import { useAppStore } from '@/store/appStore';
import { errorMessage } from '@/utils/format';

export type OAuthProvider = 'google' | 'microsoft';

type OAuthSignInButtonProps = {
  provider: OAuthProvider;
  /** e.g. "Continuar con Google" on the login screen, "Crear cuenta con Google" on sign-up. */
  title: string;
  /** Text of the divider above the button; no divider when omitted. */
  dividerText?: string;
  /** The "continuing accepts the terms" line below the button. Show it once per group of buttons. */
  showTerms?: boolean;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onError: (message: string | null) => void;
};

/** Google's multicolor "G" (brand guidelines: the logo is never recolored). */
function GoogleLogo() {
  return (
    <Svg height={18} viewBox="0 0 48 48" width={18}>
      <Path d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" fill="#FFC107" />
      <Path d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" fill="#FF3D00" />
      <Path d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" fill="#4CAF50" />
      <Path d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" fill="#1976D2" />
    </Svg>
  );
}

/**
 * Sign-in with an external account (Google or Microsoft), shared by the login
 * and sign-up screens. The first sign-in also creates the account, so both
 * screens use the same flow. Render each one only when its flag
 * (isGoogleAuthEnabled / isMicrosoftAuthEnabled) is true.
 */
export function OAuthSignInButton({ provider, title, dividerText, showTerms = true, disabled = false, onBusyChange, onError }: Readonly<OAuthSignInButtonProps>) {
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
      const user = provider === 'google' ? await authService.signInWithGoogle() : await authService.signInWithMicrosoft();
      if (!user) {
        // Web: the page is on its way to the provider; keep the button busy.
        if (Platform.OS === 'web') return;
        // Phone: the person closed the sign-in window.
        setBusy(false);
        return;
      }
      setCurrentUser(user);
      router.replace('/(tabs)');
    } catch (signInError) {
      onError(errorMessage(signInError, t(`auth.${provider}.failed`)));
      setBusy(false);
    }
  };

  return (
    <>
      {dividerText ? (
        <View style={styles.divider}>
          <View style={styles.line} />
          <Text style={styles.dividerText}>{dividerText}</Text>
          <View style={styles.line} />
        </View>
      ) : null}
      <ButtonSecondary
        disabled={disabled}
        icon={provider === 'microsoft' ? 'logo-microsoft' : undefined}
        leading={provider === 'google' ? <GoogleLogo /> : undefined}
        loading={loading}
        onPress={() => void handlePress()}
        title={title}
      />
      {showTerms ? (
        <Text style={styles.terms}>
          {t('auth.oauth.terms')}{' '}
          <Link href="/legal" style={styles.termsLink}>{t('auth.oauth.readMore')}</Link>
        </Text>
      ) : null}
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
