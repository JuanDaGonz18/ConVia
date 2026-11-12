/**
 * TEMPORARY — development/testing only. See src/dev/savedUsers.ts for how to remove it.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Avatar } from '@/components/ui/Avatar';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { SAVED_USERS_ENABLED, SavedUser, savedUsers } from '@/dev/savedUsers';

type SavedUsersPanelProps = Readonly<{
  /** Fills the login form's email; passwords are never stored. */
  onSelect: (email: string) => void;
}>;

export function SavedUsersPanel({ onSelect }: SavedUsersPanelProps) {
  const [users, setUsers] = useState<SavedUser[]>([]);

  useEffect(() => {
    if (!SAVED_USERS_ENABLED) return;
    let active = true;
    void savedUsers.list().then((list) => {
      if (active) setUsers(list);
    });
    return () => { active = false; };
  }, []);

  if (!SAVED_USERS_ENABLED || users.length === 0) return null;

  const remove = async (email: string) => {
    await savedUsers.remove(email);
    setUsers((items) => items.filter((item) => item.email !== email));
  };

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Ionicons color={colors.warningText} name="construct-outline" size={16} />
        <Text style={styles.title}>Usuarios guardados</Text>
        <Text style={styles.badge}>SOLO DESARROLLO</Text>
      </View>
      <Text style={styles.note}>Función temporal de pruebas. No aparece en la versión publicada.</Text>
      {users.map((user) => (
        <View key={user.email} style={styles.row}>
          <Pressable
            accessibilityLabel={`Usar la cuenta ${user.email}`}
            onPress={() => onSelect(user.email)}
            style={({ pressed }) => [styles.user, pressed ? styles.userPressed : null]}
          >
            <Avatar name={user.name || user.email} size={36} />
            <View style={styles.userText}>
              <Text numberOfLines={1} style={styles.name}>{user.name || user.email}</Text>
              <Text numberOfLines={1} style={styles.email}>
                {user.email} · {user.role === 'driver' ? 'Conductor' : 'Pasajero'}
              </Text>
            </View>
          </Pressable>
          <Pressable accessibilityLabel={`Olvidar ${user.email}`} hitSlop={8} onPress={() => void remove(user.email)} style={styles.remove}>
            <Ionicons color={colors.textSecondary} name="close" size={18} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.warningLight,
    borderColor: '#F59E0B',
    borderRadius: radius.radiusLarge,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    gap: spacing[8],
    padding: spacing[16],
  },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  title: { ...typography.bodyMedium, color: colors.warningText, flex: 1, fontWeight: '700' },
  badge: {
    ...typography.caption,
    backgroundColor: '#F59E0B',
    borderRadius: radius.radiusFull,
    color: colors.onPrimary,
    fontSize: 10,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: spacing[8],
    paddingVertical: 2,
  },
  note: { ...typography.caption, color: colors.warningText },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing[4] },
  user: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.radiusMedium,
    flex: 1,
    flexDirection: 'row',
    gap: spacing[12],
    padding: spacing[8],
  },
  userPressed: { backgroundColor: colors.warningLight },
  userText: { flex: 1 },
  name: { ...typography.bodySmall, color: colors.text, fontWeight: '700' },
  email: { ...typography.caption, color: colors.textSecondary },
  remove: { padding: spacing[4] },
});
