import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';

/** Small "ConVía+" tag for premium features and the plan row. */
export function PlusBadge({ compact = false }: Readonly<{ compact?: boolean }>) {
  return (
    <View accessibilityLabel="ConVía+" style={[styles.badge, compact ? styles.compact : null]}>
      <Text style={[styles.text, compact ? styles.textCompact : null]}>
        {compact ? '+' : <>Con<Text style={styles.via}>Vía</Text>+</>}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.radiusFull,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  compact: { paddingHorizontal: 6, paddingVertical: 0 },
  text: { color: colors.text, fontSize: 12, fontWeight: '800', letterSpacing: -0.2 },
  textCompact: { color: colors.primary, fontSize: 13 },
  via: { color: colors.primary },
});
