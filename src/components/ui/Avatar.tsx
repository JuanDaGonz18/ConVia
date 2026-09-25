import { Image, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { typography } from '@/constants/typography';

type AvatarProps = {
  name: string;
  imageUrl?: string;
  size?: number;
};

export function Avatar({ name, imageUrl, size = 48 }: AvatarProps) {
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  if (imageUrl) {
    return (
      <Image
        accessibilityLabel={`Avatar de ${name}`}
        source={{ uri: imageUrl }}
        style={[styles.avatar, { height: size, width: size }]}
      />
    );
  }

  return (
    <View style={[styles.avatar, styles.fallback, { height: size, width: size }]}>
      <Text style={styles.initials}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    borderRadius: radius.radiusFull,
  },
  fallback: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
  },
  initials: {
    ...typography.label,
    color: colors.primary,
  },
});
