import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Link, router } from 'expo-router';

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
 * Institutional Microsoft sign-in, shared by the login and sign-up screens.
 * The first Microsoft sign-in also creates the account (the server checks
 * the tenant and the e-mail domain), so both screens use the same flow.
 * Render it only when isMicrosoftAuthEnabled is true.
 */
export function MicrosoftSignInButton({ title, dividerText = 'o', disabled = false, onBusyChange, onError }: Readonly<MicrosoftSignInButtonProps>) {
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
      onError(errorMessage(microsoftError, 'No pudimos iniciar sesión con Microsoft. Inténtalo de nuevo.'));
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
        Usa tu cuenta institucional. Al continuar aceptas los términos y la política de tratamiento de datos.{' '}
        <Link href="/legal" style={styles.termsLink}>Leer más</Link>
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
