import 'react-native-url-polyfill/auto';
// Must run before the Supabase client is created (PKCE needs Web Crypto).
import './cryptoPolyfill';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
// Genera los tipos con:  npx supabase gen types typescript --project-id hfnsgeunskbkapjavcao > src/lib/database.types.ts
import type { Database } from './database.types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// SecureStore limita cada valor a ~2 KB; la sesión se parte en trozos.
const CHUNK = 1800;
const SecureStoreAdapter = {
  async getItem(key: string) {
    const count = await SecureStore.getItemAsync(`${key}__n`);
    if (!count) return SecureStore.getItemAsync(key);
    let out = '';
    for (let i = 0; i < Number(count); i++) out += (await SecureStore.getItemAsync(`${key}__${i}`)) ?? '';
    return out;
  },
  async setItem(key: string, value: string) {
    const parts = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < parts; i++) await SecureStore.setItemAsync(`${key}__${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    await SecureStore.setItemAsync(`${key}__n`, String(parts));
  },
  async removeItem(key: string) {
    const count = Number((await SecureStore.getItemAsync(`${key}__n`)) ?? 0);
    for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(`${key}__${i}`);
    await SecureStore.deleteItemAsync(`${key}__n`);
    await SecureStore.deleteItemAsync(key);
  },
};

export const supabase = createClient<Database>(
  supabaseUrl ?? 'https://supabase-config-missing.invalid',
  supabaseAnonKey ?? 'supabase-config-missing',
  {
    auth: {
      storage: SecureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      // Email links come back as wheelsapp://callback?code=… and are exchanged
      // in app/(auth)/callback.tsx.
      flowType: 'pkce',
    },
  },
);

export function ensureSupabaseConfigured() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('SUPABASE_ENV_MISSING');
  }
}

export const isSupabaseEnabled = process.env.EXPO_PUBLIC_USE_SUPABASE === 'true';

AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    void supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
