-- =====================================================================
-- ConVía — capacidades de plan para las funciones de IA
--
--  * pickup_verification (FREE): verificar con video el carro que llega.
--    Tiene un límite mensual, pickup_verifications_month (FREE 10, ConVía+
--    sin límite), que SIEMPRE usa el plan real: el modo beta no lo relaja,
--    porque cada verificación cuesta llamadas al modelo.
--  * trip_assistant y vehicle_autofill (ConVía+): el asistente de viajes y
--    el autocompletado del vehículo con IA. beta_unlocked = false: la beta
--    no las abre a FREE.
--  * public.service_check_plan(): la revisión que hacen las Edge Functions
--    (solo service_role). Lanza los mismos errores que ya traduce la app:
--    'CAPACIDAD_PLAN:<clave>' y 'LIMITE_PLAN:<clave>:<límite>'.
--  MANTENER IGUAL a CAPABILITIES y PLAN_LIMITS en src/subscription/plans.ts.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Catálogo
-- ---------------------------------------------------------------------
insert into public.plan_capabilities (key, tier, beta_unlocked, description) values
  ('pickup_verification', 'free', false, 'Verificar con video el carro que te recoge (con límite mensual)'),
  ('trip_assistant',      'plus', false, 'Asistente que busca y propone viajes'),
  ('vehicle_autofill',    'plus', false, 'Autocompletar los datos del vehículo con una foto');

-- plans.features en desuso: espejo de plan_capabilities para apps anteriores.
update public.plans p set features = coalesce((
  select array_agg(c.key order by c.key) from public.plan_capabilities c where c.tier = 'plus'), '{}')
 where p.tier = 'plus';

-- ---------------------------------------------------------------------
-- 2. Límites. Clave ausente = sin límite (ConVía+ no tiene tope mensual).
-- ---------------------------------------------------------------------
update public.plans set limits = '{"vehicles": 1, "saved_places": 3, "favorite_drivers": 10, "visible_results": 5, "saved_routes": 1, "pickup_verifications_month": 10}'
 where tier = 'free';
update public.plans set limits = '{"vehicles": 10, "saved_places": 20, "saved_routes": 10}'
 where tier = 'plus';

-- Límites que dependen siempre del plan real, aunque la beta esté activa.
create or replace function private.real_plan_limit_keys()
returns text[] language sql immutable set search_path = '' as $$
  select array['pickup_verifications_month']
$$;

-- Límites que rigen hoy para el usuario: los de ConVía+ en beta, salvo los
-- del plan real, que se toman de su plan (y desaparecen si su plan no los tiene).
create or replace function private.effective_limits(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with real_plan as (
    select p.limits from public.plans p where p.tier = private.effective_tier(p_user)
  ), applied as (
    select x.limits from public.plans x
     where x.tier = case when private.beta_mode() then 'plus' else private.effective_tier(p_user) end
  )
  select (coalesce((select limits from applied), '{}'::jsonb) - private.real_plan_limit_keys())
         || coalesce((select jsonb_object_agg(k, (select limits from real_plan) -> k)
                        from unnest(private.real_plan_limit_keys()) k
                       where (select limits from real_plan) ? k), '{}'::jsonb)
$$;

create or replace function private.plan_limit(p_user uuid, p_key text)
returns integer language sql stable security definer set search_path = '' as $$
  select (private.effective_limits(p_user) ->> p_key)::integer
$$;

revoke execute on function private.real_plan_limit_keys() from public, anon, authenticated;
revoke execute on function private.effective_limits(uuid) from public, anon, authenticated;
revoke execute on function private.plan_limit(uuid, text) from public, anon, authenticated;
grant execute on function private.real_plan_limit_keys(), private.effective_limits(uuid), private.plan_limit(uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- 3. get_my_plan(): los límites efectivos salen de effective_limits().
--    Mismas columnas que en la 024 (las leen las apps instaladas).
-- ---------------------------------------------------------------------
create or replace function public.get_my_plan()
returns table (
  tier                text,
  name                text,
  status              text,
  current_period_end  timestamptz,
  limits              jsonb,
  features            text[],
  plan_limits         jsonb,
  capabilities        text[],
  beta_mode           boolean
)
language sql stable security definer set search_path = '' as $$
  select p.tier, p.name, coalesce(s.status, 'active'), s.current_period_end,
         -- Límites que se aplican hoy (relajados en beta, salvo los del plan real).
         private.effective_limits(auth.uid()),
         -- Capacidades del plan real (sin beta): lo que leían las apps anteriores.
         coalesce((select array_agg(c.key order by c.key) from public.plan_capabilities c
                    where c.tier = 'plus' and p.tier = 'plus'), '{}'),
         -- Límites del plan real (los que regirán al terminar la beta).
         p.limits,
         -- Capacidades efectivas ahora (plan + beta).
         coalesce((select array_agg(c.key order by c.key) from public.plan_capabilities c
                    where private.has_capability(auth.uid(), c.key)), '{}'),
         private.beta_mode()
    from public.plans p
    left join public.subscriptions s on s.user_id = auth.uid()
   where p.tier = private.effective_tier(auth.uid())
$$;
revoke execute on function public.get_my_plan() from public, anon;
grant execute on function public.get_my_plan() to authenticated;

-- ---------------------------------------------------------------------
-- 4. Revisión desde las Edge Functions (solo service_role)
--    p_used: cuántas veces ya usó el recurso en el periodo, sin contar la
--    que pide ahora. Sin p_limit solo revisa la capacidad.
-- ---------------------------------------------------------------------
create or replace function public.service_check_plan(
  p_user uuid, p_capability text, p_limit text default null, p_used integer default 0)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_limit integer;
begin
  if p_user is null or not exists (select 1 from public.plan_capabilities where key = p_capability) then
    raise exception 'service_check_plan: capacidad desconocida %', p_capability using errcode = '22023';
  end if;
  if not private.has_capability(p_user, p_capability) then
    raise exception 'CAPACIDAD_PLAN:%', p_capability using errcode = 'P0001';
  end if;
  if p_limit is not null then
    v_limit := private.plan_limit(p_user, p_limit);
    if v_limit is not null and coalesce(p_used, 0) >= v_limit then
      raise exception 'LIMITE_PLAN:%:%', p_limit, v_limit using errcode = 'P0001';
    end if;
  end if;
end;
$$;
revoke execute on function public.service_check_plan(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.service_check_plan(uuid, text, text, integer) to service_role;
