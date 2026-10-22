import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { FunctionsHttpError } from '@supabase/supabase-js';

import { ensureSupabaseConfigured, supabase } from '@/lib/supabase';
import { LEGAL_VERSION } from '@/content/legal';
import { notificationService } from '@/services/notificationService';
import { DriverStatus, User, UserRole } from '@/types';
import { microsoftErrorMessage, parseAuthUrl } from '@/utils/authLink';

const SESSION_KEY = 'convia.demo.session';
const useSupabase = process.env.EXPO_PUBLIC_USE_SUPABASE === 'true';

type SupabaseProfile = {
  id: string;
  nombre: string;
  email: string;
  rol: 'usuario' | 'conductor';
  avatar_url: string | null;
  verification_status: string;
  verified_at: string | null;
  driver_status: DriverStatus | null;
};

const buildDemoUser = (email: string, role: UserRole, name: string, id: string): User => ({
  id,
  name,
  email,
  role,
});

const mapProfile = (profile: SupabaseProfile): User => ({
  id: profile.id,
  name: profile.nombre,
  email: profile.email,
  role: profile.rol === 'conductor' ? 'driver' : 'client',
  avatarUrl: profile.avatar_url ?? undefined,
  faceVerified: profile.verification_status === 'verificado',
  faceVerifiedAt: profile.verified_at ?? undefined,
  driverStatus: profile.driver_status ?? null,
});

const getSupabaseUser = async (): Promise<User | null> => {
  ensureSupabaseConfigured();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) return null;

  // The user's own private fields come from a server function: other users'
  // email and phone are not readable from the profiles table.
  const { data, error } = await supabase.rpc('get_my_profile');
  if (error) throw error;
  if (!data) {
    // A login without its profile row can't use the app; end the session cleanly.
    await supabase.auth.signOut({ scope: 'local' });
    throw new Error('PERFIL_NO_ENCONTRADO');
  }
  return mapProfile(data as unknown as SupabaseProfile);
};

/** Where the confirmation e-mail sends the user back: the app on phones, this site on the web build. */
function authCallbackUrl() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.origin}${process.env.EXPO_PUBLIC_WEB_BASE_URL ?? ''}/callback`;
  }
  return 'convia://callback';
}

/** Microsoft sign-in is shown only once the Azure provider is configured in Supabase. */
export const isMicrosoftAuthEnabled = process.env.EXPO_PUBLIC_MICROSOFT_AUTH === 'true';

/**
 * Microsoft goes straight to the institution's sign-in page instead of the
 * generic account picker. The server still checks the tenant (migration 27);
 * this is only a shortcut for the person.
 */
const MICROSOFT_DOMAIN_HINT = process.env.EXPO_PUBLIC_MICROSOFT_DOMAIN_HINT ?? 'unisabana.edu.co';

/** Marks on the callback URL that the person is coming back from Microsoft (web build). */
export const MICROSOFT_CALLBACK_FLAG = 'microsoft';

/** The terms are shown next to the Microsoft button: continuing accepts them (first time only). */
export async function acceptTermsIfNeeded(userId: string) {
  // Never blocks the sign-in: the person already accepted by continuing.
  await supabase
    .from('profiles')
    .update({ terms_accepted_at: new Date().toISOString() })
    .eq('id', userId)
    .is('terms_accepted_at', null);
}

// The same PKCE code can reach the app twice (the browser result and the
// convia://callback deep link); it is exchanged only once.
const exchanges = new Map<string, Promise<void>>();
export function exchangeAuthCode(code: string) {
  let exchange = exchanges.get(code);
  if (!exchange) {
    exchange = supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) throw error;
    });
    exchanges.set(code, exchange);
  }
  return exchange;
}

export const authService = {
  async getCurrentUser(): Promise<User | null> {
    if (useSupabase) return getSupabaseUser();

    const rawSession = await SecureStore.getItemAsync(SESSION_KEY);
    if (!rawSession) return null;

    try {
      const parsed = JSON.parse(rawSession) as { user?: User };
      if (!parsed.user) return null;
      return parsed.user;
    } catch {
      return null;
    }
  },

  async login(email: string, password = ''): Promise<User> {
    if (useSupabase) {
      ensureSupabaseConfigured();
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.user) throw new Error('No se pudo iniciar sesión.');
      const user = await getSupabaseUser();
      if (!user) throw new Error('No se encontró el perfil del usuario.');
      return user;
    }

    const user = buildDemoUser(email, 'client', 'Merchito', 'mock-user-current');
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify({ user }));
    return user;
  },

  /**
   * Institutional Microsoft account (Supabase Auth + Azure provider, PKCE).
   * The server only accepts allowlisted tenants with the institution's domain
   * (migration 27). Signs in and also creates the account the first time.
   *
   * Phones: opens Microsoft in an in-app browser and returns the user, or
   * null when the person closes the window.
   * Web: the whole page goes to Microsoft and comes back to /callback, which
   * finishes the sign-in; this returns null and the page navigates away.
   * (Safari blocks a popup opened after an awaited request, so no popup.)
   */
  async signInWithMicrosoft(): Promise<User | null> {
    ensureSupabaseConfigured();
    const scopes = 'openid email profile offline_access';
    const queryParams = { domain_hint: MICROSOFT_DOMAIN_HINT, prompt: 'select_account' };

    if (Platform.OS === 'web') {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'azure',
        options: { redirectTo: `${authCallbackUrl()}?via=${MICROSOFT_CALLBACK_FLAG}`, scopes, queryParams },
      });
      if (error) throw error;
      return null;
    }

    const redirectTo = authCallbackUrl();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: { redirectTo, skipBrowserRedirect: true, scopes, queryParams },
    });
    if (error) throw error;
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') return null;
    const link = parseAuthUrl(result.url);
    if (link.errorCode || !link.code) throw new Error(microsoftErrorMessage(link));
    await exchangeAuthCode(link.code);
    const user = await getSupabaseUser();
    if (!user) throw new Error('No se encontró el perfil del usuario.');
    await acceptTermsIfNeeded(user.id);
    return user;
  },

  async register(
    name: string,
    email: string,
    password: string,
    role: UserRole,
  ): Promise<User> {
    if (useSupabase) {
      ensureSupabaseConfigured();
      const { data: domains, error: domainError } = await supabase.rpc('check_email_domain', {
        p_email: email,
      });
      if (domainError) throw domainError;
      if (!domains?.length) throw new Error('DOMINIO_NO_PERMITIDO');

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            nombre: name,
            // Everyone starts as a passenger; driver mode unlocks after the
            // license check (the sign-up screen sends drivers straight there).
            rol: 'usuario',
            terms_accepted: true,
            // Which text they accepted; kept in the auth user's metadata.
            terms_version: LEGAL_VERSION,
          },
          // Route groups are not part of the URL: app/(auth)/callback.tsx is /callback.
          emailRedirectTo: authCallbackUrl(),
        },
      });
      if (error) throw error;
      if (!data.session) throw new Error('CONFIRMACION_DE_CORREO_REQUERIDA');

      const user = await getSupabaseUser();
      if (!user) throw new Error('No se encontró el perfil creado.');
      return user;
    }

    const user = buildDemoUser(email, role, name, `mock-user-${role}-${Date.now()}`);
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify({ user }));
    return user;
  },

  async logout(): Promise<void> {
    if (useSupabase) {
      ensureSupabaseConfigured();
      const { data } = await supabase.auth.getSession();
      if (data.session) await notificationService.unregister(data.session.user.id);
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      return;
    }

    await SecureStore.deleteItemAsync(SESSION_KEY);
  },

  /** Permanently deletes the account through the delete-account Edge Function. */
  async deleteAccount(): Promise<void> {
    if (!useSupabase) throw new Error('Eliminar la cuenta requiere conexión con Supabase.');
    ensureSupabaseConfigured();
    const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
    if (error) {
      const body = error instanceof FunctionsHttpError
        ? ((await error.context.json().catch(() => null)) as { error?: string } | null)
        : null;
      if (body?.error === 'ACTIVE_TRIP') throw new Error('Finaliza tu viaje en curso antes de eliminar la cuenta.');
      throw new Error('No se pudo eliminar la cuenta. Inténtalo más tarde.');
    }
    // The user no longer exists server-side; drop the local session only.
    await supabase.auth.signOut({ scope: 'local' });
  },
};
