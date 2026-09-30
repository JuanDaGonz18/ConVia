import { StyleSheet, Text, TextStyle, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/constants/colors';

/**
 * Brand hierarchy: the product is WheelsApp; the company behind it is ConVía.
 * ConVía is always written "Con" (text color) + "Vía" (brand blue).
 */

const SIZES = {
  sm: { fontSize: 18, lineHeight: 24, mark: 30, icon: 16 },
  md: { fontSize: 24, lineHeight: 30, mark: 40, icon: 22 },
  lg: { fontSize: 36, lineHeight: 44, mark: 76, icon: 40 },
} as const;

type BrandSize = keyof typeof SIZES;

/** "ConVía" with the company colors. Inherits size from `style`. */
export function ConVia({ style }: Readonly<{ style?: TextStyle }>) {
  return (
    <Text accessibilityLabel="ConVía" style={[styles.company, style]}>
      Con<Text style={styles.via}>Vía</Text>
    </Text>
  );
}

/** "Un servicio de ConVía" — the company credit under the app name. */
export function CompanyCredit({ prefix = 'Un servicio de', size = 13 }: Readonly<{ prefix?: string; size?: number }>) {
  return (
    <Text style={[styles.credit, { fontSize: size, lineHeight: size + 5 }]}>
      {prefix} <ConVia style={{ fontSize: size + 1, lineHeight: size + 5 }} />
    </Text>
  );
}

/** Round app mark: a car on its way. */
export function BrandMark({ size = 'md' }: Readonly<{ size?: BrandSize }>) {
  const { mark, icon } = SIZES[size];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.mark, { borderRadius: mark / 2, height: mark, width: mark }]}
    >
      <Ionicons color={colors.white} name="car-sport" size={icon} />
    </View>
  );
}

/** The app name, "WheelsApp". */
export function AppName({ size = 'md', style }: Readonly<{ size?: BrandSize; style?: TextStyle }>) {
  const { fontSize, lineHeight } = SIZES[size];
  return (
    <Text accessibilityRole="header" style={[styles.app, { fontSize, lineHeight }, style]}>
      Wheels<Text style={styles.appAccent}>App</Text>
    </Text>
  );
}

/** Mark + app name, optionally with the ConVía credit underneath (auth screens, about). */
export function BrandLockup({ size = 'lg', withCompany = true }: Readonly<{ size?: BrandSize; withCompany?: boolean }>) {
  return (
    <View style={styles.lockup}>
      <BrandMark size={size} />
      <AppName size={size} />
      {withCompany ? <CompanyCredit /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  company: { color: colors.text, fontWeight: '800', letterSpacing: -0.2 },
  via: { color: colors.primary },
  credit: { color: colors.textSecondary, fontWeight: '500', textAlign: 'center' },
  app: { color: colors.text, fontWeight: '800', letterSpacing: -0.5 },
  appAccent: { color: colors.primary },
  lockup: { alignItems: 'center', gap: 8 },
  mark: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    elevation: 6,
    justifyContent: 'center',
    marginBottom: 4,
    shadowColor: colors.primary,
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
});
