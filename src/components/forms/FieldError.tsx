import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/constants/colors';
import { typography } from '@/constants/typography';

/**
 * Validation message under a custom field (pickers, selectors, photos), with
 * the same look as TextField's error. Renders nothing without a message.
 */
export function FieldError({ message }: Readonly<{ message?: string | null }>) {
  if (!message) return null;
  return (
    <View accessibilityLiveRegion="polite" style={styles.row}>
      <Ionicons color={colors.error} name="alert-circle" size={14} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

/** Invalid look for custom field containers, matching TextField. */
export const fieldErrorBox = { backgroundColor: '#FFFBFA', borderColor: colors.error } as const;

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  text: { ...typography.caption, color: colors.error, flex: 1 },
});
