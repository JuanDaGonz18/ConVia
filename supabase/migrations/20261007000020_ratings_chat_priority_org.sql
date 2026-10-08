-- =====================================================================
-- ConVía — calificación al conductor, chat cerrado al terminar,
-- prioridad ConVía+ en solicitudes y aislamiento por organización.
--
--  1. private.is_plus() y la columna calculada profiles.is_plus para
--     mostrar el distintivo ConVía+ (solo de perfiles que el usuario ya
--     puede ver: los de su organización).
--  2. Calificaciones: solo por funciones del servidor. El pasajero
--     califica al conductor (una vez por viaje) con rate_trip_driver().
--     Se elimina el INSERT directo, que permitía calificar a cualquier
--     participante (p. ej. pasajero → pasajero).
--  3. Historial del pasajero y calificaciones pendientes.
--  4. Chat: solo se escribe mientras el viaje está por empezar o en curso;
--     los pasajeros dejan de verlo cuando el viaje termina.
--  5. Prioridad ConVía+: el conductor recibe las solicitudes ordenadas por
--     el servidor, y no puede aceptar una solicitud FREE si con eso deja
--     sin cupo a solicitudes ConVía+ pendientes. Nadie es rechazado
--     automáticamente.
--  6. Organización: comprobaciones explícitas en favoritos y solicitudes,
--     además de las políticas RLS por institución que ya existían.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ¿Tiene ConVía+?
-- ---------------------------------------------------------------------
create or replace function private.is_plus(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.effective_tier(p_user) = 'plus'
$$;

-- El esquema private no está expuesto por la API; authenticated lo necesita
-- para evaluar vistas y políticas.
revoke execute on function private.is_plus(uuid) from public, anon;
grant execute on function private.is_plus(uuid) to authenticated;

-- Columna calculada para PostgREST: select('nombre, is_plus').
-- Solo responde por perfiles visibles para quien consulta (misma organización).
create or replace function public.is_plus(p public.profiles)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.is_plus(p.id)
   where exists (select 1 from public.profiles x
                  where x.id = p.id
                    and (x.id = (select auth.uid()) or x.institution_id = (select private.current_institution_id())))
$$;

revoke execute on function public.is_plus(public.profiles) from public, anon;
grant execute on function public.is_plus(public.profiles) to authenticated;

-- Viajes disponibles: distintivo ConVía+ del conductor (columna nueva al final).
create or replace view public.available_trips with (security_invoker = true) as
 select t.id,
    t.driver_id,
    t.vehicle_id,
    t.institution_id,
    t.origen_nombre,
    t.origen_lat,
    t.origen_lng,
    t.destino_nombre,
    t.destino_lat,
    t.destino_lng,
    t.sector,
    t.salida_at,
    t.precio,
    t.cupos_totales,
    t.descripcion,
    t.estado,
    t.started_at,
    t.finished_at,
    t.created_at,
    t.updated_at,
    t.cupos_totales - private.seats_taken(t.id) as cupos_disponibles,
    p.nombre as driver_nombre,
    p.avatar_url as driver_avatar_url,
    p.rating_driver_avg as driver_rating,
    v.marca as vehicle_marca,
    v.color as vehicle_color,
    v.placa as vehicle_placa,
    v.foto_url as vehicle_foto_url,
    t.ruta,
    private.is_plus(t.driver_id) as driver_is_plus
   from public.trips t
     join public.profiles p on p.id = t.driver_id
     join public.vehicles v on v.id = t.vehicle_id
  where t.estado = 'por_empezar'::public.trip_status and t.salida_at > (now() - '00:15:00'::interval);

-- ---------------------------------------------------------------------
-- 2. Calificaciones solo por funciones del servidor
-- ---------------------------------------------------------------------
drop policy if exists "ratings_insert_participant" on public.ratings;
revoke insert, update, delete on public.ratings from anon, authenticated;

-- El pasajero califica al conductor de un viaje finalizado en el que tuvo cupo.
create or replace function public.rate_trip_driver(p_trip_id uuid, p_score smallint, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  t public.trips;
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
begin
  select * into t from public.trips where id = p_trip_id;
  if t.id is null
     or t.estado <> 'finalizado'
     or not exists (select 1 from public.trip_requests r
                     where r.trip_id = t.id and r.passenger_id = auth.uid()
                       and r.estado in ('aceptado', 'abordado')) then
    raise exception 'Solo puedes calificar al conductor de un viaje finalizado en el que tuviste cupo';
  end if;
  if p_score is null or p_score < 1 or p_score > 5 then raise exception 'La calificación debe ser de 1 a 5'; end if;
  if char_length(coalesce(v_comment, '')) > 500 then raise exception 'El comentario es muy largo (máximo 500 caracteres)'; end if;
  if exists (select 1 from public.ratings
              where trip_id = t.id and rater_id = auth.uid() and rated_id = t.driver_id) then
    raise exception 'Ya calificaste al conductor de este viaje';
  end if;

  insert into public.ratings (trip_id, rater_id, rated_id, score, comentario)
  values (t.id, auth.uid(), t.driver_id, p_score, v_comment);
end $$;

revoke execute on function public.rate_trip_driver(uuid, smallint, text) from public, anon;
grant execute on function public.rate_trip_driver(uuid, smallint, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Historial del pasajero y calificaciones pendientes
-- ---------------------------------------------------------------------
-- Todos los viajes en los que el usuario tuvo cupo (o que le cancelaron),
-- con su conductor y la calificación que le dio.
create or replace function public.passenger_trip_history()
returns table (
  trip_id            uuid,
  request_id         uuid,
  request_estado     public.request_status,
  estado             public.trip_status,
  origen_nombre      text,
  destino_nombre     text,
  salida_at          timestamptz,
  finished_at        timestamptz,
  precio             numeric,
  driver_id          uuid,
  driver_nombre      text,
  driver_avatar_url  text,
  driver_rating      numeric,
  driver_is_plus     boolean,
  my_driver_score    smallint
)
language sql stable security definer set search_path = '' as $$
  select t.id, r.id, r.estado, t.estado, t.origen_nombre, t.destino_nombre, t.salida_at, t.finished_at, t.precio,
         p.id, p.nombre, p.avatar_url, p.rating_driver_avg, private.is_plus(p.id),
         (select rt.score from public.ratings rt
           where rt.trip_id = t.id and rt.rater_id = auth.uid() and rt.rated_id = t.driver_id)
    from public.trip_requests r
    join public.trips t on t.id = r.trip_id
    join public.profiles p on p.id = t.driver_id
   where r.passenger_id = auth.uid()
     and (r.estado in ('aceptado', 'abordado') or (t.estado = 'cancelado' and r.estado = 'cancelado'))
   order by t.salida_at desc
   limit 100
$$;

revoke execute on function public.passenger_trip_history() from public, anon;
grant execute on function public.passenger_trip_history() to authenticated;

-- ---------------------------------------------------------------------
-- 4. trip_members: distintivo ConVía+ y calificación del pasajero al conductor
-- ---------------------------------------------------------------------
create or replace function public.trip_members(p_trip_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  t public.trips;
  v_is_driver boolean;
  v_cancel_recipients uuid[];
  v_result jsonb;
begin
  select * into t from public.trips where id = p_trip_id;
  if not found then raise exception 'Viaje no encontrado'; end if;
  v_is_driver := t.driver_id = v_user;
  -- Solo el conductor y los pasajeros aceptados (o que abordaron).
  if not v_is_driver and not private.is_trip_participant(t.id, v_user) then
    raise exception 'Solo los integrantes del viaje pueden ver esta información';
  end if;

  -- En un viaje cancelado, los pasajeros que tenía son los que se avisaron.
  if t.estado = 'cancelado' then
    select recipients into v_cancel_recipients from public.trip_updates
     where trip_id = t.id and kind = 'cancelled' order by created_at desc limit 1;
  end if;

  select jsonb_build_object(
    'viewer_is_driver', v_is_driver,
    'trip', jsonb_build_object(
      'id', t.id,
      'origen_nombre', t.origen_nombre, 'origen_lat', t.origen_lat, 'origen_lng', t.origen_lng,
      'destino_nombre', t.destino_nombre, 'destino_lat', t.destino_lat, 'destino_lng', t.destino_lng,
      'salida_at', t.salida_at, 'started_at', t.started_at, 'finished_at', t.finished_at,
      'estado', t.estado, 'precio', t.precio, 'cupos_totales', t.cupos_totales,
      'descripcion', t.descripcion, 'ruta', t.ruta,
      'vehicle', (select jsonb_build_object('marca', v.marca, 'color', v.color, 'placa', v.placa, 'foto_url', v.foto_url)
                    from public.vehicles v where v.id = t.vehicle_id)
    ),
    'driver', (select jsonb_build_object('id', p.id, 'nombre', p.nombre, 'avatar_url', p.avatar_url,
                                         'rating', p.rating_driver_avg, 'rating_count', p.rating_driver_count,
                                         'is_plus', private.is_plus(p.id))
                 from public.profiles p where p.id = t.driver_id),
    -- Lo que el pasajero que consulta le dio al conductor (null si no ha calificado).
    'mi_calificacion_conductor', case when not v_is_driver then (
      select jsonb_build_object('score', rt.score, 'comentario', rt.comentario)
        from public.ratings rt
       where rt.trip_id = t.id and rt.rater_id = v_user and rt.rated_id = t.driver_id) end,
    'passengers', coalesce((
      select jsonb_agg(jsonb_build_object(
          'request_id', r.id,
          'id', p.id,
          'nombre', p.nombre,
          'avatar_url', p.avatar_url,
          'rating', p.rating_passenger_avg,
          'rating_count', p.rating_passenger_count,
          'is_plus', private.is_plus(p.id),
          'estado', r.estado,
          'es_yo', p.id = v_user,
          -- Datos que solo necesita el conductor.
          'direccion', case when v_is_driver or p.id = v_user then r.direccion end,
          'pago', case when v_is_driver then r.pago end,
          'mi_calificacion', case when v_is_driver then (
            select jsonb_build_object('score', rt.score, 'comentario', rt.comentario)
              from public.ratings rt
             where rt.trip_id = t.id and rt.rater_id = v_user and rt.rated_id = p.id) end
        ) order by p.nombre)
        from public.trip_requests r
        join public.profiles p on p.id = r.passenger_id
       where r.trip_id = t.id
         and (r.estado in ('aceptado', 'abordado')
              or (t.estado = 'cancelado' and r.passenger_id = any(coalesce(v_cancel_recipients, '{}'))
                  and r.estado = 'cancelado'))
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

-- ---------------------------------------------------------------------
-- 5. Chat: abierto solo mientras el viaje está activo
-- ---------------------------------------------------------------------
create or replace function private.is_trip_active(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trips where id = p_trip_id and estado in ('por_empezar', 'en_curso'))
$$;

revoke execute on function private.is_trip_active(uuid) from public, anon;
grant execute on function private.is_trip_active(uuid) to authenticated;

drop policy if exists "messages_participants_insert" on public.messages;
drop policy if exists "messages_participants_read" on public.messages;

create policy "messages_participants_insert" on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and private.is_trip_active(trip_id)
    and (
      exists (select 1 from public.trips t where t.id = messages.trip_id and t.driver_id = (select auth.uid()))
      or exists (select 1 from public.trip_requests r
                  where r.trip_id = messages.trip_id and r.passenger_id = (select auth.uid())
                    and r.estado in ('aceptado', 'abordado'))
    )
  );

-- El conductor conserva el historial; los pasajeros lo ven solo con el viaje activo.
create policy "messages_participants_read" on public.messages for select to authenticated
  using (
    exists (select 1 from public.trips t where t.id = messages.trip_id and t.driver_id = (select auth.uid()))
    or (
      private.is_trip_active(trip_id)
      and exists (select 1 from public.trip_requests r
                   where r.trip_id = messages.trip_id and r.passenger_id = (select auth.uid())
                     and r.estado in ('aceptado', 'abordado'))
    )
  );

-- ---------------------------------------------------------------------
-- 6. Prioridad ConVía+ en las solicitudes
-- ---------------------------------------------------------------------
-- Solicitudes de los viajes activos del conductor, en el orden del servidor:
-- primero ConVía+, y dentro de cada grupo la más reciente primero (orden actual).
create or replace function public.driver_trip_requests()
returns table (
  id               uuid,
  trip_id          uuid,
  passenger_id     uuid,
  direccion        text,
  estado           public.request_status,
  qr_token         uuid,
  created_at       timestamptz,
  responded_at     timestamptz,
  passenger_nombre text,
  passenger_is_plus boolean,
  origen_nombre    text,
  destino_nombre   text,
  salida_at        timestamptz
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.trip_id, r.passenger_id, r.direccion, r.estado, r.qr_token, r.created_at, r.responded_at,
         p.nombre, private.is_plus(r.passenger_id),
         t.origen_nombre, t.destino_nombre, t.salida_at
    from public.trip_requests r
    join public.trips t on t.id = r.trip_id
    join public.profiles p on p.id = r.passenger_id
   where t.driver_id = auth.uid()
     and t.estado in ('por_empezar', 'en_curso')
   order by private.is_plus(r.passenger_id) desc, r.created_at desc
$$;

revoke execute on function public.driver_trip_requests() from public, anon;
grant execute on function public.driver_trip_requests() to authenticated;

-- Aceptar/negar con prioridad: una solicitud FREE solo puede ocupar un cupo
-- si siguen quedando cupos para todas las solicitudes ConVía+ pendientes.
create or replace function public.respond_trip_request(p_request_id uuid, p_accept boolean)
returns public.trip_requests language plpgsql security definer set search_path = '' as $$
declare
  r public.trip_requests;
  t public.trips;
  v_free_seats integer;
  v_plus_pending integer;
begin
  select * into r from public.trip_requests where id = p_request_id for update;
  if not found then raise exception 'Solicitud no encontrada'; end if;
  select * into t from public.trips where id = r.trip_id for update;
  if t.driver_id <> auth.uid() then raise exception 'No autorizado'; end if;
  if r.estado <> 'pendiente' then raise exception 'La solicitud ya fue respondida'; end if;
  if t.estado not in ('por_empezar', 'en_curso') then raise exception 'El viaje ya no admite cambios'; end if;
  if p_accept and not private.has_recent_face_check(auth.uid(), 'license') then
    raise exception 'Verifica tu identidad de conductor antes de aceptar pasajeros';
  end if;

  v_free_seats := t.cupos_totales - private.seats_taken(t.id);
  if p_accept and v_free_seats <= 0 then
    raise exception 'No hay cupos disponibles';
  end if;
  if p_accept and private.has_schedule_conflict(r.passenger_id, t.salida_at, t.id) then
    raise exception 'El pasajero ya tiene otro viaje a menos de 90 minutos de esa hora';
  end if;

  if p_accept and not private.is_plus(r.passenger_id) then
    select count(*) into v_plus_pending
      from public.trip_requests o
     where o.trip_id = t.id and o.id <> r.id and o.estado = 'pendiente' and private.is_plus(o.passenger_id);
    if v_plus_pending > 0 and v_free_seats - 1 < v_plus_pending then
      raise exception 'Las solicitudes ConVía+ tienen prioridad: hay % pendiente(s) para los cupos que quedan. Respóndelas primero.', v_plus_pending;
    end if;
  end if;

  update public.trip_requests
     set estado = case when p_accept then 'aceptado'::public.request_status else 'negado'::public.request_status end,
         responded_at = now()
   where id = p_request_id
  returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- 7. Organización: comprobaciones explícitas
-- ---------------------------------------------------------------------
-- Favoritos: solo conductores de la misma organización.
drop policy if exists "favorite_drivers_own_insert" on public.favorite_drivers;
create policy "favorite_drivers_own_insert" on public.favorite_drivers for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.profiles p
                 where p.id = favorite_drivers.driver_id
                   and p.institution_id = (select private.current_institution_id()))
  );

-- Solicitudes: el pasajero y el viaje deben ser de la misma organización,
-- también si la fila llega por una función del servidor.
create or replace function public.trip_requests_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_salida timestamptz;
  v_trip_institution uuid;
begin
  select salida_at, institution_id into v_salida, v_trip_institution from public.trips where id = new.trip_id;
  if v_trip_institution is distinct from (select institution_id from public.profiles where id = new.passenger_id) then
    raise exception 'Solo puedes pedir cupo en viajes de tu organización';
  end if;
  if not private.has_recent_face_check(new.passenger_id, 'selfie') then
    raise exception 'Verifica tu rostro antes de pedir un cupo';
  end if;
  if v_salida is not null and private.has_schedule_conflict(new.passenger_id, v_salida, new.trip_id) then
    raise exception 'Ya tienes otro viaje a menos de 90 minutos de esa hora';
  end if;
  return new;
end $$;
