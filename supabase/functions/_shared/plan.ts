/**
 * Plan checks for the Edge Functions. The database decides
 * (public.service_check_plan, service_role only) and raises the same errors
 * the app already translates: 'CAPACIDAD_PLAN:<key>' and
 * 'LIMITE_PLAN:<key>:<limit>'. The function answers 403 with that code as
 * `error`. No Deno globals, so Node can test it.
 */

export type PlanCheck =
  | { ok: true }
  | { ok: false; status: 403; error: string }
  | { ok: false; status: 500; error: 'PLAN_CHECK_FAILED' };

type RpcClient = {
  rpc(fn: 'service_check_plan', args: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
};

const PLAN_ERROR = /(CAPACIDAD_PLAN:\w+|LIMITE_PLAN:\w+:\d+)/;

/** The plan error code inside a database error message, or null for any other error. */
export function planErrorCode(message: string | undefined): string | null {
  return PLAN_ERROR.exec(message ?? '')?.[1] ?? null;
}

/**
 * Checks `capability` for `userId` and, with `limit`, that `used` (uses so far
 * in the period, not counting this one) is under the user's limit.
 */
export async function checkPlan(
  admin: RpcClient,
  userId: string,
  capability: string,
  limit?: { key: string; used: number },
): Promise<PlanCheck> {
  const { error } = await admin.rpc('service_check_plan', {
    p_user: userId,
    p_capability: capability,
    p_limit: limit?.key ?? null,
    p_used: limit?.used ?? 0,
  });
  if (!error) return { ok: true };
  const code = planErrorCode(error.message);
  return code ? { ok: false, status: 403, error: code } : { ok: false, status: 500, error: 'PLAN_CHECK_FAILED' };
}
