import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/constants/colors';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';
import { driverService } from '@/services/driverService';
import { useAppStore } from '@/store/appStore';
import { UserRole } from '@/types';
import { errorMessage } from '@/utils/format';

type ModeSwitchProps = Readonly<{
  /** Smaller version for headers. */
  compact?: boolean;
}>;

/**
 * Passenger / driver switch for the same account. Driver mode stays locked
 * (padlock) until the license identity check is approved: tapping it opens
 * that check, and leaving it unfinished keeps the user a passenger.
 */
export function ModeSwitch({ compact = false }: ModeSwitchProps) {
  const currentUser = useAppStore((state) => state.currentUser);
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const [switching, setSwitching] = useState<UserRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const driverApproved = currentUser?.driverStatus === 'aprobado';

  const select = async (role: UserRole) => {
    if (!currentUser || currentUser.role === role || switching) return;
    if (role === 'driver' && !driverApproved) {
      router.push('/driver-license');
      return;
    }
    setSwitching(role);
    setError(null);
    try {
      await driverService.switchRole(role);
      setCurrentUser({ ...currentUser, role });
    } catch (switchError) {
      setError(errorMessage(switchError, 'No se pudo cambiar de modo.'));
    } finally {
      setSwitching(null);
    }
  };

  return (
    <View style={styles.wrapper}>
      <View accessibilityRole="radiogroup" style={[styles.track, compact ? styles.trackCompact : null]}>
        {(['client', 'driver'] as const).map((mode) => {
          const active = currentUser?.role === mode;
          const locked = mode === 'driver' && !driverApproved;
          const color = active ? colors.white : colors.primary;
          return (
            <Pressable
              accessibilityHint={locked ? 'Primero debes verificar tu licencia de conducción' : undefined}
              accessibilityLabel={mode === 'driver' ? 'Modo conductor' : 'Modo pasajero'}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled: switching !== null }}
              disabled={switching !== null}
              key={mode}
              onPress={() => void select(mode)}
              style={[styles.option, compact ? styles.optionCompact : null, active ? styles.optionActive : null]}
            >
              {switching === mode ? (
                <ActivityIndicator color={color} size="small" />
              ) : (
                <Ionicons color={color} name={mode === 'driver' ? 'car-sport' : 'person'} size={compact ? 14 : 16} />
              )}
              <Text style={[styles.label, compact ? styles.labelCompact : null, active ? styles.labelActive : null]}>
                {mode === 'driver' ? 'Conductor' : 'Pasajero'}
              </Text>
              {locked ? <Ionicons accessibilityLabel="Bloqueado" color={color} name="lock-closed" size={compact ? 12 : 14} /> : null}
            </Pressable>
          );
        })}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', gap: spacing[4] },
  track: { backgroundColor: colors.primaryLight, borderRadius: radius.radiusFull, flexDirection: 'row', padding: 4 },
  trackCompact: { padding: 3 },
  option: {
    alignItems: 'center',
    borderRadius: radius.radiusFull,
    flexDirection: 'row',
    gap: spacing[4],
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[8],
  },
  optionCompact: { paddingHorizontal: spacing[12], paddingVertical: 6 },
  optionActive: { backgroundColor: colors.primary },
  label: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  labelCompact: { fontSize: 12 },
  labelActive: { color: colors.white },
  error: { ...typography.caption, color: colors.error, textAlign: 'center' },
});
