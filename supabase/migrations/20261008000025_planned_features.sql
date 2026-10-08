-- =====================================================================
-- ConVía — funciones planeadas de ConVía+ (abiertas a todos en la beta)
--
--  A. Viajes recurrentes: el conductor define un horario semanal y el
--     servidor publica cada viaje (hasta 7 días antes), sin duplicados y
--     respetando cancelaciones y ediciones de cada viaje.
--  B. Rutas guardadas y alertas de viajes compatibles: cuando se publica un
--     viaje, el servidor lo compara con las rutas que tienen alerta usando
--     la MISMA compatibilidad del resto de la app (private.request_match).
--     Una sola alerta por usuario y viaje, y pocas notificaciones al día.
--  C. Preferencias del usuario (orden, distancias, horario y avisos).
--  D. Estadísticas de viajes, solo con datos reales del propio usuario.
--  E. Envío de notificaciones pendientes desde el servidor (pg_cron + pg_net
--     → función notify), para los viajes que publica el horario semanal.
--     La URL y el secreto viven en Vault (no en este archivo).
--
--  Seguridad: tablas con RLS y lectura solo del dueño; las escrituras con
--  reglas pasan por funciones del servidor que validan dueño, organización,
--  vehículo y capacidad del plan (private.has_capability).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Límite nuevo: rutas guardadas (FREE 1, ConVía+ 10; en beta, 10)
-- ---------------------------------------------------------------------
update public.plans set limits = '{"vehicles": 1, "saved_places": 3, "favorite_drivers": 10, "visible_results": 5, "saved_routes": 1}'
 where tier = 'free';
update public.plans set limits = '{"vehicles": 10, "saved_places": 20, "saved_routes": 10}'
 where tier = 'plus';

-- Hora y día en Colombia (los horarios se escriben en hora local).
create or replace function private.local_now()
returns timestamp language sql stable set search_path = '' as $$
  select now() at time zone 'America/Bogota'
$$;
revoke execute on function private.local_now() from public, anon, authenticated;

-- =====================================================================
-- A. VIAJES RECURRENTES
-- =====================================================================
create table public.recurring_trips (
  id              uuid primary key default gen_random_uuid(),
  driver_id       uuid not null references public.profiles(id) on delete cascade,
  institution_id  uuid references public.institutions(id),
  vehicle_id      uuid not null references public.vehicles(id),
  origen_nombre   text not null check (char_length(origen_nombre) between 1 and 300),
  origen_lat      double precision not null,
  origen_lng      double precision not null,
  destino_nombre  text not null check (char_length(destino_nombre) between 1 and 300),
  destino_lat     double precision not null,
  destino_lng     double precision not null,
  ruta            jsonb check (private.is_valid_route(ruta)),
  hora            time not null,
  -- Días ISO: 1 = lunes … 7 = domingo.
  dias            smallint[] not null check (cardinality(dias) between 1 and 7 and dias <@ array[1,2,3,4,5,6,7]::smallint[]),
  fecha_inicio    date not null,
  fecha_fin       date check (fecha_fin is null or fecha_fin >= fecha_inicio),
  precio          numeric(10,2) not null check (precio >= 0),
  cupos_totales   smallint not null check (cupos_totales between 1 and 6),
  descripcion     text check (descripcion is null or char_length(descripcion) <= 500),
  activo          boolean not null default true,
  -- Hasta cuándo el conductor ya sabe qué viajes se publicaron (avisos).
  avisado_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index recurring_trips_driver_idx on public.recurring_trips (driver_id);
create index recurring_trips_active_idx on public.recurring_trips (activo) where activo;

create trigger recurring_trips_updated_at
  before update on public.recurring_trips
  for each row execute function public.set_updated_at();

alter table public.recurring_trips enable row level security;
revoke all on public.recurring_trips from anon, authenticated;
grant select on public.recurring_trips to authenticated;
grant all on public.recurring_trips to service_role;
-- Solo el conductor ve sus horarios; se crean y cambian con las funciones de abajo.
create policy "recurring_trips_own_select" on public.recurring_trips
  for select to authenticated using (driver_id = (select auth.uid()));

-- Cada viaje generado recuerda su horario y la fecha original que ocupa.
-- recurring_slot no cambia aunque el conductor edite ese viaje, así que
-- editar o cancelar un viaje nunca hace que se vuelva a generar.
alter table public.trips
  add column recurring_trip_id uuid references public.recurring_trips(id) on delete set null,
  add column recurring_slot timestamptz;
create unique index trips_recurring_slot_uniq on public.trips (recurring_trip_id, recurring_slot)
  where recurring_trip_id is not null;

-- Publicar viajes: además de lo anterior, un viaje solo puede ocupar una
-- fecha de un horario del mismo conductor.
create or replace function public.trips_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_puestos smallint;
begin
  if not private.is_approved_driver(new.driver_id) then
    raise exception 'Tu permiso de conductor aún no está aprobado';
  end if;
  select puestos into v_puestos from public.vehicles
  where id = new.vehicle_id and driver_id = new.driver_id and activo;
  if v_puestos is null then
    raise exception 'El vehículo no pertenece al conductor o no está activo';
  end if;
  if new.recurring_trip_id is not null and not exists (
       select 1 from public.recurring_trips s where s.id = new.recurring_trip_id and s.driver_id = new.driver_id) then
    raise exception 'El horario no pertenece al conductor';
  end if;
  if new.recurring_trip_id is null then new.recurring_slot := null; end if;
  if private.has_schedule_conflict(new.driver_id, new.salida_at) then
    raise exception 'Ya tienes otro viaje a menos de 90 minutos de esa hora';
  end if;
  if new.cupos_totales is null or new.cupos_totales > v_puestos then
    new.cupos_totales := v_puestos;
  end if;
  new.institution_id := (select institution_id from public.profiles where id = new.driver_id);
  new.estado := 'por_empezar';
  return new;
end $$;

-- Publica los viajes de los próximos `p_days` días de los horarios activos
-- (todos, o solo `p_schedule`). Devuelve cuántos creó. Cada fecha se crea una
-- sola vez; las que chocan con otro viaje, o cuyo vehículo ya no está activo,
-- se omiten sin detener las demás.
create or replace function private.generate_recurring_trips(p_schedule uuid default null, p_days integer default 7)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  s public.recurring_trips;
  v_today date := private.local_now()::date;
  v_day date;
  v_at timestamptz;
  v_count integer := 0;
begin
  for s in
    select * from public.recurring_trips
     where activo and (p_schedule is null or id = p_schedule)
       and (fecha_fin is null or fecha_fin >= v_today)
  loop
    -- Al terminar la beta, un horario FREE queda en pausa (no se borra).
    continue when not private.has_capability(s.driver_id, 'recurring_trips');
    for v_day in
      select d::date from generate_series(greatest(v_today, s.fecha_inicio),
                                          least(v_today + p_days, coalesce(s.fecha_fin, v_today + p_days)),
                                          interval '1 day') d
    loop
      continue when not (extract(isodow from v_day)::smallint = any(s.dias));
      v_at := (v_day + s.hora) at time zone 'America/Bogota';
      continue when v_at <= now() + interval '30 minutes';
      continue when exists (select 1 from public.trips t where t.recurring_trip_id = s.id and t.recurring_slot = v_at);
      begin
        insert into public.trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng,
                                  destino_nombre, destino_lat, destino_lng, salida_at, precio,
                                  cupos_totales, descripcion, ruta, recurring_trip_id, recurring_slot)
        values (s.driver_id, s.vehicle_id, s.origen_nombre, s.origen_lat, s.origen_lng,
                s.destino_nombre, s.destino_lat, s.destino_lng, v_at, s.precio,
                s.cupos_totales, s.descripcion, s.ruta, s.id, v_at);
        v_count := v_count + 1;
      exception when others then
        -- Choque de horario, vehículo inactivo o permiso suspendido: se omite esta fecha.
        null;
      end;
    end loop;
  end loop;
  return v_count;
end $$;
revoke execute on function private.generate_recurring_trips(uuid, integer) from public, anon, authenticated;

-- Quita los viajes futuros de un horario que nadie ha pedido (para
-- regenerarlos con los cambios o al pausar). Los que ya tienen solicitudes se
-- conservan tal cual: el conductor los maneja uno por uno.
create or replace function private.clear_unrequested_recurring(p_schedule uuid, out removed integer, out kept integer)
language plpgsql security definer set search_path = '' as $$
begin
  with gone as (
    delete from public.trips t
     where t.recurring_trip_id = p_schedule and t.estado = 'por_empezar' and t.salida_at > now()
       and not exists (select 1 from public.trip_requests r where r.trip_id = t.id)
    returning 1)
  select count(*) into removed from gone;
  select count(*) into kept from public.trips t
   where t.recurring_trip_id = p_schedule and t.estado = 'por_empezar' and t.salida_at > now();
end $$;
revoke execute on function private.clear_unrequested_recurring(uuid) from public, anon, authenticated;

-- Crea (p_id null) o cambia un horario semanal y publica sus próximos viajes.
create or replace function public.save_recurring_trip(
  p_id uuid,
  p_vehicle_id uuid,
  p_origen_nombre text, p_origen_lat double precision, p_origen_lng double precision,
  p_destino_nombre text, p_destino_lat double precision, p_destino_lng double precision,
  p_ruta jsonb,
  p_hora time,
  p_dias smallint[],
  p_fecha_inicio date,
  p_fecha_fin date,
  p_precio numeric,
  p_cupos_totales smallint,
  p_descripcion text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_puestos smallint;
  v_clear record;
  v_created integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if not private.has_capability(v_user, 'recurring_trips') then
    raise exception 'CAPACIDAD_PLAN:recurring_trips' using errcode = 'P0001';
  end if;
  if not private.is_approved_driver(v_user) then
    raise exception 'Tu permiso de conductor aún no está aprobado';
  end if;
  select puestos into v_puestos from public.vehicles where id = p_vehicle_id and driver_id = v_user and activo;
  if v_puestos is null then raise exception 'El vehículo no pertenece al conductor o no está activo'; end if;
  if p_cupos_totales is null or p_cupos_totales < 1 or p_cupos_totales > v_puestos then
    raise exception 'Tu vehículo tiene % puestos para pasajeros', v_puestos;
  end if;
  if p_dias is null or cardinality(p_dias) = 0 then raise exception 'Elige al menos un día de la semana'; end if;
  if p_fecha_inicio is null or p_fecha_inicio < private.local_now()::date - 1 then
    raise exception 'La fecha de inicio no puede estar en el pasado';
  end if;
  if p_fecha_fin is not null and p_fecha_fin < p_fecha_inicio then
    raise exception 'La fecha final debe ser después de la de inicio';
  end if;
  if private.km(p_origen_lat, p_origen_lng, p_destino_lat, p_destino_lng) < 0.3 then
    raise exception 'El destino debe ser distinto al punto de salida';
  end if;
  if not private.is_valid_route(p_ruta) then raise exception 'Ruta inválida'; end if;

  if p_id is null then
    -- Límite de seguridad: un conductor no necesita más de 10 horarios activos.
    perform 1 from public.profiles where id = v_user for update;
    if (select count(*) from public.recurring_trips where driver_id = v_user and activo) >= 10 then
      raise exception 'Puedes tener hasta 10 viajes recurrentes activos';
    end if;
    insert into public.recurring_trips (driver_id, institution_id, vehicle_id, origen_nombre, origen_lat, origen_lng,
                                        destino_nombre, destino_lat, destino_lng, ruta, hora, dias, fecha_inicio,
                                        fecha_fin, precio, cupos_totales, descripcion)
    values (v_user, (select institution_id from public.profiles where id = v_user), p_vehicle_id,
            left(trim(p_origen_nombre), 300), p_origen_lat, p_origen_lng, left(trim(p_destino_nombre), 300), p_destino_lat, p_destino_lng,
            p_ruta, p_hora, (select array_agg(distinct d order by d) from unnest(p_dias) d), p_fecha_inicio, p_fecha_fin,
            p_precio, p_cupos_totales, nullif(left(trim(coalesce(p_descripcion, '')), 500), ''))
    returning id into v_id;
    select 0 as removed, 0 as kept into v_clear;
  else
    update public.recurring_trips
       set vehicle_id = p_vehicle_id,
           origen_nombre = left(trim(p_origen_nombre), 300), origen_lat = p_origen_lat, origen_lng = p_origen_lng,
           destino_nombre = left(trim(p_destino_nombre), 300), destino_lat = p_destino_lat, destino_lng = p_destino_lng,
           ruta = p_ruta, hora = p_hora, dias = (select array_agg(distinct d order by d) from unnest(p_dias) d),
           fecha_inicio = p_fecha_inicio, fecha_fin = p_fecha_fin, precio = p_precio, cupos_totales = p_cupos_totales,
           descripcion = nullif(left(trim(coalesce(p_descripcion, '')), 500), ''), activo = true
     where id = p_id and driver_id = v_user
    returning id into v_id;
    if v_id is null then raise exception 'No se encontró el viaje recurrente'; end if;
    select * into v_clear from private.clear_unrequested_recurring(v_id);
  end if;

  v_created := private.generate_recurring_trips(v_id);
  -- El conductor ya ve estos viajes en la app: no hace falta avisarle.
  update public.recurring_trips set avisado_at = now() where id = v_id;
  return jsonb_build_object('id', v_id, 'created', v_created, 'kept', coalesce(v_clear.kept, 0));
end $$;

-- Pausar o reanudar un horario. Al pausar se quitan los viajes futuros sin solicitudes.
create or replace function public.set_recurring_trip_active(p_id uuid, p_active boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_clear record;
  v_created integer := 0;
begin
  if p_active and not private.has_capability(v_user, 'recurring_trips') then
    raise exception 'CAPACIDAD_PLAN:recurring_trips' using errcode = 'P0001';
  end if;
  update public.recurring_trips set activo = p_active where id = p_id and driver_id = v_user;
  if not found then raise exception 'No se encontró el viaje recurrente'; end if;
  if p_active then
    v_created := private.generate_recurring_trips(p_id);
    update public.recurring_trips set avisado_at = now() where id = p_id;
    return jsonb_build_object('created', v_created, 'removed', 0, 'kept', 0);
  end if;
  select * into v_clear from private.clear_unrequested_recurring(p_id);
  return jsonb_build_object('created', 0, 'removed', v_clear.removed, 'kept', v_clear.kept);
end $$;

-- Eliminar un horario: igual que pausar, y los viajes que quedan siguen siendo viajes normales.
create or replace function public.delete_recurring_trip(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_clear record;
begin
  if not exists (select 1 from public.recurring_trips where id = p_id and driver_id = auth.uid()) then
    raise exception 'No se encontró el viaje recurrente';
  end if;
  select * into v_clear from private.clear_unrequested_recurring(p_id);
  delete from public.recurring_trips where id = p_id;
  return jsonb_build_object('removed', v_clear.removed, 'kept', v_clear.kept);
end $$;

revoke execute on function public.save_recurring_trip(uuid, uuid, text, double precision, double precision, text, double precision,
  double precision, jsonb, time, smallint[], date, date, numeric, smallint, text) from public, anon;
grant execute on function public.save_recurring_trip(uuid, uuid, text, double precision, double precision, text, double precision,
  double precision, jsonb, time, smallint[], date, date, numeric, smallint, text) to authenticated;
revoke execute on function public.set_recurring_trip_active(uuid, boolean), public.delete_recurring_trip(uuid) from public, anon;
grant execute on function public.set_recurring_trip_active(uuid, boolean), public.delete_recurring_trip(uuid) to authenticated;

-- Quitar un vehículo usado por un horario activo dejaría el horario sin publicar.
create or replace function private.vehicle_not_in_active_schedule()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.activo and not new.activo
     and exists (select 1 from public.recurring_trips s where s.vehicle_id = new.id and s.activo) then
    raise exception 'Este vehículo se usa en un viaje recurrente activo. Pausa ese viaje o cámbiale el vehículo antes de quitarlo.';
  end if;
  return new;
end $$;
revoke execute on function private.vehicle_not_in_active_schedule() from public, anon, authenticated;
create trigger vehicles_not_in_active_schedule
  before update of activo on public.vehicles
  for each row execute function private.vehicle_not_in_active_schedule();

-- Cada hora: publicar lo que entra en la ventana de 7 días.
select cron.unschedule(jobid) from cron.job where jobname = 'generate-recurring-trips';
select cron.schedule('generate-recurring-trips', '7 * * * *', $$select private.generate_recurring_trips()$$);

-- =====================================================================
-- B. RUTAS GUARDADAS Y ALERTAS
-- =====================================================================
create table public.saved_routes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  institution_id  uuid references public.institutions(id),
  nombre          text not null check (char_length(nombre) between 1 and 40),
  origen_nombre   text not null check (char_length(origen_nombre) between 1 and 300),
  origen_lat      double precision not null,
  origen_lng      double precision not null,
  destino_nombre  text not null check (char_length(destino_nombre) between 1 and 300),
  destino_lat     double precision not null,
  destino_lng     double precision not null,
  -- Días ISO en los que sirve (vacío = cualquier día) y franja de salida local.
  dias            smallint[] not null default '{}' check (dias <@ array[1,2,3,4,5,6,7]::smallint[]),
  hora_desde      time,
  hora_hasta      time,
  alerta          boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((hora_desde is null) = (hora_hasta is null) and (hora_desde is null or hora_desde < hora_hasta))
);
create index saved_routes_user_idx on public.saved_routes (user_id);
create index saved_routes_alert_idx on public.saved_routes (institution_id) where alerta;

create trigger saved_routes_updated_at
  before update on public.saved_routes
  for each row execute function public.set_updated_at();

-- Organización del dueño, límite del plan y alertas solo con la capacidad.
create or replace function private.saved_routes_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer;
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then raise exception 'No se puede cambiar el dueño'; end if;
  new.institution_id := (select institution_id from public.profiles where id = new.user_id);
  if tg_op = 'INSERT' then
    perform 1 from public.profiles where id = new.user_id for update;
    v_limit := private.plan_limit(new.user_id, 'saved_routes');
    if v_limit is not null and (select count(*) from public.saved_routes where user_id = new.user_id) >= v_limit then
      raise exception 'LIMITE_PLAN:saved_routes:%', v_limit using errcode = 'P0001';
    end if;
  end if;
  if new.alerta and (tg_op = 'INSERT' or not old.alerta)
     and not private.has_capability(new.user_id, 'smart_match_alerts') then
    raise exception 'CAPACIDAD_PLAN:smart_match_alerts' using errcode = 'P0001';
  end if;
  if private.km(new.origen_lat, new.origen_lng, new.destino_lat, new.destino_lng) < 0.3 then
    raise exception 'El destino debe ser distinto al punto de salida';
  end if;
  return new;
end $$;
revoke execute on function private.saved_routes_guard() from public, anon, authenticated;
create trigger saved_routes_guard
  before insert or update on public.saved_routes
  for each row execute function private.saved_routes_guard();

alter table public.saved_routes enable row level security;
revoke all on public.saved_routes from anon, authenticated;
grant select, delete on public.saved_routes to authenticated;
grant insert (user_id, nombre, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, dias, hora_desde, hora_hasta, alerta)
  on public.saved_routes to authenticated;
grant update (nombre, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, dias, hora_desde, hora_hasta, alerta)
  on public.saved_routes to authenticated;
grant all on public.saved_routes to service_role;

create policy "saved_routes_own_select" on public.saved_routes
  for select to authenticated using (user_id = (select auth.uid()));
create policy "saved_routes_own_insert" on public.saved_routes
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "saved_routes_own_update" on public.saved_routes
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "saved_routes_own_delete" on public.saved_routes
  for delete to authenticated using (user_id = (select auth.uid()));

-- Un viaje encontrado para un usuario. La clave (usuario, viaje) garantiza
-- una sola alerta por viaje aunque varias rutas coincidan.
create table public.trip_alert_hits (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  trip_id     uuid not null references public.trips(id) on delete cascade,
  route_id    uuid references public.saved_routes(id) on delete set null,
  score       integer not null,
  level       text not null,
  created_at  timestamptz not null default now(),
  -- Cuándo se resolvió el aviso; push_sent false = no se envió (sin permiso o límite diario).
  pushed_at   timestamptz,
  push_sent   boolean,
  primary key (user_id, trip_id)
);
create index trip_alert_hits_pending_idx on public.trip_alert_hits (created_at) where pushed_at is null;

alter table public.trip_alert_hits enable row level security;
revoke all on public.trip_alert_hits from anon, authenticated;
grant select, delete on public.trip_alert_hits to authenticated;
grant all on public.trip_alert_hits to service_role;
create policy "trip_alert_hits_own_select" on public.trip_alert_hits
  for select to authenticated using (user_id = (select auth.uid()));
create policy "trip_alert_hits_own_delete" on public.trip_alert_hits
  for delete to authenticated using (user_id = (select auth.uid()));

-- Nivel mínimo para alertar: "Compatible" o mejor (MATCHING_CONFIG.goodScore;
-- en la app, ALERT_MIN_LEVEL en tripMatching.ts). "Algo compatible" se ve en
-- la búsqueda, pero no justifica una notificación.
create or replace function private.alert_min_rank()
returns integer language sql immutable set search_path = '' as $$ select 2 $$;
revoke execute on function private.alert_min_rank() from public, anon, authenticated;

-- Compara un viaje abierto con las rutas con alerta de su organización.
-- Usa private.request_match: la misma fórmula y umbrales de la app.
create or replace function private.match_trip_alerts(p_trip_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  t public.trips;
  sr public.saved_routes;
  v_local timestamp;
  m jsonb;
  v_count integer := 0;
begin
  select * into t from public.trips where id = p_trip_id;
  if t.id is null or t.estado <> 'por_empezar' or t.salida_at <= now() or t.salida_at > now() + interval '7 days'
     or t.origen_lat is null or t.destino_lat is null
     or t.cupos_totales - private.seats_taken(t.id) <= 0 then
    return 0;
  end if;
  v_local := t.salida_at at time zone 'America/Bogota';
  for sr in
    select r.* from public.saved_routes r
      join public.profiles p on p.id = r.user_id
     where r.alerta
       and r.user_id <> t.driver_id
       and r.institution_id = t.institution_id
       and p.institution_id = t.institution_id
       and (cardinality(r.dias) = 0 or extract(isodow from v_local)::smallint = any(r.dias))
       and (r.hora_desde is null or v_local::time between r.hora_desde and r.hora_hasta)
       and not exists (select 1 from public.trip_alert_hits h where h.user_id = r.user_id and h.trip_id = t.id)
       and not exists (select 1 from public.trip_requests q where q.trip_id = t.id and q.passenger_id = r.user_id)
  loop
    continue when not private.has_capability(sr.user_id, 'smart_match_alerts');
    m := private.request_match(t, sr.origen_lat, sr.origen_lng, sr.destino_lat, sr.destino_lng);
    continue when private.level_rank(m ->> 'level') < private.alert_min_rank();
    insert into public.trip_alert_hits (user_id, trip_id, route_id, score, level)
    values (sr.user_id, t.id, sr.id, (m ->> 'score')::integer, m ->> 'level')
    on conflict (user_id, trip_id) do nothing;
    if found then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end $$;
revoke execute on function private.match_trip_alerts(uuid) from public, anon, authenticated;

-- Al publicar o cambiar ruta, lugares u hora de un viaje. Nunca impide publicar.
create or replace function private.trips_alerts_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform private.match_trip_alerts(new.id);
  exception when others then
    raise warning 'match_trip_alerts(%) falló: %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke execute on function private.trips_alerts_trigger() from public, anon, authenticated;
create trigger trips_alerts_after_insert
  after insert on public.trips
  for each row execute function private.trips_alerts_trigger();
create trigger trips_alerts_after_update
  after update of salida_at, ruta, origen_lat, origen_lng, destino_lat, destino_lng on public.trips
  for each row execute function private.trips_alerts_trigger();

-- =====================================================================
-- C. PREFERENCIAS
-- =====================================================================
create table public.user_preferences (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  -- Orden dentro del mismo nivel de compatibilidad (nunca por encima de él).
  orden            text not null default 'match' check (orden in ('match', 'departure', 'price')),
  horario          text not null default 'any' check (horario in ('soon', 'today', 'tomorrow', 'any')),
  max_recogida_km  numeric(4,1) check (max_recogida_km is null or max_recogida_km between 0.1 and 10),
  max_bajada_km    numeric(4,1) check (max_bajada_km is null or max_bajada_km between 0.1 and 10),
  -- Punto de recogida por defecto: un lugar guardado (null = ubicación actual).
  recogida_place_id uuid references public.saved_places(id) on delete set null,
  avisar_alertas   boolean not null default true,
  avisar_recurrentes boolean not null default true,
  updated_at       timestamptz not null default now()
);
create trigger user_preferences_updated_at
  before update on public.user_preferences
  for each row execute function public.set_updated_at();

-- El lugar de recogida debe ser del mismo usuario.
create or replace function private.user_preferences_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.recogida_place_id is not null and not exists (
       select 1 from public.saved_places s where s.id = new.recogida_place_id and s.user_id = new.user_id) then
    raise exception 'Lugar no válido';
  end if;
  return new;
end $$;
revoke execute on function private.user_preferences_guard() from public, anon, authenticated;
create trigger user_preferences_guard
  before insert or update on public.user_preferences
  for each row execute function private.user_preferences_guard();

alter table public.user_preferences enable row level security;
revoke all on public.user_preferences from anon, authenticated;
grant select, insert, update on public.user_preferences to authenticated;
grant all on public.user_preferences to service_role;
create policy "user_preferences_own_select" on public.user_preferences
  for select to authenticated using (user_id = (select auth.uid()));
create policy "user_preferences_own_insert" on public.user_preferences
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "user_preferences_own_update" on public.user_preferences
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- =====================================================================
-- D. ESTADÍSTICAS (solo del usuario que consulta)
-- =====================================================================
-- Kilómetros de un viaje: los de su ruta, o la línea recta si no tiene.
create or replace function private.route_km(p_ruta jsonb, p_olat double precision, p_olng double precision,
  p_dlat double precision, p_dlng double precision)
returns double precision language sql immutable set search_path = '' as $$
  select coalesce(nullif((p_ruta ->> 'km')::double precision, 0),
                  case when p_olat is not null and p_dlat is not null then private.km(p_olat, p_olng, p_dlat, p_dlng) end, 0)
$$;
create or replace function private.trip_km(t public.trips)
returns double precision language sql stable set search_path = '' as $$
  select private.route_km(t.ruta, t.origen_lat, t.origen_lng, t.destino_lat, t.destino_lng)
$$;
revoke execute on function private.route_km(jsonb, double precision, double precision, double precision, double precision),
  private.trip_km(public.trips) from public, anon, authenticated;

-- Tramo de un pasajero sobre la ruta: de dónde lo recogen a dónde se baja.
create or replace function private.ride_km(t public.trips, r public.trip_requests)
returns double precision language plpgsql stable set search_path = '' as $$
declare
  v_coords jsonb;
  v_pick record; v_drop record;
begin
  if r.lat is null or r.lng is null or t.origen_lat is null then return private.trip_km(t); end if;
  v_coords := private.trip_coords(t);
  select * into v_pick from private.project_on_route(v_coords, r.lat, r.lng);
  select * into v_drop from private.project_on_route(v_coords, coalesce(r.destino_lat, t.destino_lat), coalesce(r.destino_lng, t.destino_lng));
  if v_drop.along_km <= v_pick.along_km then return private.trip_km(t); end if;
  return v_drop.along_km - v_pick.along_km;
end $$;
revoke execute on function private.ride_km(public.trips, public.trip_requests) from public, anon, authenticated;

create or replace function public.my_trip_stats()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_passenger jsonb;
  v_driver jsonb;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;

  if private.has_capability(v_user, 'advanced_trip_stats') then
    select jsonb_build_object(
      'requests', count(*),
      'completed', count(*) filter (where t.estado = 'finalizado' and r.estado in ('aceptado', 'abordado')),
      'upcoming', count(*) filter (where t.estado in ('por_empezar', 'en_curso') and r.estado in ('pendiente', 'aceptado', 'abordado')),
      'cancelled', count(*) filter (where r.estado in ('cancelado', 'negado') or t.estado in ('cancelado', 'no_iniciado')),
      'km', round(coalesce(sum(private.ride_km(t, r)) filter (where t.estado = 'finalizado' and r.estado in ('aceptado', 'abordado')), 0)::numeric, 1),
      'spent', coalesce(sum(t.precio) filter (where t.estado = 'finalizado' and r.estado in ('aceptado', 'abordado')), 0),
      'drivers', count(distinct t.driver_id) filter (where t.estado = 'finalizado' and r.estado in ('aceptado', 'abordado')),
      'rating', (select p.rating_passenger_avg from public.profiles p where p.id = v_user),
      'rating_count', (select p.rating_passenger_count from public.profiles p where p.id = v_user))
      into v_passenger
      from public.trip_requests r
      join public.trips t on t.id = r.trip_id
     where r.passenger_id = v_user;
  end if;

  if private.has_capability(v_user, 'advanced_driver_stats') then
    with mine as (
      select t.*, (select count(*) from public.trip_requests r where r.trip_id = t.id and r.estado in ('aceptado', 'abordado')) as pasajeros
        from public.trips t where t.driver_id = v_user
    ), done as (select * from mine where estado = 'finalizado'),
    answered as (
      select r.estado from public.trip_requests r join public.trips t on t.id = r.trip_id
       where t.driver_id = v_user and r.estado in ('aceptado', 'abordado', 'negado'))
    select jsonb_build_object(
      'published', (select count(*) from mine),
      'completed', (select count(*) from done),
      'upcoming', (select count(*) from mine where estado in ('por_empezar', 'en_curso')),
      'cancelled', (select count(*) from mine where estado in ('cancelado', 'no_iniciado')),
      'passengers', (select coalesce(sum(pasajeros), 0) from done),
      'km', round((select coalesce(sum(private.route_km(ruta, origen_lat, origen_lng, destino_lat, destino_lng)), 0) from done)::numeric, 1),
      'seats_offered', (select coalesce(sum(cupos_totales), 0) from done),
      -- Aportes acordados (precio × pasajeros) y los que el conductor marcó como recibidos.
      'agreed', (select coalesce(sum(precio * pasajeros), 0) from done),
      'paid', (select coalesce(sum(t.precio), 0) from public.trip_requests r join public.trips t on t.id = r.trip_id
                where t.driver_id = v_user and t.estado = 'finalizado' and r.pago = 'pagado'),
      'accepted', (select count(*) from answered where estado in ('aceptado', 'abordado')),
      'rejected', (select count(*) from answered where estado = 'negado'),
      'rating', (select p.rating_driver_avg from public.profiles p where p.id = v_user),
      'rating_count', (select p.rating_driver_count from public.profiles p where p.id = v_user))
      into v_driver;
  end if;

  return jsonb_build_object('passenger', v_passenger, 'driver', v_driver);
end $$;
revoke execute on function public.my_trip_stats() from public, anon;
grant execute on function public.my_trip_stats() to authenticated;

-- =====================================================================
-- E. NOTIFICACIONES PENDIENTES (solo el servidor)
-- =====================================================================
-- Toma las alertas sin avisar (de un viaje, de un horario o todas), decide
-- cuáles se envían y las marca. Máximo 3 alertas enviadas por usuario cada
-- 24 horas; las demás quedan visibles en la app sin notificación.
-- Textos con lugares sin número de casa (private.public_label).
create or replace function public.claim_alert_pushes(p_trip_id uuid default null, p_schedule_id uuid default null)
returns table (user_id uuid, title text, body text, trip_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  h record;
  v_send boolean;
begin
  for h in
    select a.user_id, a.trip_id, t.origen_nombre, t.destino_nombre, t.salida_at, p.nombre as driver_nombre
      from public.trip_alert_hits a
      join public.trips t on t.id = a.trip_id
      join public.profiles p on p.id = t.driver_id
     where a.pushed_at is null
       and (p_trip_id is null or a.trip_id = p_trip_id)
       and (p_schedule_id is null or t.recurring_trip_id = p_schedule_id)
     order by a.created_at
       for update of a skip locked
  loop
    v_send := coalesce((select u.notifications_enabled from public.profiles u where u.id = h.user_id), false)
      and coalesce((select pr.avisar_alertas from public.user_preferences pr where pr.user_id = h.user_id), true)
      and (select count(*) from public.trip_alert_hits x
            where x.user_id = h.user_id and x.push_sent and x.pushed_at > now() - interval '24 hours') < 3;
    update public.trip_alert_hits a set pushed_at = now(), push_sent = v_send
     where a.user_id = h.user_id and a.trip_id = h.trip_id;
    if v_send then
      user_id := h.user_id;
      trip_id := h.trip_id;
      title := 'Nuevo viaje compatible';
      body := split_part(h.driver_nombre, ' ', 1) || ' va de ' || coalesce(private.public_label(h.origen_nombre), 'tu zona')
              || ' a ' || coalesce(private.public_label(h.destino_nombre), 'tu destino') || ' · '
              || to_char(h.salida_at at time zone 'America/Bogota', 'DD/MM HH24:MI');
      return next;
    end if;
  end loop;
end $$;

-- Un aviso por conductor y día cuando el horario semanal publicó viajes nuevos.
create or replace function public.claim_recurring_pushes()
returns table (user_id uuid, title text, body text)
language plpgsql security definer set search_path = '' as $$
declare
  s record;
begin
  for s in
    select r.driver_id, count(*) as nuevos, min(t.salida_at) as primero,
           (array_agg(private.public_label(r.destino_nombre)))[1] as destino
      from public.recurring_trips r
      join public.trips t on t.recurring_trip_id = r.id
     where t.created_at > r.avisado_at and t.salida_at > now() and t.estado = 'por_empezar'
       and r.avisado_at < now() - interval '20 hours'
     group by r.driver_id
  loop
    update public.recurring_trips set avisado_at = now() where driver_id = s.driver_id;
    continue when not coalesce((select u.notifications_enabled from public.profiles u where u.id = s.driver_id), false)
               or not coalesce((select pr.avisar_recurrentes from public.user_preferences pr where pr.user_id = s.driver_id), true);
    user_id := s.driver_id;
    title := 'Publicamos tus viajes de la semana';
    body := case when s.nuevos = 1
                 then 'Tu viaje a ' || coalesce(s.destino, 'tu destino') || ' del ' || to_char(s.primero at time zone 'America/Bogota', 'DD/MM HH24:MI') || ' ya está publicado.'
                 else s.nuevos || ' viajes de tus horarios ya están publicados. El próximo sale el ' || to_char(s.primero at time zone 'America/Bogota', 'DD/MM HH24:MI') || '.' end;
    return next;
  end loop;
end $$;

revoke execute on function public.claim_alert_pushes(uuid, uuid), public.claim_recurring_pushes() from public, anon, authenticated;
grant execute on function public.claim_alert_pushes(uuid, uuid), public.claim_recurring_pushes() to service_role;

-- Cada 5 minutos, si hay algo pendiente, pide a la función notify que lo
-- envíe. URL, clave pública y secreto compartido están en Vault
-- (convia_project_url, convia_anon_key, convia_cron_secret); sin ellos no hace nada.
create extension if not exists pg_net;

create or replace function private.dispatch_pending_pushes()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_url text; v_anon text; v_secret text;
begin
  if not exists (select 1 from public.trip_alert_hits where pushed_at is null and created_at > now() - interval '1 day')
     and not exists (select 1 from public.recurring_trips r join public.trips t on t.recurring_trip_id = r.id
                      where t.created_at > r.avisado_at and t.salida_at > now() and r.avisado_at < now() - interval '20 hours') then
    return;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'convia_project_url';
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'convia_anon_key';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'convia_cron_secret';
  if v_url is null or v_anon is null or v_secret is null then return; end if;
  perform net.http_post(
    url := v_url || '/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon, 'x-convia-cron', v_secret),
    body := jsonb_build_object('event', 'sweep'));
end $$;
revoke execute on function private.dispatch_pending_pushes() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'dispatch-pending-pushes';
select cron.schedule('dispatch-pending-pushes', '*/5 * * * *', $$select private.dispatch_pending_pushes()$$);

-- Las capacidades ya existían en el catálogo (migración 24); ahora están construidas.
