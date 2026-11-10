import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';

import { ensureSupabaseConfigured, supabase } from '@/lib/supabase';
import { compressPhoto, PHOTO_MAX_SIDE } from '@/services/imageCompression';
import { cleanFeedbackText, FEEDBACK_UPLOAD_FAILED, type FeedbackCategory } from '@/utils/feedback';

/** Private bucket (migration 045): <user_id>/<uuid>.jpg, deleted after 30 days. */
const SCREENSHOT_BUCKET = 'feedback';

export type FeedbackScreenshot = { uri: string; width?: number; height?: number };

export type FeedbackStatus = 'nuevo' | 'en_revision' | 'resuelto' | 'descartado';
export type FeedbackReport = {
  id: string;
  category: FeedbackCategory;
  description: string;
  status: FeedbackStatus;
  createdAt: string;
};

/**
 * Bug reports and suggestions (migration 044). Creating goes through the
 * submit_feedback RPC (server-side validation and rate limit); reading is
 * limited by RLS to the person's own reports. An optional screenshot is
 * compressed and uploaded first; if the report is refused it is removed again.
 */
export const feedbackService = {
  appVersion: () => Constants.expoConfig?.version ?? '1.0.0',

  async submit(category: FeedbackCategory, description: string, screenshot?: FeedbackScreenshot | null): Promise<string> {
    ensureSupabaseConfigured();
    let path: string | null = null;
    if (screenshot) {
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) throw new Error('AUTH_REQUIRED');
        const photo = await compressPhoto(screenshot, PHOTO_MAX_SIDE.feedback);
        path = `${userData.user.id}/${randomUUID()}.jpg`;
        const bytes = await (await fetch(photo.uri)).arrayBuffer();
        const { error } = await supabase.storage.from(SCREENSHOT_BUCKET).upload(path, bytes, { contentType: photo.mimeType, upsert: false });
        if (error) throw error;
      } catch {
        throw new Error(FEEDBACK_UPLOAD_FAILED);
      }
    }
    const platform = Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web' ? Platform.OS : undefined;
    const { data, error } = await supabase.rpc('submit_feedback', {
      p_category: category,
      p_description: cleanFeedbackText(description),
      p_app_version: Constants.expoConfig?.version ?? undefined,
      p_platform: platform,
      p_screenshot: path ?? undefined,
    });
    if (error) {
      if (path) void supabase.storage.from(SCREENSHOT_BUCKET).remove([path]).catch(() => undefined);
      throw error;
    }
    return data;
  },

  async mine(): Promise<FeedbackReport[]> {
    ensureSupabaseConfigured();
    const { data, error } = await supabase
      .from('feedback_reports')
      .select('id, category, description, status, created_at')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      category: row.category as FeedbackCategory,
      description: row.description,
      status: row.status as FeedbackStatus,
      createdAt: row.created_at,
    }));
  },
};
