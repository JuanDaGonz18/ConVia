import 'react-native-gesture-handler';

import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/constants/colors';
import { authService } from '@/services/authService';
import { notificationService } from '@/services/notificationService';
import { isSupabaseEnabled, supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/appStore';
import { useEffect } from 'react';

export default function RootLayout() {
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);

  useEffect(() => {
    if (!isSupabaseEnabled) return;

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setCurrentUser(null);
        return;
      }
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
        // Deferred: Supabase advises against awaiting its calls inside this callback.
        setTimeout(() => void notificationService.register(session.user.id), 0);
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        void authService.getCurrentUser().then(setCurrentUser).catch((error) => {
          console.warn('[Auth] Could not refresh the current profile', error);
        });
      }
    });

    return () => data.subscription.unsubscribe();
  }, [setCurrentUser]);

  // Open the relevant screen when the user taps a push notification.
  useEffect(() => notificationService.addTapListener(({ type, tripId }) => {
    if (type === 'message' && typeof tripId === 'string') router.push({ pathname: '/chat/[tripId]', params: { tripId } });
    else if (type === 'message') router.push('/(tabs)/chats');
    else if (type === 'trip_updated' || (typeof type === 'string' && type.startsWith('request_'))) router.push('/requests');
  }), []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      />
    </SafeAreaProvider>
  );
}
