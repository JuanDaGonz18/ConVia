import { Image, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { typography } from '@/constants/typography';

type AvatarProps = {
  name: string;
  imageUrl?: string;
  size?: number;
  /** ConVía+ profile highlight: a thin blue ring. Purely visual. */
  highlight?: boolean;
};

export function Avatar({ name, imageUrl, size = 48, highlight = false }: AvatarProps) {
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const avatar = imageUrl ? (
    <Image
      accessibilityLabel={`Avatar de ${name}`}
      source={{ uri: imageUrl }}
      style={[styles.avatar, { height: size, width: size }]}
    />
  ) : (
    <View style={[styles.avatar, styles.fallback, { height: size, width: size }]}>
      <Text style={styles.initials}>{initials}</Text>
    </View>
  );

  if (!highlight) return avatar;
  return <View accessibilityLabel="Perfil ConVía+" style={styles.ring}>{avatar}</View>;
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
  ring: {
    borderColor: colors.primary,
    borderRadius: radius.radiusFull,
    borderWidth: 2,
    padding: 2,
  },
});
