import * as SecureStore from 'expo-secure-store';

import { FunctionsHttpError } from '@supabase/supabase-js';

import { ensureSupabaseConfigured, supabase } from '@/lib/supabase';
import { notificationService } from '@/services/notificationService';
import { DriverStatus, User, UserRole } from '@/types';

const SESSION_KEY = 'wheelsapp.demo.session';
const useSupabase = process.env.EXPO_PUBLIC_USE_SUPABASE === 'true';

type SupabaseProfile = {
  id: string;
  nombre: string;
  email: string;
  rol: 'usuario' | 'conductor';
  avatar_url: string | null;
  verification_status: string;
  verified_at: string | null;
  driver_profiles: { status: DriverStatus } | null;
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
  driverStatus: profile.driver_profiles?.status ?? null,
});

const getSupabaseUser = async (): Promise<User | null> => {
  ensureSupabaseConfigured();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, nombre, email, rol, avatar_url, verification_status, verified_at, driver_profiles(status)')
    .eq('id', sessionData.session.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    // A login without its profile row can't use the app; end the session cleanly.
    await supabase.auth.signOut({ scope: 'local' });
    throw new Error('PERFIL_NO_ENCONTRADO');
  }
  return mapProfile(data as unknown as SupabaseProfile);
};

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
          },
          // Route groups are not part of the URL: app/(auth)/callback.tsx is /callback.
          emailRedirectTo: 'wheelsapp://callback',
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
