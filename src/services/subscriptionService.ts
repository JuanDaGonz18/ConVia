import { ensureSupabaseConfigured, isSupabaseEnabled, supabase } from '@/lib/supabase';
import { DEFAULT_PLANS, parsePlan, Plan, PlanTier } from '@/subscription/plans';

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
};
