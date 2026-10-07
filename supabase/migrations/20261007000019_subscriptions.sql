-- =====================================================================
-- ConVía — planes FREE / PLUS (ConVía+)
--  * plans: lo que incluye cada plan. Es la única fuente de verdad de
--    los límites que el servidor hace cumplir (limits) y de las funciones
--    premium (features). Para cambiar un límite basta con editar esta fila.
--      limits:   {"vehicles": 1, "saved_places": 10, ...}; una clave
--                ausente o null significa "sin límite".
--      features: {"google_maps", "map_traffic", ...}
--  * subscriptions: el plan de cada usuario. Sin fila = FREE. La app NO
--    puede escribirla: solo el service role (futuro webhook de pagos en
--    una Edge Function) o un administrador desde el dashboard.
--  * private.effective_tier(): PLUS solo si está activa y no ha vencido.
--  * Los límites se aplican con triggers, así que no se pueden saltar
--    modificando la app: vehículos activos, lugares guardados y
--    conductores favoritos.
--  * get_my_plan(): lo que la app consulta para mostrar el plan.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Planes
-- ---------------------------------------------------------------------
create table public.plans (
  tier        text primary key check (tier in ('free', 'plus')),
  name        text not null,
  limits      jsonb not null default '{}'::jsonb check (jsonb_typeof(limits) = 'object'),
  features    text[] not null default '{}',
  updated_at  timestamptz not null default now()
);

create trigger plans_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

-- Valores iniciales: FREE conserva todo lo que la app ya permitía (10 lugares,
-- favoritos sin límite) y solo limita los vehículos a uno.
insert into public.plans (tier, name, limits, features) values
  ('free', 'ConVía',  '{"vehicles": 1,  "saved_places": 10}', '{}'),
  ('plus', 'ConVía+', '{"vehicles": 10, "saved_places": 10}', '{google_maps,map_traffic}');

alter table public.plans enable row level security;
revoke all on public.plans from anon, authenticated;
grant select on public.plans to authenticated;
grant all on public.plans to service_role;

create policy "plans_read" on public.plans for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- 2. Suscripciones
-- ---------------------------------------------------------------------
create table public.subscriptions (
  user_id                   uuid primary key references public.profiles(id) on delete cascade,
  tier                      text not null default 'free' references public.plans(tier),
  status                    text not null default 'active'
                            check (status in ('active', 'trialing', 'past_due', 'canceled', 'expired')),
  -- Fin del periodo pagado; null = sin vencimiento (p. ej. activado a mano).
  current_period_end        timestamptz,
  -- Para conectar un proveedor de pagos más adelante ('manual', 'wompi', 'stripe'…).
  provider                  text,
  provider_customer_id      text,
  provider_subscription_id  text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create unique index subscriptions_provider_ref
  on public.subscriptions (provider, provider_subscription_id)
  where provider_subscription_id is not null;

create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;
-- La app solo puede leer su propia fila; nunca insertarla ni modificarla.
revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;
grant all on public.subscriptions to service_role;

create policy "subscriptions_read_own" on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- 3. Plan efectivo y límites (no expuestos por la API)
-- ---------------------------------------------------------------------
create or replace function private.effective_tier(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((
    select s.tier from public.subscriptions s
     where s.user_id = p_user
       and s.status in ('active', 'trialing')
       and (s.current_period_end is null or s.current_period_end > now())
  ), 'free')
$$;

-- Límite numérico del plan efectivo; null = sin límite.
create or replace function private.plan_limit(p_user uuid, p_key text)
returns integer language sql stable security definer set search_path = '' as $$
  select (p.limits ->> p_key)::integer
    from public.plans p
   where p.tier = private.effective_tier(p_user)
$$;

revoke execute on function private.effective_tier(uuid) from public, anon, authenticated;
revoke execute on function private.plan_limit(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Lo que consulta la app
-- ---------------------------------------------------------------------
create or replace function public.get_my_plan()
returns table (
  tier                text,
  name                text,
  status              text,
  current_period_end  timestamptz,
  limits              jsonb,
  features            text[]
)
language sql stable security definer set search_path = '' as $$
  select p.tier, p.name, coalesce(s.status, 'active'), s.current_period_end, p.limits, p.features
    from public.plans p
    left join public.subscriptions s on s.user_id = auth.uid()
   where p.tier = private.effective_tier(auth.uid())
$$;

revoke execute on function public.get_my_plan() from public, anon;
grant execute on function public.get_my_plan() to authenticated;

-- ---------------------------------------------------------------------
-- 5. Límites aplicados en el servidor
--    El error 'LIMITE_PLAN:<clave>:<límite>' lo traduce la app a un
--    mensaje con la opción de conocer ConVía+.
-- ---------------------------------------------------------------------

-- Vehículos activos. Cubre crear uno nuevo y reactivar uno eliminado
-- (la app reactiva la placa con un UPDATE de activo).
create or replace function private.enforce_vehicle_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer;
  v_count integer;
begin
  if not new.activo then return new; end if;
  -- Un vehículo que ya estaba activo y no cambia de dueño ya estaba contado.
  if tg_op = 'UPDATE' and old.activo and old.driver_id = new.driver_id then return new; end if;

  -- Serializa altas simultáneas del mismo conductor.
  perform 1 from public.profiles where id = new.driver_id for update;

  v_limit := private.plan_limit(new.driver_id, 'vehicles');
  if v_limit is null then return new; end if;

  select count(*) into v_count from public.vehicles
   where driver_id = new.driver_id and activo and id <> new.id;
  if v_count >= v_limit then
    raise exception 'LIMITE_PLAN:vehicles:%', v_limit using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger vehicles_plan_limit
  before insert or update of activo, driver_id on public.vehicles
  for each row execute function private.enforce_vehicle_limit();

-- Lugares guardados: reemplaza el máximo fijo de 10 por el del plan.
create or replace function public.saved_places_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer;
begin
  perform 1 from public.profiles where id = new.user_id for update;
  v_limit := private.plan_limit(new.user_id, 'saved_places');
  if v_limit is not null
     and (select count(*) from public.saved_places where user_id = new.user_id) >= v_limit then
    raise exception 'LIMITE_PLAN:saved_places:%', v_limit using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Conductores favoritos (sin límite en ningún plan por ahora; basta con
-- agregar "favorite_drivers" a plans.limits para activarlo).
create or replace function private.enforce_favorite_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer;
begin
  v_limit := private.plan_limit(new.user_id, 'favorite_drivers');
  if v_limit is null then return new; end if;
  perform 1 from public.profiles where id = new.user_id for update;
  if (select count(*) from public.favorite_drivers where user_id = new.user_id) >= v_limit then
    raise exception 'LIMITE_PLAN:favorite_drivers:%', v_limit using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger favorite_drivers_plan_limit
  before insert on public.favorite_drivers
  for each row execute function private.enforce_favorite_limit();

revoke execute on function private.enforce_vehicle_limit() from public, anon, authenticated;
revoke execute on function private.enforce_favorite_limit() from public, anon, authenticated;
revoke execute on function public.saved_places_limit() from public, anon, authenticated;
