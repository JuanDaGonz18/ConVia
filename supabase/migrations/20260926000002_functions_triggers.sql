-- =====================================================================
-- ConVía — funciones, triggers y RPCs
-- =====================================================================

-- ---------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger profiles_updated_at           before update on public.profiles           for each row execute function public.set_updated_at();
create trigger vehicles_updated_at           before update on public.vehicles           for each row execute function public.set_updated_at();
create trigger trips_updated_at              before update on public.trips              for each row execute function public.set_updated_at();
create trigger trip_requests_updated_at      before update on public.trip_requests      for each row execute function public.set_updated_at();
create trigger face_verifications_updated_at before update on public.face_verifications for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.current_institution_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select institution_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_trip_driver(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trips where id = p_trip_id and driver_id = auth.uid())
$$;

create or replace function public.is_trip_passenger(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trip_requests
    where trip_id = p_trip_id and passenger_id = auth.uid()
      and estado in ('aceptado', 'abordado')
  )
$$;

create or replace function public.seats_taken(p_trip_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.trip_requests
  where trip_id = p_trip_id and estado in ('aceptado', 'abordado')
$$;

-- Pantalla "Correo institucional": ¿el dominio está permitido?
create or replace function public.check_email_domain(p_email text)
returns table (institution_id uuid, nombre text, tipo public.community_type, dominio text)
language sql stable security definer set search_path = '' as $$
  select i.id, i.nombre, i.tipo, i.dominio
  from public.institutions i
  where i.activo and i.dominio = lower(split_part(p_email, '@', 2))
$$;

-- ---------------------------------------------------------------------
-- Crear perfil al registrarse (lee metadata: nombre, rol)
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_inst uuid;
begin
  select id into v_inst from public.institutions
  where activo and dominio = lower(split_part(new.email, '@', 2));

  insert into public.profiles (id, email, nombre, rol, institution_id, terms_accepted_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nombre', ''),
    coalesce((new.raw_user_meta_data->>'rol')::public.user_role, 'usuario'),
    v_inst,
    case when (new.raw_user_meta_data->>'terms_accepted')::boolean then now() end
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Viajes: asignar institución y cupos desde el vehículo
-- ---------------------------------------------------------------------
create or replace function public.trips_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_puestos smallint;
begin
  select puestos into v_puestos from public.vehicles
  where id = new.vehicle_id and driver_id = new.driver_id and activo;
  if v_puestos is null then
    raise exception 'El vehículo no pertenece al conductor o no está activo';
  end if;
  if new.cupos_totales is null or new.cupos_totales > v_puestos then
    new.cupos_totales := v_puestos;
  end if;
  new.institution_id := (select institution_id from public.profiles where id = new.driver_id);
  new.estado := 'por_empezar';
  return new;
end $$;

create trigger trips_before_insert_trg
  before insert on public.trips
  for each row execute function public.trips_before_insert();

-- ---------------------------------------------------------------------
-- Calificaciones → promedio en el perfil
-- ---------------------------------------------------------------------
create or replace function public.refresh_rating()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles p set
    rating_avg   = coalesce((select round(avg(score)::numeric, 2) from public.ratings where rated_id = new.rated_id), 0),
    rating_count = (select count(*) from public.ratings where rated_id = new.rated_id)
  where p.id = new.rated_id;
  return new;
end $$;

create trigger ratings_refresh
  after insert on public.ratings
  for each row execute function public.refresh_rating();

-- ---------------------------------------------------------------------
-- RPCs de negocio (las acciones críticas pasan por aquí, no por UPDATE directo)
-- ---------------------------------------------------------------------

-- Conductor acepta / niega un punto solicitado
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
  if p_accept and public.seats_taken(t.id) >= t.cupos_totales then
    raise exception 'No hay cupos disponibles';
  end if;

  update public.trip_requests
     set estado = case when p_accept then 'aceptado'::public.request_status else 'negado'::public.request_status end,
         responded_at = now()
   where id = p_request_id
  returning * into r;
  return r;
end $$;

-- Pasajero cancela su solicitud
create or replace function public.cancel_trip_request(p_request_id uuid)
returns public.trip_requests language plpgsql security definer set search_path = '' as $$
declare r public.trip_requests;
begin
  update public.trip_requests
     set estado = 'cancelado'
   where id = p_request_id and passenger_id = auth.uid() and estado in ('pendiente', 'aceptado')
  returning * into r;
  if r.id is null then raise exception 'No se puede cancelar esta solicitud'; end if;
  return r;
end $$;

-- Conductor escanea el QR del pasajero
create or replace function public.board_passenger(p_qr_token uuid)
returns public.trip_requests language plpgsql security definer set search_path = '' as $$
declare r public.trip_requests;
begin
  select tr.* into r
  from public.trip_requests tr
  join public.trips t on t.id = tr.trip_id
  where tr.qr_token = p_qr_token and t.driver_id = auth.uid()
  for update of tr;
  if r.id is null then raise exception 'QR inválido para tus viajes'; end if;
  if r.estado = 'abordado' then return r; end if;
  if r.estado <> 'aceptado' then raise exception 'El pasajero no tiene un cupo aceptado'; end if;

  update public.trip_requests set estado = 'abordado', boarded_at = now()
   where id = r.id returning * into r;
  return r;
end $$;

-- Conductor empieza el viaje
create or replace function public.start_trip(p_trip_id uuid)
returns public.trips language plpgsql security definer set search_path = '' as $$
declare t public.trips;
begin
  update public.trips set estado = 'en_curso', started_at = now()
   where id = p_trip_id and driver_id = auth.uid() and estado = 'por_empezar'
  returning * into t;
  if t.id is null then raise exception 'No se puede empezar este viaje'; end if;
  -- las solicitudes pendientes quedan negadas al arrancar
  update public.trip_requests set estado = 'negado', responded_at = now()
   where trip_id = p_trip_id and estado = 'pendiente';
  return t;
end $$;

-- Conductor termina el viaje
create or replace function public.finish_trip(p_trip_id uuid)
returns public.trips language plpgsql security definer set search_path = '' as $$
declare t public.trips;
begin
  update public.trips set estado = 'finalizado', finished_at = now()
   where id = p_trip_id and driver_id = auth.uid() and estado = 'en_curso'
  returning * into t;
  if t.id is null then raise exception 'No se puede terminar este viaje'; end if;
  delete from public.trip_locations where trip_id = p_trip_id;
  return t;
end $$;

-- Conductor cancela un viaje que no ha empezado
create or replace function public.cancel_trip(p_trip_id uuid)
returns public.trips language plpgsql security definer set search_path = '' as $$
declare t public.trips;
begin
  update public.trips set estado = 'cancelado'
   where id = p_trip_id and driver_id = auth.uid() and estado = 'por_empezar'
  returning * into t;
  if t.id is null then raise exception 'No se puede cancelar este viaje'; end if;
  update public.trip_requests set estado = 'cancelado'
   where trip_id = p_trip_id and estado in ('pendiente', 'aceptado');
  return t;
end $$;

-- Cambio de rol ("Quiero ser usuario / conductor")
create or replace function public.switch_role(p_rol public.user_role)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  if p_rol = 'usuario' and exists (
    select 1 from public.trips where driver_id = auth.uid() and estado in ('por_empezar', 'en_curso')
  ) then
    raise exception 'Tienes viajes activos como conductor';
  end if;
  update public.profiles set rol = p_rol where id = auth.uid() returning * into p;
  return p;
end $$;

-- Marcar verificación facial (solo backend / Edge Function con service_role)
create or replace function public.set_verification_result(p_verification_id uuid, p_status public.verification_status, p_score numeric default null, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  update public.face_verifications set status = p_status, score = p_score, error = p_error
   where id = p_verification_id returning user_id into v_user;
  update public.profiles set
    verification_status = p_status,
    verified_at = case when p_status = 'verificado' then now() else verified_at end
  where id = v_user;
end $$;

-- ---------------------------------------------------------------------
-- Vista: viajes disponibles para el Home del pasajero
-- ---------------------------------------------------------------------
create or replace view public.available_trips
with (security_invoker = true) as
select
  t.*,
  t.cupos_totales - public.seats_taken(t.id) as cupos_disponibles,
  p.nombre      as driver_nombre,
  p.avatar_url  as driver_avatar_url,
  p.rating_avg  as driver_rating,
  v.marca       as vehicle_marca,
  v.color       as vehicle_color,
  v.placa       as vehicle_placa,
  v.foto_url    as vehicle_foto_url
from public.trips t
join public.profiles p on p.id = t.driver_id
join public.vehicles v on v.id = t.vehicle_id
where t.estado = 'por_empezar'
  and t.salida_at > now() - interval '15 minutes';
