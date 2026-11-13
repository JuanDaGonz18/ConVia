import { randomUUID } from 'expo-crypto';

import { ensureSupabaseConfigured, isSupabaseEnabled, supabase } from '@/lib/supabase';
import { compressPhoto, PHOTO_MAX_SIDE } from '@/services/imageCompression';
import {
  parseInstructions,
  parsePaymentInfo,
  parsePaymentRequest,
  PAYMENTS_OFF,
  type PaymentInfo,
  type PaymentInstructions,
  type PaymentPeriod,
  type PaymentRequest,
} from '@/subscription/payments';
import { DEFAULT_PLANS, parsePlan, Plan, PlanTier } from '@/subscription/plans';

/** Private bucket (migration 047): <user_id>/<uuid>.jpg, deleted 30 days after the decision. */
const RECEIPT_BUCKET = 'payment-receipts';

export type PaymentReceipt = { uri: string; width?: number; height?: number };

export const subscriptionService = {
  /**
   * The signed-in user's effective plan, as decided by the server (an expired
   * or canceled ConVía+ comes back as FREE). Demo mode is always FREE.
   */
  async getMyPlan(): Promise<Plan> {
    if (!isSupabaseEnabled) return DEFAULT_PLANS.free;
    ensureSupabaseConfigured();
    const { data, error } = await supabase.rpc('get_my_plan');
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row ? parsePlan(row) : DEFAULT_PLANS.free;
  },

  /** What each plan includes, from the server (used to compare FREE and ConVía+). */
  async getPlans(): Promise<Record<PlanTier, Plan>> {
    if (!isSupabaseEnabled) return DEFAULT_PLANS;
    ensureSupabaseConfigured();
    const { data, error } = await supabase.from('plans').select('tier, name, limits, features');
    if (error) throw error;
    const plans = { ...DEFAULT_PLANS };
    for (const row of data ?? []) {
      const plan = parsePlan({ ...row, status: 'active', current_period_end: null });
      plans[plan.tier] = plan;
    }
    return plans;
  },

  /**
   * ConVía+ by bank transfer (migration 047). Off (the default) unless the server says it is
   * enabled with a key and payee; an older server or an error also means off.
   */
  async getPaymentInfo(): Promise<PaymentInfo> {
    if (!isSupabaseEnabled) return PAYMENTS_OFF;
    const { data, error } = await supabase.rpc('get_plus_payment_info');
    if (error) return PAYMENTS_OFF;
    return parsePaymentInfo(data);
  },

  /** A unique reference (CV-XXXX) with the amount and where to send it. */
  async startPayment(period: PaymentPeriod): Promise<PaymentInstructions> {
    ensureSupabaseConfigured();
    const { data, error } = await supabase.rpc('start_plus_payment', { p_period: period });
    if (error) throw error;
    return parseInstructions(data);
  },

  /** "Ya pagué": the payment waits for the team's review. The receipt is optional. */
  async confirmPayment(reference: string, receipt?: PaymentReceipt | null): Promise<void> {
    ensureSupabaseConfigured();
    let path: string | null = null;
    if (receipt) {
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) throw new Error('AUTH_REQUIRED');
        const photo = await compressPhoto(receipt, PHOTO_MAX_SIDE.feedback);
        path = `${userData.user.id}/${randomUUID()}.jpg`;
        const bytes = await (await fetch(photo.uri)).arrayBuffer();
        const { error } = await supabase.storage.from(RECEIPT_BUCKET).upload(path, bytes, { contentType: photo.mimeType, upsert: false });
        if (error) throw error;
      } catch {
        throw new Error('PAYMENT_RECEIPT_UPLOAD_FAILED');
      }
    }
    const { error } = await supabase.rpc('confirm_plus_payment', { p_reference: reference, p_receipt: path ?? undefined });
    if (error) {
      if (path) void supabase.storage.from(RECEIPT_BUCKET).remove([path]).catch(() => undefined);
      throw error;
    }
  },

  /** The person's sent payments (RLS: only their own), newest first. */
  async myPayments(): Promise<PaymentRequest[]> {
    if (!isSupabaseEnabled) return [];
    const { data, error } = await supabase
      .from('payment_requests')
      .select('reference, period, amount_cop, status, reject_reason, submitted_at, decided_at, period_end')
      .neq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) throw error;
    return (data ?? []).map(parsePaymentRequest);
  },
};
