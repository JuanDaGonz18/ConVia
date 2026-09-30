import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { create } from 'zustand';

import { NoticeTone, TONES } from '@/components/ui/Notice';
import { radius } from '@/constants/radius';
import { spacing } from '@/constants/spacing';
import { typography } from '@/constants/typography';

type ToastMessage = { id: number; tone: NoticeTone; message: string };

const useToastStore = create<{ current: ToastMessage | null; show: (tone: NoticeTone, message: string) => void; hide: () => void }>((set) => ({
  current: null,
  show: (tone, message) => set({ current: { id: Date.now(), tone, message } }),
  hide: () => set({ current: null }),
}));

/**
 * Short confirmations that survive navigation, e.g. "Viaje publicado".
 * Call from anywhere: toast.success('…'). Rendered once by <ToastHost />.
 */
export const toast = {
  success: (message: string) => useToastStore.getState().show('success', message),
  info: (message: string) => useToastStore.getState().show('info', message),
  error: (message: string) => useToastStore.getState().show('error', message),
};

const VISIBLE_MS = 3200;

export function ToastHost() {
  const current = useToastStore((state) => state.current);
  const hide = useToastStore((state) => state.hide);
  const insets = useSafeAreaInsets();
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!current) return;
    progress.setValue(0);
    Animated.spring(progress, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 6 }).start();
    const timer = setTimeout(() => {
      Animated.timing(progress, { toValue: 0, duration: 220, useNativeDriver: true }).start(({ finished }) => finished && hide());
    }, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [current, hide, progress]);

  if (!current) return null;
  const palette = TONES[current.tone];

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        { top: insets.top + spacing[8] },
        { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }] },
      ]}
    >
      <Pressable
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        onPress={hide}
        style={[styles.toast, { backgroundColor: palette.background, borderColor: palette.border }]}
      >
        <Ionicons color={palette.color} name={palette.icon} size={22} />
        <Text style={[styles.text, { color: palette.color }]}>{current.message}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: { left: spacing[16], position: 'absolute', right: spacing[16], zIndex: 1000 },
  toast: {
    alignItems: 'center',
    borderRadius: radius.radiusLarge,
    borderWidth: 1,
    elevation: 8,
    flexDirection: 'row',
    gap: spacing[12],
    paddingHorizontal: spacing[16],
    paddingVertical: spacing[12],
    shadowColor: '#000',
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
  },
  text: { ...typography.bodyMedium, flex: 1, fontWeight: '600' },
});
