-- =====================================================================
-- ConVía — capacidades por plan y modo beta
--
--  * plan_capabilities: catálogo único de capacidades. Cada una dice a qué
--    plan pertenece (free = todos; plus = ConVía+) y si el modo beta la
--    habilita también para FREE. MANTENER IGUAL a CAPABILITIES en
--    src/subscription/plans.ts (un test compara ambos).
--  * app_config.beta_mode: interruptor global. Con beta activo:
--      - FREE tiene todas las capacidades plus marcadas beta_unlocked;
--      - los límites (vehículos, lugares, favoritos, resultados) son los de
--        ConVía+ para todos (relajados, no infinitos).
--    Para terminar la beta: update public.app_config set beta_mode = false;
--  * Lo que NO habilita la beta (ventajas sobre otros usuarios o lo que se
--    está probando): prioridad en emparejamiento, distintivo, perfil
--    destacado, Google Maps y tráfico. Dependen siempre del plan real.
--  * get_my_plan() devuelve además capacidades efectivas, límites del plan
--    y el modo beta, conservando las columnas que leen las apps instaladas.
--  * plans.features queda en desuso (se mantiene sincronizada para apps
--    anteriores); la fuente es plan_capabilities.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Configuración global
-- ---------------------------------------------------------------------
create table public.app_config (
  id          boolean primary key default true check (id),
  beta_mode   boolean not null default true,
  updated_at  timestamptz not null default now()
);
insert into public.app_config (id, beta_mode) values (true, true);

create trigger app_config_updated_at
  before update on public.app_config
  for each row execute function public.set_updated_at();

alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;
grant select on public.app_config to authenticated;
grant all on public.app_config to service_role;
create policy "app_config_read" on public.app_config for select to authenticated using (true);

create or replace function private.beta_mode()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select beta_mode from public.app_config where id), false)
$$;
revoke execute on function private.beta_mode() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Catálogo de capacidades
-- ---------------------------------------------------------------------
create table public.plan_capabilities (
  key            text primary key check (key ~ '^[a-z_]+$'),
  tier           text not null check (tier in ('free', 'plus')),
  beta_unlocked  boolean not null default false,
  description    text not null
);

insert into public.plan_capabilities (key, tier, beta_unlocked, description) values
  -- Esencial (FREE)
  ('trip_search',           'free', false, 'Buscar viajes'),
  ('request_trip',          'free', false, 'Pedir cupo'),
  ('publish_trip',          'free', false, 'Publicar viajes'),
  ('chat',                  'free', false, 'Chat del viaje'),
  ('qr_boarding',           'free', false, 'Abordaje con QR'),
  ('identity_verification', 'free', false, 'Verificación de identidad y licencia'),
  ('ratings',               'free', false, 'Calificaciones'),
  ('trip_history',          'free', false, 'Historial de viajes'),
  ('basic_map',             'free', false, 'Mapa (MapLibre)'),
  ('basic_matching',        'free', false, 'Emparejamiento por compatibilidad'),
  ('time_filters',          'free', false, 'Filtros de horario'),
  ('saved_places',          'free', false, 'Lugares guardados (con límite)'),
  ('favorites',             'free', false, 'Conductores favoritos (con límite)'),
  -- ConVía+ que la beta abre a todos
  ('multiple_vehicles',     'plus', true,  'Varios vehículos'),
  ('repeat_trip',           'plus', true,  'Repetir un viaje anterior'),
  ('unlimited_results',     'plus', true,  'Ver todos los viajes compatibles'),
  ('advanced_saved_places', 'plus', true,  'Más lugares guardados y favoritos'),
  ('advanced_filters',      'plus', true,  'Filtros avanzados (aún no implementado)'),
  ('recurring_trips',       'plus', true,  'Viajes recurrentes (aún no implementado)'),
  ('smart_match_alerts',    'plus', true,  'Alertas de viajes compatibles (aún no implementado)'),
  ('advanced_preferences',  'plus', true,  'Preferencias avanzadas (aún no implementado)'),
  ('advanced_trip_stats',   'plus', true,  'Estadísticas de viajes (aún no implementado)'),
  ('advanced_driver_stats', 'plus', true,  'Estadísticas de conductor (aún no implementado)'),
  -- ConVía+ que dependen siempre del plan real
  ('google_maps',           'plus', false, 'Mapas de Google'),
  ('map_traffic',           'plus', false, 'Tráfico en el mapa'),
  ('smart_match_priority',  'plus', false, 'Prioridad entre solicitudes igual de compatibles'),
  ('plus_badge',            'plus', false, 'Distintivo ConVía+'),
  ('highlighted_profile',   'plus', false, 'Perfil destacado (aún no implementado)');

alter table public.plan_capabilities enable row level security;
revoke all on public.plan_capabilities from anon, authenticated;
grant select on public.plan_capabilities to authenticated;
grant all on public.plan_capabilities to service_role;
create policy "plan_capabilities_read" on public.plan_capabilities for select to authenticated using (true);

-- ¿El usuario tiene esta capacidad ahora? (plan real + modo beta)
create or replace function private.has_capability(p_user uuid, p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.plan_capabilities c
     where c.key = p_key
       and (c.tier = 'free'
            or private.is_plus(p_user)
            or (c.beta_unlocked and private.beta_mode()))
  )
$$;
revoke execute on function private.has_capability(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Límites: en beta se aplican los de ConVía+ a todos
-- ---------------------------------------------------------------------
-- Límites objetivo (lo que regirá al terminar la beta). Clave ausente = sin límite.
update public.plans set limits = '{"vehicles": 1, "saved_places": 3, "favorite_drivers": 10, "visible_results": 5}'
 where tier = 'free';
update public.plans set limits = '{"vehicles": 10, "saved_places": 20}'
 where tier = 'plus';
-- plans.features en desuso: espejo de plan_capabilities para apps anteriores.
update public.plans p set features = coalesce((
  select array_agg(c.key order by c.key) from public.plan_capabilities c where c.tier = 'plus'), '{}')
 where p.tier = 'plus';

create or replace function private.plan_limit(p_user uuid, p_key text)
returns integer language sql stable security definer set search_path = '' as $$
  select (p.limits ->> p_key)::integer
    from public.plans p
   where p.tier = case when private.beta_mode() then 'plus' else private.effective_tier(p_user) end
$$;
revoke execute on function private.plan_limit(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. get_my_plan(): lo que la app necesita, desde el servidor
--    tier/name/status/current_period_end/limits/features se conservan para
--    las apps ya instaladas (limits = límites efectivos, como antes).
-- ---------------------------------------------------------------------
drop function if exists public.get_my_plan();
create function public.get_my_plan()
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
         -- Límites que se aplican hoy (relajados en beta).
         (select x.limits from public.plans x
           where x.tier = case when private.beta_mode() then 'plus' else p.tier end),
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
