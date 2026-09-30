import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PressableScale } from '@/components/ui/PressableScale';
import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { typography } from '@/constants/typography';

type ButtonPrimaryProps = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** Shown while `loading`, e.g. "Publicando…". */
  loadingTitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** 'danger' for destructive confirmations. */
  tone?: 'primary' | 'danger';
  accessibilityLabel?: string;
};

export function ButtonPrimary({
  title,
  onPress,
  disabled = false,
  loading = false,
  loadingTitle,
  icon,
  tone = 'primary',
  accessibilityLabel,
}: Readonly<ButtonPrimaryProps>) {
  const isDisabled = disabled || loading;

  return (
    <PressableScale
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={[styles.button, tone === 'danger' ? styles.danger : null, isDisabled && !loading ? styles.disabled : null]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={colors.white} size="small" />
        ) : icon ? (
          <Ionicons color={colors.white} name={icon} size={20} />
        ) : null}
        <Text numberOfLines={1} style={styles.title}>{loading && loadingTitle ? loadingTitle : title}</Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.radiusMedium,
    height: dimensions.controlHeight + 4,
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 3,
    width: '100%',
  },
  danger: { backgroundColor: colors.error, shadowColor: colors.error },
  disabled: { elevation: 0, opacity: 0.45, shadowOpacity: 0 },
  content: { alignItems: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  title: { ...typography.button, color: colors.white },
});
