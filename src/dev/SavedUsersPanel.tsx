/**
 * TEMPORARY — development/testing only. See src/dev/savedUsers.ts for how to remove it.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Avatar } from '@/components/ui/Avatar';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { credentialStore } from '@/services/credentialStore';
import { SAVED_USERS_ENABLED, SavedUser, savedUsers } from '@/dev/savedUsers';

type SavedUsersPanelProps = Readonly<{
  /** Fills the login form; `password` is null when it was not saved with "Recordarme". */
  onSelect: (email: string, password: string | null) => void;
}>;

export function SavedUsersPanel({ onSelect }: SavedUsersPanelProps) {
  const [users, setUsers] = useState<SavedUser[]>([]);
  const [withPassword, setWithPassword] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!SAVED_USERS_ENABLED) return;
    let active = true;
    void savedUsers.list().then(async (list) => {
      const saved = await Promise.all(list.map(async (user) => [user.email, !!(await credentialStore.getPassword(user.email))] as const));
      if (!active) return;
      setUsers(list);
      setWithPassword(Object.fromEntries(saved));
    });
    return () => { active = false; };
  }, []);

  if (!SAVED_USERS_ENABLED || users.length === 0) return null;

  const remove = async (email: string) => {
    await savedUsers.remove(email);
    await credentialStore.forget(email);
    setUsers((items) => items.filter((item) => item.email !== email));
  };

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Ionicons color="#B45309" name="construct-outline" size={16} />
        <Text style={styles.title}>Usuarios guardados</Text>
        <Text style={styles.badge}>SOLO DESARROLLO</Text>
      </View>
      <Text style={styles.note}>Función temporal de pruebas. No aparece en la versión publicada.</Text>
      {users.map((user) => (
        <View key={user.email} style={styles.row}>
          <Pressable
            accessibilityLabel={`Usar la cuenta ${user.email}`}
            onPress={() => void credentialStore.getPassword(user.email).then((password) => onSelect(user.email, password))}
            style={({ pressed }) => [styles.user, pressed ? styles.userPressed : null]}
          >
            <Avatar name={user.name || user.email} size={36} />
            <View style={styles.userText}>
              <Text numberOfLines={1} style={styles.name}>{user.name || user.email}</Text>
              <Text numberOfLines={1} style={styles.email}>
                {user.email} · {user.role === 'driver' ? 'Conductor' : 'Pasajero'}
              </Text>
            </View>
            <Ionicons
              accessibilityLabel={withPassword[user.email] ? 'Contraseña guardada' : 'Sin contraseña guardada'}
              color={withPassword[user.email] ? colors.success : colors.textSecondary}
              name={withPassword[user.email] ? 'key' : 'key-outline'}
              size={16}
            />
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
    backgroundColor: '#FFFBEB',
    borderColor: '#F59E0B',
    borderRadius: radius.radiusLarge,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    gap: spacing[8],
    padding: spacing[16],
  },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing[8] },
  title: { ...typography.bodyMedium, color: '#92400E', flex: 1, fontWeight: '700' },
  badge: {
    ...typography.caption,
    backgroundColor: '#F59E0B',
    borderRadius: radius.radiusFull,
    color: colors.white,
    fontSize: 10,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: spacing[8],
    paddingVertical: 2,
  },
  note: { ...typography.caption, color: '#92400E' },
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
  userPressed: { backgroundColor: '#FEF3C7' },
  userText: { flex: 1 },
  name: { ...typography.bodySmall, color: colors.text, fontWeight: '700' },
  email: { ...typography.caption, color: colors.textSecondary },
  remove: { padding: spacing[4] },
});
