import { useEffect } from 'react';
import { create } from 'zustand';

import { subscriptionService } from '@/services/subscriptionService';
import { useAppStore } from '@/store/appStore';
import { Capability, DEFAULT_PLANS, isAtLimit, isBetaPerk, Plan, PlanLimit } from '@/subscription/plans';

type SubscriptionStore = {
  /** Owner of `plan`; another account never sees the previous user's plan. */
  userId: string | null;
  plan: Plan;
  /** True once the server answered for `userId`. */
  loaded: boolean;
  load: (userId: string) => Promise<void>;
  reset: () => void;
};

let request = 0;

const useSubscriptionStore = create<SubscriptionStore>((set, get) => ({
  userId: null,
  plan: DEFAULT_PLANS.free,
  loaded: false,

  load: async (userId) => {
    const id = ++request;
    if (get().userId !== userId) set({ userId, plan: DEFAULT_PLANS.free, loaded: false });
    try {
      const plan = await subscriptionService.getMyPlan();
      if (id === request) set({ plan, loaded: true });
    } catch (error) {
      // Offline or the backend is not reachable: stay on FREE (the server
      // enforces the limits anyway) and try again next time.
      if (__DEV__) console.warn('[plan]', error);
    }
  },

  reset: () => {
    request += 1;
    set({ userId: null, plan: DEFAULT_PLANS.free, loaded: false });
  },
}));

/** Keeps the plan in sync with the signed-in user. Mounted once in the root layout. */
export function SubscriptionSync() {
  const userId = useAppStore((state) => state.currentUser?.id ?? null);
  useEffect(() => {
    const store = useSubscriptionStore.getState();
    if (userId) void store.load(userId);
    else store.reset();
  }, [userId]);
  return null;
}

/** Reloads the plan from the server (e.g. after upgrading or when a screen opens). */
export function refreshPlan() {
  const { userId, load } = useSubscriptionStore.getState();
  return userId ? load(userId) : Promise.resolve();
}

/**
 * The current plan for UI decisions, as decided by the server (plan + beta).
 * Ask for capabilities and limits here instead of checking the tier.
 */
export function usePlan() {
  const plan = useSubscriptionStore((state) => state.plan);
  const loaded = useSubscriptionStore((state) => state.loaded);
  return {
    plan,
    loaded,
    /** Real ConVía+ subscription (badge, plan screen). Not for permissions: use can(). */
    isPlus: plan.tier === 'plus',
    betaMode: plan.betaMode,
    /** The user can use this capability now. */
    can: (capability: Capability) => plan.capabilities.includes(capability),
    /** ConVía+ capability the user has only because of the beta (show a subtle "ConVía+" label). */
    isBetaPerk: (capability: Capability) => isBetaPerk(plan, capability),
    /** Limit in force now (relaxed during the beta); null = unlimited. */
    limit: (key: PlanLimit) => plan.limits[key],
    /** The plan's own limit, i.e. what applies after the beta. */
    planLimit: (key: PlanLimit) => plan.planLimits[key],
    atLimit: (key: PlanLimit, used: number) => isAtLimit(plan, key, used),
  };
}

/** Same as usePlan().plan, for code outside components. */
export function getPlan() {
  return useSubscriptionStore.getState().plan;
}
