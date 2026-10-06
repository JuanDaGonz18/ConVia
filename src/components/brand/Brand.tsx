import { StyleSheet, Text, TextStyle } from 'react-native';

import { colors } from '@/constants/colors';

/**
 * The app and its logo are "ConVía": "Con" in the text color and "Vía" in the
 * brand blue. The wordmark is the logo; there is no separate symbol.
 */

const SIZES = {
  sm: { fontSize: 18, lineHeight: 24 },
  md: { fontSize: 28, lineHeight: 34 },
  lg: { fontSize: 44, lineHeight: 52 },
} as const;

type BrandSize = keyof typeof SIZES;

/** Inline "ConVía" inside running text; inherits size from `style`. */
export function ConVia({ style }: Readonly<{ style?: TextStyle }>) {
  return (
    <Text accessibilityLabel="ConVía" style={[styles.wordmark, style]}>
      Con<Text style={styles.via}>Vía</Text>
    </Text>
  );
}

/** The ConVía logo (wordmark) on its own: auth screens, profile footer. */
export function BrandLogo({ size = 'md', style }: Readonly<{ size?: BrandSize; style?: TextStyle }>) {
  const { fontSize, lineHeight } = SIZES[size];
  return (
    <Text accessibilityLabel="ConVía" accessibilityRole="header" style={[styles.wordmark, styles.logo, { fontSize, lineHeight }, style]}>
      Con<Text style={styles.via}>Vía</Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  wordmark: { color: colors.text, fontWeight: '800', letterSpacing: -0.3 },
  logo: { letterSpacing: -1, textAlign: 'center' },
  via: { color: colors.primary },
});
