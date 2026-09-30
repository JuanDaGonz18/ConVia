import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/constants/colors';
import { dimensions } from '@/constants/dimensions';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

type BottomNavigationItem = {
  key: string;
  label: string;
  /** Outline icon; the filled version is used when the tab is active. */
  icon: keyof typeof Ionicons.glyphMap;
};

type BottomNavigationProps = Readonly<{
  items: BottomNavigationItem[];
  activeKey: string;
  onPress: (key: string) => void;
}>;

function filledIcon(icon: string) {
  const filled = icon.replace(/-outline$/, '');
  return (filled in Ionicons.glyphMap ? filled : icon) as keyof typeof Ionicons.glyphMap;
}

export function BottomNavigation({ items, activeKey, onPress }: BottomNavigationProps) {
  const insets = useSafeAreaInsets();

  return (
    <View accessibilityRole="tablist" style={[styles.container, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {items.map((item) => {
        const isActive = item.key === activeKey;
        return (
          <Pressable
            accessibilityLabel={item.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            key={item.key}
            onPress={() => onPress(item.key)}
            style={styles.item}
          >
            <View style={[styles.iconPill, isActive ? styles.iconPillActive : null]}>
              <Ionicons
                color={isActive ? colors.primary : colors.textSecondary}
                name={isActive ? filledIcon(item.icon) : item.icon}
                size={22}
              />
            </View>
            <Text style={[styles.label, isActive ? styles.activeLabel : null]}>{item.label}</Text>
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
    elevation: 12,
    flexDirection: 'row',
    minHeight: dimensions.bottomNavigationHeight,
    paddingHorizontal: spacing[8],
    paddingTop: 6,
    position: 'absolute',
    shadowColor: '#000',
    shadowOffset: { height: -2, width: 0 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    width: '100%',
  },
  item: { alignItems: 'center', flex: 1, gap: 2, justifyContent: 'center', minHeight: 56 },
  iconPill: { alignItems: 'center', borderRadius: radius.radiusFull, height: 32, justifyContent: 'center', width: 56 },
  iconPillActive: { backgroundColor: colors.primaryLight },
  label: { ...typography.caption, color: colors.textSecondary },
  activeLabel: { color: colors.primary, fontWeight: '700' },
});
