import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { supabase } from '@/lib/supabase';

/**
 * Older builds had a "Recordarme" option that saved the email and password in
 * secure storage. Staying signed in now relies only on the Supabase session
 * (refresh token), so any password left behind by those builds is deleted on
 * the first launch after the update. Safe to delete this file once no
 * installs older than that update remain.
 */

const LAST_KEY = 'convia.remember.last';
const DEV_SAVED_USERS_KEY = 'convia.dev.savedUsers';
const DONE_KEY = 'convia.remember.purged';

/** Same key format the old credentialStore used. */
function passwordKey(email: string) {
  return `convia.remember.pw.${email.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_')}`;
}

/** Every email that may have a saved password: the last remembered one, the dev account list and the signed-in user. */
async function knownEmails(): Promise<string[]> {
  const emails = new Set<string>();
  const add = (email: unknown) => {
    if (typeof email === 'string' && email.trim()) emails.add(email.trim().toLowerCase());
  };

  add(await SecureStore.getItemAsync(LAST_KEY).catch(() => null));
  try {
    const raw = await SecureStore.getItemAsync(DEV_SAVED_USERS_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) for (const item of list) add((item as { email?: unknown } | null)?.email);
  } catch {
    // Unreadable list: nothing to add.
  }
  try {
    const { data } = await supabase.auth.getSession();
    add(data.session?.user.email);
  } catch {
    // No session: nothing to add.
  }
  return [...emails];
}

let running: Promise<void> | null = null;

export function purgeLegacyCredentials(): Promise<void> {
  // The web build never stored passwords.
  if (Platform.OS === 'web') return Promise.resolve();
  running ??= (async () => {
    try {
      if (await SecureStore.getItemAsync(DONE_KEY)) return;
      for (const email of await knownEmails()) await SecureStore.deleteItemAsync(passwordKey(email));
      await SecureStore.deleteItemAsync(LAST_KEY);
      await SecureStore.setItemAsync(DONE_KEY, '1');
    } catch {
      // Secure storage unavailable: try again on the next launch.
      running = null;
    }
  })();
  return running;
}
