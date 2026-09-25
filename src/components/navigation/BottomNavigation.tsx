import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

type BottomNavigationItem = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

type BottomNavigationProps = {
  items: BottomNavigationItem[];
  activeKey: string;
  onPress: (key: string) => void;
};

export function BottomNavigation({
  items,
  activeKey,
  onPress,
}: BottomNavigationProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {items.map((item) => {
        const isActive = item.key === activeKey;

        return (
          <Pressable
            accessibilityLabel={item.label}
            accessibilityRole="tab"
            key={item.key}
            onPress={() => onPress(item.key)}
            style={styles.item}
          >
            <Ionicons
              color={isActive ? colors.primary : colors.textSecondary}
              name={item.icon}
              size={24}
            />
            <Text style={[styles.label, isActive ? styles.activeLabel : null]}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderTopColor: colors.lightGray,
    borderTopWidth: 1,
    bottom: 0,
    flexDirection: 'row',
    minHeight: dimensions.bottomNavigationHeight,
    paddingHorizontal: spacing[16],
    position: 'absolute',
    width: '100%',
  },
  item: {
    alignItems: 'center',
    flex: 1,
    gap: spacing[4],
    justifyContent: 'center',
    minHeight: 56,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  activeLabel: {
    color: colors.primary,
    fontWeight: '600',
  },
});
