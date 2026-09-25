import { DimensionValue, StyleSheet, View } from 'react-native';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';

type ProgressBarProps = {
  progress: number;
};

export function ProgressBar({ progress }: ProgressBarProps) {
  const width = `${Math.max(0, Math.min(progress, 1)) * 100}%` as DimensionValue;

  return (
    <View accessibilityRole="progressbar" style={styles.track}>
      <View style={[styles.fill, { width }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    backgroundColor: colors.lightGray,
    borderRadius: radius.radiusFull,
    height: 8,
    overflow: 'hidden',
  },
  fill: {
    backgroundColor: colors.primary,
    borderRadius: radius.radiusFull,
    height: '100%',
  },
});
