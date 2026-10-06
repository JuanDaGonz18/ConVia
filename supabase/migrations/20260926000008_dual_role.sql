-- =====================================================================
-- ConVía — doble rol (pasajero / conductor)
--  * profiles.rol pasa a ser el MODO ACTIVO (usuario = pasajero).
--  * Conducir es un permiso aparte: driver_profiles con licencia y estado
--    pendiente | aprobado | rechazado | suspendido. Solo "aprobado" publica.
--  * El usuario envía su licencia con upsert_driver_profile(); no puede
--    aprobarse a sí mismo (la aprobación se hace con service_role / dashboard).
--  * Cambio de modo bloqueado solo con un viaje EN CURSO como conductor.
--  * Sin choques de horario: nadie publica, pide cupo ni es aceptado a ±90 min
--    de otro viaje suyo (como conductor o pasajero).
--  * Calificaciones separadas por rol; available_trips.driver_rating muestra
--    solo la calificación como conductor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Permiso de conductor
-- ---------------------------------------------------------------------
create type public.driver_status as enum ('pendiente', 'aprobado', 'rechazado', 'suspendido');

create table public.driver_profiles (
  user_id            uuid primary key references public.profiles(id) on delete cascade,
  status             public.driver_status not null default 'pendiente',
  license_number     text check (license_number is null or char_length(trim(license_number)) between 4 and 30),
  license_category   text check (license_category is null or license_category in ('A1','A2','B1','B2','B3','C1','C2','C3')),
  license_expires_on date,
  review_notes       text,
  submitted_at       timestamptz,
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger driver_profiles_updated_at
  before update on public.driver_profiles
  for each row execute function public.set_updated_at();

alter table public.driver_profiles enable row level security;
revoke all on public.driver_profiles from anon, authenticated;
grant select on public.driver_profiles to authenticated;
grant all on public.driver_profiles to service_role;

-- Solo lectura propia; las escrituras van por RPC o service_role.
create policy "driver_profiles_own_read" on public.driver_profiles
  for select to authenticated using (user_id = (select auth.uid()));

alter publication supabase_realtime add table public.driver_profiles;

-- Conductores actuales (rol conductor o con vehículo) quedan aprobados.
insert into public.driver_profiles (user_id, status, reviewed_at, review_notes)
select p.id, 'aprobado', now(), 'Aprobado automáticamente al migrar a doble rol'
from public.profiles p
where p.rol = 'conductor' or exists (select 1 from public.vehicles v where v.driver_id = p.id)
on conflict (user_id) do nothing;

-- Quien se registra como conductor arranca con su permiso pendiente.
create or replace function public.profiles_create_driver_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.rol = 'conductor' then
    insert into public.driver_profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  end if;
  return new;
end $$;

create trigger profiles_create_driver_profile_trg
  after insert on public.profiles
  for each row execute function public.profiles_create_driver_profile();

-- ---------------------------------------------------------------------
-- 2. Helpers (schema private, no expuesto por la Data API)
-- ---------------------------------------------------------------------
create or replace function private.is_approved_driver(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.driver_profiles where user_id = p_user and status = 'aprobado')
$$;

-- ¿El usuario ya tiene un viaje (conductor o pasajero) a ±90 min de p_at?
create or replace function private.has_schedule_conflict(p_user uuid, p_at timestamptz, p_exclude_trip uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trips t
    where t.driver_id = p_user
      and t.estado in ('por_empezar', 'en_curso')
      and t.id is distinct from p_exclude_trip
      and t.salida_at between p_at - interval '90 minutes' and p_at + interval '90 minutes'
  ) or exists (
    select 1 from public.trip_requests r
    join public.trips t on t.id = r.trip_id
    where r.passenger_id = p_user
      and r.estado in ('pendiente', 'aceptado', 'abordado')
      and t.estado in ('por_empezar', 'en_curso')
      and t.id is distinct from p_exclude_trip
      and t.salida_at between p_at - interval '90 minutes' and p_at + interval '90 minutes'
  )
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. RPC: enviar / actualizar licencia
-- ---------------------------------------------------------------------
create or replace function public.upsert_driver_profile(
  p_license_number text,
  p_license_category text,
  p_license_expires_on date
)
returns public.driver_profiles language plpgsql security definer set search_path = '' as $$
declare
  d public.driver_profiles;
  v_number text := upper(regexp_replace(coalesce(p_license_number, ''), '\s', '', 'g'));
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if char_length(v_number) < 4 then raise exception 'Número de licencia inválido'; end if;
  if p_license_category is null or p_license_category not in ('A1','A2','B1','B2','B3','C1','C2','C3') then
    raise exception 'Categoría de licencia inválida';
  end if;
  if p_license_expires_on is null or p_license_expires_on <= current_date then
    raise exception 'La licencia está vencida';
  end if;

  select * into d from public.driver_profiles where user_id = auth.uid() for update;
  if found and d.status = 'suspendido' then
    raise exception 'Tu permiso de conductor está suspendido';
  end if;

  insert into public.driver_profiles as dp (user_id, status, license_number, license_category, license_expires_on, submitted_at)
  values (auth.uid(), 'pendiente', v_number, p_license_category, p_license_expires_on, now())
  on conflict (user_id) do update set
    license_number = excluded.license_number,
    license_category = excluded.license_category,
    license_expires_on = excluded.license_expires_on,
    submitted_at = now(),
    -- Cambiar los datos de la licencia la devuelve a revisión.
    status = case
      when dp.status = 'aprobado'
       and dp.license_number is not distinct from excluded.license_number
       and dp.license_category is not distinct from excluded.license_category
       and dp.license_expires_on is not distinct from excluded.license_expires_on
      then 'aprobado'::public.driver_status
      else 'pendiente'::public.driver_status
    end,
    review_notes = case when dp.status = 'rechazado' then null else dp.review_notes end
  returning * into d;
  return d;
end $$;

-- ---------------------------------------------------------------------
-- 4. Cambio de modo más flexible
-- ---------------------------------------------------------------------
create or replace function public.switch_role(p_rol public.user_role)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  if p_rol = 'usuario' and exists (
    select 1 from public.trips where driver_id = auth.uid() and estado = 'en_curso'
  ) then
    raise exception 'Tienes un viaje en curso como conductor';
  end if;
  if p_rol = 'conductor' then
    insert into public.driver_profiles (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  end if;
  update public.profiles set rol = p_rol where id = auth.uid() returning * into p;
  return p;
end $$;

-- ---------------------------------------------------------------------
-- 5. Publicar viajes: conductor aprobado y sin choque de horario
-- ---------------------------------------------------------------------
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

create or replace function public.trips_before_update_schedule()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.salida_at is distinct from old.salida_at
     and private.has_schedule_conflict(new.driver_id, new.salida_at, new.id) then
    raise exception 'Ya tienes otro viaje a menos de 90 minutos de esa hora';
  end if;
  return new;
end $$;

create trigger trips_before_update_schedule_trg
  before update of salida_at on public.trips
  for each row execute function public.trips_before_update_schedule();

drop policy if exists "trips_insert_driver" on public.trips;
create policy "trips_insert_driver" on public.trips for insert to authenticated
  with check (
    driver_id = (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid())
                and p.rol = 'conductor' and p.verification_status = 'verificado')
    and private.is_approved_driver((select auth.uid())));

-- ---------------------------------------------------------------------
-- 6. Pedir cupo / aceptar: sin choque de horario
-- ---------------------------------------------------------------------
create or replace function public.trip_requests_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_salida timestamptz;
begin
  select salida_at into v_salida from public.trips where id = new.trip_id;
  if v_salida is not null and private.has_schedule_conflict(new.passenger_id, v_salida, new.trip_id) then
    raise exception 'Ya tienes otro viaje a menos de 90 minutos de esa hora';
  end if;
  return new;
end $$;

create trigger trip_requests_before_insert_trg
  before insert on public.trip_requests
  for each row execute function public.trip_requests_before_insert();

create or replace function public.respond_trip_request(p_request_id uuid, p_accept boolean)
returns public.trip_requests language plpgsql security definer set search_path = '' as $$
declare
  r public.trip_requests;
  t public.trips;
begin
  select * into r from public.trip_requests where id = p_request_id for update;
  if not found then raise exception 'Solicitud no encontrada'; end if;
  select * into t from public.trips where id = r.trip_id for update;
  if t.driver_id <> auth.uid() then raise exception 'No autorizado'; end if;
  if r.estado <> 'pendiente' then raise exception 'La solicitud ya fue respondida'; end if;
  if t.estado not in ('por_empezar', 'en_curso') then raise exception 'El viaje ya no admite cambios'; end if;
  if p_accept and private.seats_taken(t.id) >= t.cupos_totales then
    raise exception 'No hay cupos disponibles';
  end if;
  if p_accept and private.has_schedule_conflict(r.passenger_id, t.salida_at, t.id) then
    raise exception 'El pasajero ya tiene otro viaje a menos de 90 minutos de esa hora';
  end if;

  update public.trip_requests
     set estado = case when p_accept then 'aceptado'::public.request_status else 'negado'::public.request_status end,
         responded_at = now()
   where id = p_request_id
  returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- 7. Calificaciones separadas por rol
-- ---------------------------------------------------------------------
alter table public.ratings add column rated_role public.user_role;

update public.ratings r set rated_role = case when t.driver_id = r.rated_id then 'conductor'::public.user_role else 'usuario'::public.user_role end
from public.trips t where t.id = r.trip_id;

alter table public.ratings alter column rated_role set not null;

alter table public.profiles
  add column rating_driver_avg      numeric(3,2) not null default 0,
  add column rating_driver_count    integer      not null default 0,
  add column rating_passenger_avg   numeric(3,2) not null default 0,
  add column rating_passenger_count integer      not null default 0;

-- rated_role lo decide el servidor, nunca el cliente.
create or replace function public.ratings_set_role()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.rated_role := case
    when exists (select 1 from public.trips where id = new.trip_id and driver_id = new.rated_id)
    then 'conductor'::public.user_role else 'usuario'::public.user_role end;
  return new;
end $$;

create trigger ratings_set_role_trg
  before insert on public.ratings
  for each row execute function public.ratings_set_role();

create or replace function public.refresh_rating()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles p set
    rating_avg             = coalesce((select round(avg(score)::numeric, 2) from public.ratings where rated_id = new.rated_id), 0),
    rating_count           = (select count(*) from public.ratings where rated_id = new.rated_id),
    rating_driver_avg      = coalesce((select round(avg(score)::numeric, 2) from public.ratings where rated_id = new.rated_id and rated_role = 'conductor'), 0),
    rating_driver_count    = (select count(*) from public.ratings where rated_id = new.rated_id and rated_role = 'conductor'),
    rating_passenger_avg   = coalesce((select round(avg(score)::numeric, 2) from public.ratings where rated_id = new.rated_id and rated_role = 'usuario'), 0),
    rating_passenger_count = (select count(*) from public.ratings where rated_id = new.rated_id and rated_role = 'usuario')
  where p.id = new.rated_id;
  return new;
end $$;

update public.profiles p set
  rating_driver_avg      = coalesce((select round(avg(score)::numeric, 2) from public.ratings r where r.rated_id = p.id and r.rated_role = 'conductor'), 0),
  rating_driver_count    = (select count(*) from public.ratings r where r.rated_id = p.id and r.rated_role = 'conductor'),
  rating_passenger_avg   = coalesce((select round(avg(score)::numeric, 2) from public.ratings r where r.rated_id = p.id and r.rated_role = 'usuario'), 0),
  rating_passenger_count = (select count(*) from public.ratings r where r.rated_id = p.id and r.rated_role = 'usuario');

-- Mismo nombre y tipo de columna; ahora solo la calificación como conductor.
create or replace view public.available_trips
with (security_invoker = true) as
select
  t.*,
  t.cupos_totales - private.seats_taken(t.id) as cupos_disponibles,
  p.nombre            as driver_nombre,
  p.avatar_url        as driver_avatar_url,
  p.rating_driver_avg as driver_rating,
  v.marca             as vehicle_marca,
  v.color             as vehicle_color,
  v.placa             as vehicle_placa,
  v.foto_url          as vehicle_foto_url
from public.trips t
join public.profiles p on p.id = t.driver_id
join public.vehicles v on v.id = t.vehicle_id
where t.estado = 'por_empezar'
  and t.salida_at > now() - interval '15 minutes';

-- ---------------------------------------------------------------------
-- 8. Permisos de las funciones nuevas (por defecto PUBLIC puede ejecutar)
-- ---------------------------------------------------------------------
revoke execute on function public.upsert_driver_profile(text, text, date) from public, anon;
grant execute on function public.upsert_driver_profile(text, text, date) to authenticated, service_role;
revoke execute on function public.switch_role(public.user_role) from public, anon;
grant execute on function public.switch_role(public.user_role) to authenticated, service_role;
revoke execute on function public.respond_trip_request(uuid, boolean) from public, anon;
grant execute on function public.respond_trip_request(uuid, boolean) to authenticated, service_role;
revoke execute on function public.profiles_create_driver_profile() from public, anon, authenticated;
revoke execute on function public.trips_before_update_schedule() from public, anon, authenticated;
revoke execute on function public.trip_requests_before_insert() from public, anon, authenticated;
revoke execute on function public.ratings_set_role() from public, anon, authenticated;
