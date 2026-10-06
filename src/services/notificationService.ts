import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import type * as NotificationsModule from 'expo-notifications';
import { Platform } from 'react-native';

import { isSupabaseEnabled, supabase } from '@/lib/supabase';

export type NotifyEvent = 'request_created' | 'request_responded' | 'request_cancelled' | 'message' | 'trip_updated';

type Notifications = typeof NotificationsModule;

let notificationsModule: Notifications | null | undefined;

/**
 * expo-notifications throws at import time when its native code is missing
 * (Expo Go on Android, or a dev build made before it was installed). Load it
 * only when the native module exists so the rest of the app keeps working.
 */
function getNotifications(): Notifications | null {
  if (notificationsModule !== undefined) return notificationsModule;
  if (!requireOptionalNativeModule('ExpoPushTokenManager')) {
    console.warn('[notifications] Native module unavailable; rebuild the development client to enable push.');
    notificationsModule = null;
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const module = require('expo-notifications') as Notifications;
  module.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  notificationsModule = module;
  return module;
}

async function getPushToken(): Promise<string | null> {
  const Notifications = getNotifications();
  if (!Notifications) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'ConVía',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const existing = await Notifications.getPermissionsAsync();
  const status = existing.granted ? existing.status : (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('EAS_PROJECT_ID_MISSING');
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

export const notificationService = {
  isAvailable() {
    return getNotifications() !== null;
  },

  /** Calls `onOpen` with the notification's data when the user taps it. */
  addTapListener(onOpen: (data: Record<string, unknown>) => void) {
    const Notifications = getNotifications();
    if (!Notifications) return () => undefined;
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      onOpen(response.notification.request.content.data ?? {});
    });
    return () => subscription.remove();
  },

  /**
   * Stores this device's Expo push token on the profile when the user has
   * notifications enabled. Fails quietly because the app works without push.
   */
  async register(userId: string) {
    if (!isSupabaseEnabled || !getNotifications()) return;
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('notifications_enabled')
        .eq('id', userId)
        .single();
      if (error || !profile.notifications_enabled) return;
      const token = await getPushToken();
      if (!token) return;
      await supabase.from('profiles').update({ expo_push_token: token }).eq('id', userId);
    } catch (error) {
      console.warn('[notifications] Push registration skipped', error);
    }
  },

  /** Returns false when the OS permission was denied or push is unavailable. */
  async setEnabled(userId: string, enabled: boolean): Promise<boolean> {
    let token: string | null = null;
    if (enabled) {
      token = await getPushToken();
      if (!token) return false;
    }
    const { error } = await supabase
      .from('profiles')
      .update({ notifications_enabled: enabled, expo_push_token: token })
      .eq('id', userId);
    if (error) throw error;
    return true;
  },

  /** Detach this device so a signed-out phone stops receiving pushes. */
  async unregister(userId: string) {
    if (!isSupabaseEnabled) return;
    const { error } = await supabase.from('profiles').update({ expo_push_token: null }).eq('id', userId);
    if (error) console.warn('[notifications] Could not clear push token', error);
  },

  /** Fire-and-forget: the notify Edge Function derives recipients server-side. */
  notify(event: NotifyEvent, id: string) {
    if (!isSupabaseEnabled) return;
    void supabase.functions.invoke('notify', { body: { event, id } }).then(({ error }) => {
      if (error) console.warn('[notifications] notify failed', error);
    });
  },
};
