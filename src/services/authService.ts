import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { Platform, TurboModuleRegistry } from 'react-native';

import { FunctionsHttpError } from '@supabase/supabase-js';

import { ensureSupabaseConfigured, supabase } from '@/lib/supabase';
import { LEGAL_VERSION } from '@/content/legal';
import { legalService } from '@/services/legalService';
import { monitoring } from '@/services/monitoringService';
import { notificationService } from '@/services/notificationService';
import { DriverStatus, User, UserRole } from '@/types';
import { googleErrorMessage, parseAuthUrl } from '@/utils/authLink';

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

/** Google sign-in is shown only once the Google provider is configured in Supabase (docs/OPERACION.md §5b). */
export const isGoogleAuthEnabled = process.env.EXPO_PUBLIC_GOOGLE_AUTH === 'true';

/** Marks on the callback URL that the person is coming back from Google (web build). */
export const GOOGLE_CALLBACK_FLAG = 'google';

/** Callback flags of the OAuth providers: coming back with one of these accepts the terms (first time only). */
export const OAUTH_CALLBACK_FLAGS: readonly string[] = [GOOGLE_CALLBACK_FLAG];

type OAuthOptions = {
  provider: 'google';
  flag: string;
  method: 'google';
  scopes?: string;
  queryParams: Record<string, string>;
  errorMessage: (link: ReturnType<typeof parseAuthUrl>) => string;
};

/**
 * Supabase Auth OAuth with PKCE (Google; ready for other providers).
 * Phones: opens the provider in the system browser and returns the user, or
 * null when the person closes the window.
 * Web: the whole page goes to the provider and comes back to /callback, which
 * finishes the sign-in; this returns null and the page navigates away.
 * (Safari blocks a popup opened after an awaited request, so no popup.)
 */
async function signInWithOAuthProvider({ provider, flag, method, scopes, queryParams, errorMessage }: OAuthOptions): Promise<User | null> {
  ensureSupabaseConfigured();

  if (Platform.OS === 'web') {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${authCallbackUrl()}?via=${flag}`, scopes, queryParams },
    });
    if (error) throw error;
    return null;
  }

  const redirectTo = authCallbackUrl();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true, scopes, queryParams },
  });
  if (error) throw error;
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return null;
  const link = parseAuthUrl(result.url);
  if (link.errorCode || !link.code) throw new Error(errorMessage(link));
  await exchangeAuthCode(link.code);
  const user = await getSupabaseUser();
  if (!user) throw new Error('No se encontró el perfil del usuario.');
  await acceptTermsIfNeeded(user.id);
  monitoring.track('login', { method });
  return user;
}

/**
 * Google's Web client ID (Google Cloud project of ConVía). Public: it is in every Google sign-in
 * page. The native Android sign-in asks Google for an ID token for this client, which is the one
 * Supabase's Google provider checks.
 */
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
  || '838011381220-91oa592r2inufq210np6do44309vcdtp.apps.googleusercontent.com';

type GoogleSigninLib = typeof import('@react-native-google-signin/google-signin');

/**
 * The native Google sign-in library, on Android builds that include it. An APK from before it was
 * added gets this code by an over-the-air update without the native part: then null, and the
 * browser flow is used. (Importing the library without its native module would throw.)
 */
function nativeGoogleSignin(): GoogleSigninLib | null {
  if (Platform.OS !== 'android' || !TurboModuleRegistry.get('RNGoogleSignin')) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@react-native-google-signin/google-signin') as GoogleSigninLib;
  } catch {
    return null;
  }
}

class GoogleNativeUnavailable extends Error {}

/**
 * Android: Google's own account picker (a bottom sheet), no browser. Returns null when the person
 * closes it. Throws GoogleNativeUnavailable when the native path can't be used here (no Play
 * services, or the Android client isn't set up in Google Cloud), so the caller falls back to the
 * browser flow.
 */
async function signInWithGoogleNative(lib: GoogleSigninLib): Promise<User | null> {
  const { GoogleSignin, statusCodes } = lib;
  let idToken: string | null = null;
  try {
    GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Forget the last account so the picker always shows (as prompt=select_account does on the web).
    await GoogleSignin.signOut().catch(() => undefined);
    const response = await GoogleSignin.signIn();
    if (response.type !== 'success') return null;
    idToken = response.data.idToken;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === statusCodes.SIGN_IN_CANCELLED) return null;
    monitoring.reportError(error);
    throw new GoogleNativeUnavailable(String(code ?? 'native_google_failed'));
  }
  if (!idToken) throw new GoogleNativeUnavailable('no_id_token');

  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
  if (error) throw error;
  const user = await getSupabaseUser();
  if (!user) throw new Error('No se encontró el perfil del usuario.');
  await acceptTermsIfNeeded(user.id);
  monitoring.track('login', { method: 'google' });
  return user;
}

/** Marks on the callback URL that a password-reset link was opened: the next screen sets the new password. */
export const RESET_PASSWORD_NEXT = 'reset-password';

/**
 * The terms are shown next to the Google button: continuing accepts them (first time only),
 * in the current version. Someone who accepted an older version gets the new-terms modal instead.
 */
export async function acceptTermsIfNeeded(userId: string) {
  // Never blocks the sign-in: the person already accepted by continuing.
  const { data } = await supabase
    .from('profiles')
    .update({ terms_accepted_at: new Date().toISOString() })
    .eq('id', userId)
    .is('terms_accepted_at', null)
    .select('id');
  if (data?.length) await legalService.accept().catch(() => undefined);
}

/** Link types the e-mail templates send (supabase/templates): sign-up, password reset, e-mail change. */
export const EMAIL_LINK_TYPES = ['email', 'recovery', 'email_change'] as const;
export type EmailLinkType = (typeof EMAIL_LINK_TYPES)[number];

/**
 * Uses a token_hash from a ConVía e-mail. The e-mail only opens the callback
 * page; this runs when the person taps the button there, so link scanners
 * (Outlook Safe Links opens every link to check it) can't use up the token.
 */
export async function verifyEmailLink(tokenHash: string, type: EmailLinkType) {
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) throw error;
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
      monitoring.track('login', { method: 'password' });
      return user;
    }

    const user = buildDemoUser(email, 'client', 'Mateo Ruiz', 'mock-user-current');
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify({ user }));
    return user;
  },

  /**
   * Google account (Supabase Auth + Google provider, PKCE). Any Google account
   * works, like e-mail sign-up: an institutional address is verified by the
   * server at once (handle_new_user), any other chooses its institution after
   * logging in. Signs in and also creates the account the first time.
   */
  async signInWithGoogle(): Promise<User | null> {
    ensureSupabaseConfigured();
    const native = nativeGoogleSignin();
    if (native) {
      try {
        return await signInWithGoogleNative(native);
      } catch (error) {
        if (!(error instanceof GoogleNativeUnavailable)) throw error;
        // Falls through to the browser, which always works.
      }
    }
    return signInWithOAuthProvider({
      provider: 'google',
      flag: GOOGLE_CALLBACK_FLAG,
      method: 'google',
      queryParams: { prompt: 'select_account' },
      errorMessage: googleErrorMessage,
    });
  },

  async register(
    name: string,
    email: string,
    password: string,
    role: UserRole,
  ): Promise<User> {
    if (useSupabase) {
      ensureSupabaseConfigured();
      // Any e-mail can sign up: an institutional domain is verified by the server at once, any
      // other chooses and verifies its institution after logging in (handle_new_user).

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
      monitoring.track('signup', { confirm_email: !data.session });
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

  /**
   * Sends the password-reset e-mail. Supabase answers the same whether or not the
   * account exists, so nobody can probe which e-mails are registered.
   */
  async requestPasswordReset(email: string): Promise<void> {
    if (!useSupabase) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      // The template adds token_hash and type=recovery; the callback page sends the user to the new-password screen.
      redirectTo: authCallbackUrl(),
    });
    if (error) throw error;
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
