import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PressableScale } from '@/components/ui/PressableScale';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { typography } from '@/constants/typography';

type ButtonSecondaryProps = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  /** 'danger' for destructive actions (red text). */
  tone?: 'default' | 'danger';
  accessibilityLabel?: string;
};

export function ButtonSecondary({
  title,
  onPress,
  disabled = false,
  loading = false,
  icon,
  tone = 'default',
  accessibilityLabel,
}: Readonly<ButtonSecondaryProps>) {
  const isDisabled = disabled || loading;
  const color = tone === 'danger' ? colors.error : colors.text;

  return (
    <PressableScale
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={[styles.button, isDisabled && !loading ? styles.disabled : null]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={color} size="small" />
        ) : icon ? (
          <Ionicons color={tone === 'danger' ? colors.error : colors.primary} name={icon} size={19} />
        ) : null}
        <Text numberOfLines={1} style={[styles.title, { color }]}>{title}</Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.radiusMedium,
    borderWidth: 1,
    height: dimensions.controlHeight + 4,
    justifyContent: 'center',
    width: '100%',
  },
  disabled: { opacity: 0.45 },
  content: { alignItems: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  title: { ...typography.button },
});
