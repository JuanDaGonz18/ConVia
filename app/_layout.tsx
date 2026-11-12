import 'react-native-gesture-handler';

import { type ErrorBoundaryProps, router, Stack, useSegments } from 'expo-router';
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
import { monitoring } from '@/services/monitoringService';
import { notificationService } from '@/services/notificationService';
import { purgeLegacyCredentials } from '@/services/legacyCredentialPurge';
import { isSupabaseEnabled, supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/appStore';
import { SubscriptionSync } from '@/subscription/usePlan';
import { loadLanguagePreference } from '@/i18n';
import { preloadIconFonts } from '@/utils/iconFonts';
import React, { useEffect, useState } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { AccessibilityInfo } from 'react-native';
import WelcomeScreen from '@/components/layout/WelcomeScreen';

// Before any screen renders: on the web, icons must not each start a font load that can time out.
preloadIconFonts();
// The saved language (Español, English or the phone's); until it loads, the phone's language is used.
void loadLanguagePreference();
// Uncaught JS errors go to client_errors (no personal data), including a fatal one from the last run.
monitoring.install();
// Passwords saved by the old "Recordarme" option are deleted; the Supabase session alone keeps users signed in.
void purgeLegacyCredentials();

/** Keeps the current route pattern (e.g. "chat/[tripId]", never the ids) for error reports. */
function ScreenTracker() {
  const segments = useSegments();
  useEffect(() => monitoring.setScreen(segments), [segments]);
  return null;
}

// A screen without its own ErrorBoundary that throws while rendering lands here (Expo Router passes
// the error up to the nearest boundary): a translated message with "Try again" instead of a blank app.
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <AppErrorFallback {...props} />;
}

// Prevent the native splash screen from auto-hiding. We hide it immediately after RN mounts.
SplashScreen.preventAutoHideAsync();



export default function RootLayout() {
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);

  const [appReady, setAppReady] = useState(false);
  const [welcomeComplete, setWelcomeComplete] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  // Initialise resources and hide native splash as soon as React Native mounts.
  useEffect(() => {
    async function prepare() {
      try {
        await preloadIconFonts();
        await loadLanguagePreference();
        const rm = await AccessibilityInfo.isReduceMotionEnabled?.();
        setReduceMotion(!!rm);
      } catch (e) {
        console.warn('Error during app preparation', e);
      } finally {
        setAppReady(true);
        // Hide the native splash immediately so WelcomeScreen is visible without black flash
        await SplashScreen.hideAsync().catch(() => undefined);
      }
    }
    prepare();
  }, []);

  // Supabase auth listener – unchanged logic.
  useEffect(() => {
    if (!isSupabaseEnabled) return;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setCurrentUser(null);
        membershipService.clear();
        return;
      }
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
        setTimeout(() => void notificationService.register(session.user.id), 0);
      }
      if (
        event === 'SIGNED_IN' ||
        event === 'TOKEN_REFRESHED' ||
        event === 'USER_UPDATED' ||
        (event === 'INITIAL_SESSION' && session)
      ) {
        void membershipService.refresh().catch(() => undefined);
        void authService
          .getCurrentUser()
          .then(setCurrentUser)
          .catch((error) => {
            console.warn('[Auth] Could not refresh the current profile', error);
          });
      }
    });
    return () => data.subscription.unsubscribe();
  }, [setCurrentUser]);

  // Push notification tap handling – unchanged.
  useEffect(() =>
    notificationService.addTapListener(({ type, kind, tripId }) => {
      if (type === 'trip_updated' && kind === 'finished' && typeof tripId === 'string') {
        router.push({ pathname: '/trip-summary', params: { tripId, rate: '1' } });
        return;
      }
      if (type === 'trip_alert') {
        router.push('/saved-routes');
        return;
      }
      if (type === 'recurring_published') {
        router.push('/recurring-trips');
        return;
      }
      if (type === 'message' && typeof tripId === 'string')
        router.push({ pathname: '/chat/[tripId]', params: { tripId } });
      else if (type === 'message') router.navigate('/(tabs)/chats');
      else if (type === 'trip_updated' || (typeof type === 'string' && type.startsWith('request_')))
        router.push('/requests');
    }),
  []);

  return (
    <SafeAreaProvider>
      <StatusBar style={isDarkTheme ? 'light' : 'dark'} />
      <AppFrame>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: 'slide_from_right',
          }}>
          <Stack.Screen name="index" options={{ animation: 'fade' }} />
          <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
          <Stack.Screen name="map" options={{ animation: 'fade_from_bottom' }} />
        </Stack>
        <ScreenTracker />
        <SubscriptionSync />
        <PlusGateHost />
        {/* Last, so it covers the Plus modal: new terms to accept block the app. */}
        <LegalGateHost />
        <ToastHost />
        {/* Overlay welcome screen – visible until both preparation and transition animation complete */}
        {(!appReady || !welcomeComplete) && (
          <WelcomeScreen
            reduceMotion={reduceMotion}
            onAnimationComplete={() => setWelcomeComplete(true)}
          />
        )}
      </AppFrame>
    </SafeAreaProvider>
  );
}
