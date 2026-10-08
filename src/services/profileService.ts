import { ensureSupabaseConfigured, isSupabaseEnabled, supabase } from '@/lib/supabase';

export type ProfileDetails = {
  name: string;
  phone: string;
  avatarUrl?: string;
  verified: boolean;
  verifiedAt?: string;
  notificationsEnabled: boolean;
};

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const profileService = {
  async getProfile(userId: string): Promise<ProfileDetails> {
    if (!isSupabaseEnabled) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    // Own private fields (phone, notification setting) via the server: the
    // profiles table no longer exposes them, not even for one's own row.
    const { data: profile, error } = await supabase.rpc('get_my_profile');
    if (error) throw error;
    const data = profile as {
      id: string; nombre: string; telefono: string | null; avatar_url: string | null;
      verification_status: string; verified_at: string | null; notifications_enabled: boolean;
    } | null;
    if (!data || data.id !== userId) throw new Error('PERFIL_NO_ENCONTRADO');
    return {
      name: data.nombre,
      phone: data.telefono ?? '',
      avatarUrl: data.avatar_url ?? undefined,
      verified: data.verification_status === 'verificado',
      verifiedAt: data.verified_at ?? undefined,
      notificationsEnabled: data.notifications_enabled,
    };
  },

  async updateProfile(userId: string, input: { name: string; phone: string }) {
    if (!isSupabaseEnabled) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { error } = await supabase
      .from('profiles')
      .update({ nombre: input.name, telefono: input.phone || null })
      .eq('id', userId);
    if (error) throw error;
  },

  async changePassword(password: string) {
    if (!isSupabaseEnabled) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  },

  /** Uploads to avatars/<uid>/avatar.<ext> (public bucket) and stores the URL. */
  async uploadAvatar(userId: string, uri: string, mimeType = 'image/jpeg'): Promise<string> {
    if (!isSupabaseEnabled) throw new Error('SUPABASE_REQUIRED');
    ensureSupabaseConfigured();
    const extension = EXTENSIONS[mimeType];
    if (!extension) throw new Error('Formato no soportado. Usa JPG, PNG o WebP.');
    const image = await (await fetch(uri)).arrayBuffer();
    if (!image.byteLength) throw new Error('No se pudo leer la imagen seleccionada.');
    if (image.byteLength > 5 * 1024 * 1024) throw new Error('La imagen supera el límite de 5 MB.');

    const path = `${userId}/avatar.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, image, { contentType: mimeType, upsert: true });
    if (uploadError) throw uploadError;

    // Cache-bust so the new photo shows even though the path is reused.
    const publicUrl = `${supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
    const { error } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', userId);
    if (error) throw error;
    return publicUrl;
  },
};
