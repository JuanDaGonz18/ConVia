import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';

type LocationPinProps = {
  selected?: boolean;
};

export function LocationPin({ selected = false }: LocationPinProps) {
  return (
    <View style={[styles.pin, selected ? styles.selected : null]}>
      <Ionicons color={colors.white} name="location" size={18} />
    </View>
  );
}

const styles = StyleSheet.create({
  pin: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.radiusFull,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  selected: {
    transform: [{ scale: 1.12 }],
  },
});
