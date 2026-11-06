import 'react-native-gesture-handler';

import { type ErrorBoundaryProps, router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { membershipService } from '@/services/membershipService';
import { AppErrorFallback } from '@/components/layout/AppErrorFallback';
import { AppFrame } from '@/components/layout/AppFrame';
import { LegalGateHost } from '@/components/legal/LegalGateHost';
import { PlusGateHost } from '@/components/subscription/PlusGate';
import { ToastHost } from '@/components/ui/Toast';
import { colors, isDarkTheme } from '@/constants/colors';
import { authService } from '@/services/authService';
import { notificationService } from '@/services/notificationService';
import { isSupabaseEnabled, supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/appStore';
import { SubscriptionSync } from '@/subscription/usePlan';
import { loadLanguagePreference } from '@/i18n';
import { preloadIconFonts } from '@/utils/iconFonts';
import { useEffect } from 'react';

// Before any screen renders: on the web, icons must not each start a font load that can time out.
preloadIconFonts();
// The saved language (Español, English or the phone's); until it loads, the phone's language is used.
void loadLanguagePreference();

// A screen without its own ErrorBoundary that throws while rendering lands here (Expo Router passes
// the error up to the nearest boundary): a translated message with "Try again" instead of a blank app.
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <AppErrorFallback {...props} />;
}

export default function RootLayout() {
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);

  useEffect(() => {
    if (!isSupabaseEnabled) return;

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setCurrentUser(null);
        membershipService.clear();
        return;
      }
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
        // Deferred: Supabase advises against awaiting its calls inside this callback.
        setTimeout(() => void notificationService.register(session.user.id), 0);
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED' || (event === 'INITIAL_SESSION' && session)) {
        void membershipService.refresh().catch(() => undefined);
        void authService.getCurrentUser().then(setCurrentUser).catch((error) => {
          console.warn('[Auth] Could not refresh the current profile', error);
        });
      }
    });

    return () => data.subscription.unsubscribe();
  }, [setCurrentUser]);

  // Open the relevant screen when the user taps a push notification.
  useEffect(() => notificationService.addTapListener(({ type, kind, tripId }) => {
    // "Trip finished": straight to the trip, with the driver rating open.
    if (type === 'trip_updated' && kind === 'finished' && typeof tripId === 'string') {
      router.push({ pathname: '/trip-summary', params: { tripId, rate: '1' } });
      return;
    }
    // A route alert found a compatible trip; recurring trips were published.
    if (type === 'trip_alert') {
      router.push('/saved-routes');
      return;
    }
    if (type === 'recurring_published') {
      router.push('/recurring-trips');
      return;
    }
    if (type === 'message' && typeof tripId === 'string') router.push({ pathname: '/chat/[tripId]', params: { tripId } });
    else if (type === 'message') router.navigate('/(tabs)/chats');
    else if (type === 'trip_updated' || (typeof type === 'string' && type.startsWith('request_'))) router.push('/requests');
  }), []);

  return (
    <SafeAreaProvider>
      <StatusBar style={isDarkTheme ? 'light' : 'dark'} />
      <AppFrame>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            // Native slide between screens; fade for the auth entry points.
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" options={{ animation: 'fade' }} />
          <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
          <Stack.Screen name="map" options={{ animation: 'fade_from_bottom' }} />
        </Stack>
        <SubscriptionSync />
        <PlusGateHost />
        {/* Last, so it covers the Plus modal: new terms to accept block the app. */}
        <LegalGateHost />
        <ToastHost />
      </AppFrame>
    </SafeAreaProvider>
  );
}
