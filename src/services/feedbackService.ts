import { Platform } from 'react-native';
import Constants from 'expo-constants';

import { ensureSupabaseConfigured, supabase } from '@/lib/supabase';
import { cleanFeedbackText, type FeedbackCategory } from '@/utils/feedback';

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
 * limited by RLS to the person's own reports.
 */
export const feedbackService = {
  async submit(category: FeedbackCategory, description: string): Promise<string> {
    ensureSupabaseConfigured();
    const platform = Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web' ? Platform.OS : undefined;
    const { data, error } = await supabase.rpc('submit_feedback', {
      p_category: category,
      p_description: cleanFeedbackText(description),
      p_app_version: Constants.expoConfig?.version ?? undefined,
      p_platform: platform,
    });
    if (error) throw error;
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
