-- =====================================================================
-- ConVía — auditoría de privacidad y prioridad por compatibilidad
--
--  A. Privacidad: la base de datos deja de devolver datos personales que no
--     se necesitan. Antes de ser aceptado, nadie recibe direcciones exactas,
--     coordenadas exactas, placas completas, correos ni teléfonos ajenos.
--       * profiles: email, teléfono, token de notificaciones y ruta de la
--         referencia facial ya no se pueden leer; el propio usuario los
--         obtiene con get_my_profile().
--       * trips / vehicles: solo el dueño los lee directamente. Los demás
--         usan available_trips y trip_members, que devuelven versiones
--         reducidas (dirección sin número de casa, coordenadas aproximadas,
--         ruta sin los primeros/últimos 500 m, placa enmascarada).
--       * trip_requests: dirección y coordenadas de recogida/bajada ya no se
--         pueden leer directamente (tampoco por realtime). El pasajero las ve
--         con my_trip_requests(); el conductor solo exactas cuando aceptó y el
--         viaje está activo.
--       * ratings y trip_updates: solo los involucrados.
--  B. Compatibilidad en el servidor (misma fórmula y umbrales que
--     src/services/tripMatching.ts → MATCHING_CONFIG; un test verifica que
--     coincidan). driver_trip_requests() devuelve las solicitudes ya ordenadas
--     y respond_trip_request() aplica la prioridad ConVía+ solo entre
--     solicitudes igual o más compatibles.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Utilidades de privacidad y geometría
-- ---------------------------------------------------------------------

-- "Calle 153 # 55-40, Colina" → "Calle 153, Colina" (sin número de casa).
create or replace function private.public_label(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(trim(regexp_replace(
           regexp_replace(coalesce(p, ''), '\s*(#|n[o°º]\.?)\s*\d+\s*[a-z]?(\s*-\s*\d+\s*[a-z]?)?', '', 'gi'),
           '\s+,', ',', 'g')), '')
$$;

-- Coordenada aproximada: rejilla de ~450 m (no revela una casa).
create or replace function private.fuzz(p double precision)
returns double precision language sql immutable set search_path = '' as $$
  select round(p / 0.004) * 0.004
$$;

-- "ABC123" → "A••••3".
create or replace function private.mask_plate(p text)
returns text language sql immutable set search_path = '' as $$
  select case when p is null then null
              else left(p, 1) || repeat('•', greatest(char_length(p) - 2, 1)) || right(p, 1) end
$$;

create or replace function private.km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable set search_path = '' as $$
  select 6371 * 2 * asin(least(1, sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2)))
$$;

-- Ruta para quien no es el conductor: sin los 500 m del inicio y del final
-- (no revela de qué casa sale ni a cuál llega) y paradas sin número de casa.
create or replace function private.public_route(p_route jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_coords jsonb := p_route -> 'coords';
  v_kept jsonb := '[]'::jsonb;
  v_n integer;
  v_first_lat double precision; v_first_lng double precision;
  v_last_lat double precision; v_last_lng double precision;
  v_lat double precision; v_lng double precision;
begin
  if p_route is null or jsonb_typeof(v_coords) <> 'array' or jsonb_array_length(v_coords) < 2 then return null; end if;
  v_n := jsonb_array_length(v_coords);
  v_first_lng := (v_coords -> 0 ->> 0)::double precision; v_first_lat := (v_coords -> 0 ->> 1)::double precision;
  v_last_lng := (v_coords -> (v_n - 1) ->> 0)::double precision; v_last_lat := (v_coords -> (v_n - 1) ->> 1)::double precision;
  for i in 0 .. v_n - 1 loop
    v_lng := (v_coords -> i ->> 0)::double precision;
    v_lat := (v_coords -> i ->> 1)::double precision;
    if private.km(v_lat, v_lng, v_first_lat, v_first_lng) >= 0.5 and private.km(v_lat, v_lng, v_last_lat, v_last_lng) >= 0.5 then
      v_kept := v_kept || jsonb_build_array(v_coords -> i);
    end if;
  end loop;
  if jsonb_array_length(v_kept) < 2 then return null; end if;
  return jsonb_build_object(
    'coords', v_kept,
    'km', p_route -> 'km',
    'minutes', p_route -> 'minutes',
    'via', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', private.public_label(stop ->> 'label'),
        'lat', private.fuzz((stop ->> 'lat')::double precision),
        'lng', private.fuzz((stop ->> 'lng')::double precision)))
        from jsonb_array_elements(coalesce(p_route -> 'via', '[]'::jsonb)) stop), '[]'::jsonb));
end $$;

revoke execute on function private.public_label(text), private.fuzz(double precision), private.mask_plate(text),
  private.km(double precision, double precision, double precision, double precision), private.public_route(jsonb)
  from public, anon;
grant execute on function private.public_label(text), private.fuzz(double precision), private.mask_plate(text),
  private.km(double precision, double precision, double precision, double precision), private.public_route(jsonb)
  to authenticated;

-- ---------------------------------------------------------------------
-- 1. Compatibilidad de una solicitud con la ruta del viaje
-- ---------------------------------------------------------------------

-- Umbrales. MANTENER IGUALES a MATCHING_CONFIG en src/services/tripMatching.ts
-- (src/services/tripMatching.test.ts falla si no coinciden).
create or replace function private.matching_config()
returns jsonb language sql immutable set search_path = '' as $$
  select '{
    "origin_ideal_km": 0.4,
    "origin_max_km": 4,
    "destination_ideal_km": 0.8,
    "destination_max_km": 6,
    "detour_ideal_km": 1,
    "detour_min_limit_km": 6,
    "detour_max_ratio": 0.6,
    "backtrack_tolerance_km": 0.5,
    "min_compatible_score": 45,
    "excellent_score": 80,
    "good_score": 62,
    "weight_origin": 0.25,
    "weight_destination": 0.3,
    "weight_route": 0.25,
    "weight_time": 0.15,
    "weight_other": 0.05
  }'::jsonb
$$;

create or replace function private.ramp(p_value double precision, p_ideal double precision, p_max double precision)
returns double precision language sql immutable set search_path = '' as $$
  select case when p_value <= p_ideal then 1
              when p_value >= p_max then 0
              else 1 - (p_value - p_ideal) / (p_max - p_ideal) end
$$;

-- Puntos de la ruta del viaje ([lng, lat]): la ruta elegida o una línea recta.
create or replace function private.trip_coords(t public.trips)
returns jsonb language sql stable set search_path = '' as $$
  select case
    when jsonb_typeof(t.ruta -> 'coords') = 'array' and jsonb_array_length(t.ruta -> 'coords') >= 2 then t.ruta -> 'coords'
    else jsonb_build_array(jsonb_build_array(t.origen_lng, t.origen_lat), jsonb_build_array(t.destino_lng, t.destino_lat))
  end
$$;

-- Punto de la ruta más cercano: a cuántos km queda y a cuántos km del inicio está.
create or replace function private.project_on_route(p_coords jsonb, p_lat double precision, p_lng double precision,
  out km double precision, out along_km double precision)
language plpgsql immutable set search_path = '' as $$
declare
  v_kx double precision := 111.32 * cos(radians(p_lat));
  v_ky double precision := 111.32;
  v_acc double precision := 0;
  a_lat double precision; a_lng double precision; b_lat double precision; b_lng double precision;
  v_seg double precision; ax double precision; ay double precision; dx double precision; dy double precision;
  v_len2 double precision; v_t double precision; v_d double precision;
begin
  km := 'Infinity'::double precision;
  along_km := 0;
  for i in 1 .. jsonb_array_length(p_coords) - 1 loop
    a_lng := (p_coords -> (i - 1) ->> 0)::double precision; a_lat := (p_coords -> (i - 1) ->> 1)::double precision;
    b_lng := (p_coords -> i ->> 0)::double precision; b_lat := (p_coords -> i ->> 1)::double precision;
    v_seg := private.km(a_lat, a_lng, b_lat, b_lng);
    ax := (a_lng - p_lng) * v_kx; ay := (a_lat - p_lat) * v_ky;
    dx := (b_lng - a_lng) * v_kx; dy := (b_lat - a_lat) * v_ky;
    v_len2 := dx * dx + dy * dy;
    v_t := case when v_len2 = 0 then 0 else greatest(0, least(1, -(ax * dx + ay * dy) / v_len2)) end;
    v_d := sqrt((ax + v_t * dx) ^ 2 + (ay + v_t * dy) ^ 2);
    if v_d < km then
      km := v_d;
      along_km := v_acc + v_t * v_seg;
    end if;
    v_acc := v_acc + v_seg;
  end loop;
end $$;

-- Igual que matchRequest() de la app: recogida y bajada cerca de la ruta, en el
-- sentido del viaje y con poco desvío. El horario es el del viaje (cuenta 1).
create or replace function private.request_match(t public.trips, p_lat double precision, p_lng double precision,
  p_dlat double precision, p_dlng double precision)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  c jsonb := private.matching_config();
  v_coords jsonb;
  v_dlat double precision := coalesce(p_dlat, t.destino_lat);
  v_dlng double precision := coalesce(p_dlng, t.destino_lng);
  v_pick record; v_drop record;
  v_ride double precision; v_journey double precision; v_detour double precision; v_limit double precision;
  v_coverage double precision; v_route double precision; v_score integer; v_level text;
begin
  if p_lat is null or p_lng is null or t.origen_lat is null or t.destino_lat is null or v_dlat is null then
    -- Sin coordenadas no se puede juzgar: queda en el medio.
    return jsonb_build_object('score', (c ->> 'min_compatible_score')::integer, 'level', 'fair', 'pickup_km', null, 'dropoff_km', null);
  end if;
  v_coords := private.trip_coords(t);
  select * into v_drop from private.project_on_route(v_coords, v_dlat, v_dlng);
  select * into v_pick from private.project_on_route(v_coords, p_lat, p_lng);

  if v_drop.km > (c ->> 'destination_max_km')::double precision then
    return jsonb_build_object('score', 0, 'level', 'low', 'excluded', 'destination', 'pickup_km', round(v_pick.km::numeric, 1), 'dropoff_km', round(v_drop.km::numeric, 1));
  end if;
  if v_pick.km > (c ->> 'origin_max_km')::double precision then
    return jsonb_build_object('score', 0, 'level', 'low', 'excluded', 'origin', 'pickup_km', round(v_pick.km::numeric, 1), 'dropoff_km', round(v_drop.km::numeric, 1));
  end if;
  if v_drop.along_km < v_pick.along_km - (c ->> 'backtrack_tolerance_km')::double precision then
    return jsonb_build_object('score', 0, 'level', 'low', 'excluded', 'direction', 'pickup_km', round(v_pick.km::numeric, 1), 'dropoff_km', round(v_drop.km::numeric, 1));
  end if;

  v_ride := greatest(0, v_drop.along_km - v_pick.along_km);
  v_journey := private.km(p_lat, p_lng, v_dlat, v_dlng);
  v_detour := v_pick.km + v_drop.km;
  v_limit := greatest((c ->> 'detour_min_limit_km')::double precision, (c ->> 'detour_max_ratio')::double precision * v_journey);
  if v_detour > v_limit then
    return jsonb_build_object('score', 0, 'level', 'low', 'excluded', 'detour', 'pickup_km', round(v_pick.km::numeric, 1), 'dropoff_km', round(v_drop.km::numeric, 1));
  end if;

  v_coverage := case when v_journey < 0.3 then 1 else least(1, v_ride / v_journey) end;
  v_route := 0.6 * v_coverage + 0.4 * private.ramp(v_detour, (c ->> 'detour_ideal_km')::double precision, v_limit);
  v_score := round(100 * (
      (c ->> 'weight_origin')::double precision * private.ramp(v_pick.km, (c ->> 'origin_ideal_km')::double precision, (c ->> 'origin_max_km')::double precision)
    + (c ->> 'weight_destination')::double precision * private.ramp(v_drop.km, (c ->> 'destination_ideal_km')::double precision, (c ->> 'destination_max_km')::double precision)
    + (c ->> 'weight_route')::double precision * v_route
    + (c ->> 'weight_time')::double precision * 1
    + (c ->> 'weight_other')::double precision * 0.5));
  v_level := case
    when v_score >= (c ->> 'excellent_score')::integer then 'excellent'
    when v_score >= (c ->> 'good_score')::integer then 'good'
    when v_score >= (c ->> 'min_compatible_score')::integer then 'fair'
    else 'low' end;
  return jsonb_build_object('score', v_score, 'level', v_level, 'pickup_km', round(v_pick.km::numeric, 1), 'dropoff_km', round(v_drop.km::numeric, 1));
end $$;

create or replace function private.level_rank(p_level text)
returns integer language sql immutable set search_path = '' as $$
  select case p_level when 'excellent' then 3 when 'good' then 2 when 'fair' then 1 else 0 end
$$;

revoke execute on function private.matching_config(), private.ramp(double precision, double precision, double precision),
  private.trip_coords(public.trips), private.project_on_route(jsonb, double precision, double precision),
  private.request_match(public.trips, double precision, double precision, double precision, double precision),
  private.level_rank(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. profiles: sin correo, teléfono ni tokens ajenos
-- ---------------------------------------------------------------------
drop function if exists public.is_plus(public.profiles);

revoke select on public.profiles from anon, authenticated;
grant select (id, nombre, institution_id, rol, avatar_url, verification_status, created_at,
              rating_avg, rating_count, rating_driver_avg, rating_driver_count,
              rating_passenger_avg, rating_passenger_count)
  on public.profiles to authenticated;

-- Los datos privados del propio usuario.
create or replace function public.get_my_profile()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'nombre', p.nombre, 'email', p.email, 'rol', p.rol, 'avatar_url', p.avatar_url,
    'telefono', p.telefono, 'verification_status', p.verification_status, 'verified_at', p.verified_at,
    'notifications_enabled', p.notifications_enabled,
    'driver_status', (select d.status from public.driver_profiles d where d.user_id = p.id))
    from public.profiles p
   where p.id = auth.uid()
$$;

revoke execute on function public.get_my_profile() from public, anon;
grant execute on function public.get_my_profile() to authenticated;

-- ---------------------------------------------------------------------
-- 3. trips y vehicles: lectura directa solo del dueño
-- ---------------------------------------------------------------------
drop policy if exists "trips_read" on public.trips;
create policy "trips_read_own" on public.trips for select to authenticated
  using (driver_id = (select auth.uid()));

drop policy if exists "vehicles_read" on public.vehicles;
create policy "vehicles_read_own" on public.vehicles for select to authenticated
  using (driver_id = (select auth.uid()));

-- Pedir cupo: el viaje debe estar abierto y ser de la misma organización
-- (función del servidor, porque el pasajero ya no lee el viaje directamente).
create or replace function private.trip_accepts_requests(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trips t
                  where t.id = p_trip_id and t.estado = 'por_empezar'
                    and t.driver_id <> (select auth.uid())
                    and t.institution_id = (select private.current_institution_id()))
$$;
revoke execute on function private.trip_accepts_requests(uuid) from public, anon;
grant execute on function private.trip_accepts_requests(uuid) to authenticated;

drop policy if exists "requests_insert_passenger" on public.trip_requests;
create policy "requests_insert_passenger" on public.trip_requests for insert to authenticated
  with check (
    passenger_id = (select auth.uid())
    and estado = 'pendiente'
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.verification_status = 'verificado')
    and private.trip_accepts_requests(trip_id)
  );

-- Viajes disponibles de la organización, con datos reducidos. La vista corre
-- con permisos del dueño (no del usuario), así que filtra la organización aquí.
create or replace view public.available_trips with (security_invoker = false) as
 select t.id,
    t.driver_id,
    t.vehicle_id,
    t.institution_id,
    private.public_label(t.origen_nombre) as origen_nombre,
    private.fuzz(t.origen_lat) as origen_lat,
    private.fuzz(t.origen_lng) as origen_lng,
    private.public_label(t.destino_nombre) as destino_nombre,
    private.fuzz(t.destino_lat) as destino_lat,
    private.fuzz(t.destino_lng) as destino_lng,
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
    private.mask_plate(v.placa) as vehicle_placa,
    v.foto_url as vehicle_foto_url,
    private.public_route(t.ruta) as ruta,
    private.is_plus(t.driver_id) as driver_is_plus
   from public.trips t
     join public.profiles p on p.id = t.driver_id
     join public.vehicles v on v.id = t.vehicle_id
  where t.estado = 'por_empezar'::public.trip_status
    and t.salida_at > (now() - '00:15:00'::interval)
    and t.institution_id = (select private.current_institution_id());

revoke all on public.available_trips from anon, authenticated;
grant select on public.available_trips to authenticated;

-- ---------------------------------------------------------------------
-- 4. trip_requests: ubicaciones solo por funciones del servidor
-- ---------------------------------------------------------------------
revoke select on public.trip_requests from anon, authenticated;
grant select (id, trip_id, passenger_id, hora_aprox, estado, qr_token, responded_at, boarded_at,
              created_at, updated_at, pago, pago_marcado_at)
  on public.trip_requests to authenticated;

-- Solicitudes del pasajero, con su propia dirección y el último cambio del viaje.
create or replace function public.my_trip_requests()
returns table (
  id              uuid,
  trip_id         uuid,
  direccion       text,
  destino_nombre  text,
  estado          public.request_status,
  qr_token        uuid,
  created_at      timestamptz,
  responded_at    timestamptz,
  origen_viaje    text,
  destino_viaje   text,
  salida_at       timestamptz,
  last_changes    text[],
  last_change_at  timestamptz
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.trip_id, r.direccion, r.destino_nombre, r.estado, r.qr_token, r.created_at, r.responded_at,
         private.public_label(t.origen_nombre), private.public_label(t.destino_nombre), t.salida_at,
         u.changes, u.created_at
    from public.trip_requests r
    join public.trips t on t.id = r.trip_id
    left join lateral (
      select tu.changes, tu.created_at from public.trip_updates tu
       where tu.trip_id = t.id and tu.kind is distinct from 'cancelled' and tu.kind is distinct from 'finished'
       order by tu.created_at desc limit 1
    ) u on r.estado in ('pendiente', 'aceptado')
   where r.passenger_id = auth.uid()
   order by r.created_at desc
$$;

revoke execute on function public.my_trip_requests() from public, anon;
grant execute on function public.my_trip_requests() to authenticated;

-- Solicitudes para el conductor, ya ordenadas: compatibilidad, luego ConVía+,
-- luego puntaje y la más reciente. Recogida/bajada exactas solo de pasajeros
-- aceptados (los viajes de esta lista siempre están activos).
drop function if exists public.driver_trip_requests();
create function public.driver_trip_requests()
returns table (
  id                uuid,
  trip_id           uuid,
  passenger_id      uuid,
  direccion         text,
  destino_nombre    text,
  estado            public.request_status,
  qr_token          uuid,
  created_at        timestamptz,
  responded_at      timestamptz,
  passenger_nombre  text,
  passenger_is_plus boolean,
  origen_nombre     text,
  destino_viaje     text,
  salida_at         timestamptz,
  match_score       integer,
  match_level       text,
  pickup_km         double precision,
  dropoff_km        double precision
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.trip_id, r.passenger_id,
         case when r.estado in ('aceptado', 'abordado') then r.direccion else private.public_label(r.direccion) end,
         case when r.estado in ('aceptado', 'abordado') then r.destino_nombre else private.public_label(r.destino_nombre) end,
         r.estado, r.qr_token, r.created_at, r.responded_at,
         p.nombre, private.is_plus(r.passenger_id),
         t.origen_nombre, t.destino_nombre, t.salida_at,
         (m.v ->> 'score')::integer, m.v ->> 'level',
         (m.v ->> 'pickup_km')::double precision, (m.v ->> 'dropoff_km')::double precision
    from public.trip_requests r
    join public.trips t on t.id = r.trip_id
    join public.profiles p on p.id = r.passenger_id
    cross join lateral (select private.request_match(t, r.lat, r.lng, r.destino_lat, r.destino_lng) as v) m
   where t.driver_id = auth.uid()
     and t.estado in ('por_empezar', 'en_curso')
   order by t.salida_at,
            private.level_rank(m.v ->> 'level') desc,
            private.is_plus(r.passenger_id) desc,
            (m.v ->> 'score')::integer desc,
            r.created_at desc
$$;

revoke execute on function public.driver_trip_requests() from public, anon;
grant execute on function public.driver_trip_requests() to authenticated;

-- ---------------------------------------------------------------------
-- 5. Prioridad ConVía+ que respeta la compatibilidad
--    Una solicitud FREE no puede quitarle el último cupo a solicitudes
--    ConVía+ pendientes que sean compatibles (al menos "algo compatible") e
--    IGUAL O MÁS compatibles que ella. Una ConVía+ menos compatible nunca
--    bloquea a una FREE más compatible. Nadie se rechaza automáticamente.
-- ---------------------------------------------------------------------
create or replace function public.respond_trip_request(p_request_id uuid, p_accept boolean)
returns public.trip_requests language plpgsql security definer set search_path = '' as $$
declare
  r public.trip_requests;
  t public.trips;
  v_free_seats integer;
  v_rank integer;
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
    v_rank := private.level_rank(private.request_match(t, r.lat, r.lng, r.destino_lat, r.destino_lng) ->> 'level');
    select count(*) into v_plus_pending
      from public.trip_requests o
     where o.trip_id = t.id and o.id <> r.id and o.estado = 'pendiente'
       and private.is_plus(o.passenger_id)
       and private.level_rank(private.request_match(t, o.lat, o.lng, o.destino_lat, o.destino_lng) ->> 'level') >= greatest(v_rank, 1);
    if v_plus_pending > 0 and v_free_seats - 1 < v_plus_pending then
      raise exception 'Hay % solicitud(es) ConVía+ igual de compatibles con prioridad para los cupos que quedan. Respóndelas primero.', v_plus_pending;
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
-- 6. trip_members: datos reducidos para quien no es el conductor, y nada
--    exacto después del viaje
-- ---------------------------------------------------------------------
create or replace function public.trip_members(p_trip_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  t public.trips;
  v_is_driver boolean;
  v_active boolean;
  v_cancel_recipients uuid[];
  v_result jsonb;
begin
  select * into t from public.trips where id = p_trip_id;
  if not found then raise exception 'Viaje no encontrado'; end if;
  v_is_driver := t.driver_id = v_user;
  v_active := t.estado in ('por_empezar', 'en_curso');
  if not v_is_driver and not private.is_trip_participant(t.id, v_user) then
    raise exception 'Solo los integrantes del viaje pueden ver esta información';
  end if;

  if t.estado = 'cancelado' then
    select recipients into v_cancel_recipients from public.trip_updates
     where trip_id = t.id and kind = 'cancelled' order by created_at desc limit 1;
  end if;

  select jsonb_build_object(
    'viewer_is_driver', v_is_driver,
    'trip', jsonb_build_object(
      'id', t.id,
      'origen_nombre', case when v_is_driver then t.origen_nombre else private.public_label(t.origen_nombre) end,
      'origen_lat', case when v_is_driver then t.origen_lat else private.fuzz(t.origen_lat) end,
      'origen_lng', case when v_is_driver then t.origen_lng else private.fuzz(t.origen_lng) end,
      'destino_nombre', case when v_is_driver then t.destino_nombre else private.public_label(t.destino_nombre) end,
      'destino_lat', case when v_is_driver then t.destino_lat else private.fuzz(t.destino_lat) end,
      'destino_lng', case when v_is_driver then t.destino_lng else private.fuzz(t.destino_lng) end,
      'salida_at', t.salida_at, 'started_at', t.started_at, 'finished_at', t.finished_at,
      'estado', t.estado, 'precio', t.precio, 'cupos_totales', t.cupos_totales,
      'descripcion', t.descripcion,
      'ruta', case when v_is_driver then t.ruta else private.public_route(t.ruta) end,
      'vehicle', (select jsonb_build_object('marca', v.marca, 'color', v.color,
                      -- La placa completa solo mientras el pasajero la necesita para subir.
                      'placa', case when v_is_driver or v_active then v.placa else private.mask_plate(v.placa) end,
                      'foto_url', v.foto_url)
                    from public.vehicles v where v.id = t.vehicle_id)
    ),
    'driver', (select jsonb_build_object('id', p.id, 'nombre', p.nombre, 'avatar_url', p.avatar_url,
                                         'rating', p.rating_driver_avg, 'rating_count', p.rating_driver_count,
                                         'is_plus', private.is_plus(p.id))
                 from public.profiles p where p.id = t.driver_id),
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
          -- El conductor ve la recogida exacta solo mientras el viaje está activo.
          'direccion', case
            when p.id = v_user then r.direccion
            when v_is_driver and v_active then r.direccion
            when v_is_driver then private.public_label(r.direccion) end,
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

-- Historial del pasajero: nombres de lugares sin número de casa.
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
  select t.id, r.id, r.estado, t.estado, private.public_label(t.origen_nombre), private.public_label(t.destino_nombre),
         t.salida_at, t.finished_at, t.precio,
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

-- ---------------------------------------------------------------------
-- 7. Chat: lista y estado por funciones del servidor
-- ---------------------------------------------------------------------
create or replace function public.my_chat_trips()
returns table (
  trip_id            uuid,
  origen_nombre      text,
  destino_nombre     text,
  driver_id          uuid,
  driver_nombre      text,
  driver_avatar_url  text,
  viewer_is_driver   boolean
)
language sql stable security definer set search_path = '' as $$
  select t.id,
         case when t.driver_id = auth.uid() then t.origen_nombre else private.public_label(t.origen_nombre) end,
         case when t.driver_id = auth.uid() then t.destino_nombre else private.public_label(t.destino_nombre) end,
         t.driver_id, p.nombre, p.avatar_url, t.driver_id = auth.uid()
    from public.trips t
    join public.profiles p on p.id = t.driver_id
   where t.estado in ('por_empezar', 'en_curso')
     and (t.driver_id = auth.uid()
          or exists (select 1 from public.trip_requests r
                      where r.trip_id = t.id and r.passenger_id = auth.uid() and r.estado in ('aceptado', 'abordado')))
   order by t.salida_at
$$;

-- 'open' (participante, viaje activo), 'ended' (participó, viaje terminado) o 'none'.
create or replace function public.chat_trip_state(p_trip_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when not (t.driver_id = auth.uid() or exists (
           select 1 from public.trip_requests r
            where r.trip_id = t.id and r.passenger_id = auth.uid() and r.estado in ('aceptado', 'abordado', 'cancelado'))) then 'none'
    when t.estado in ('por_empezar', 'en_curso') then 'open'
    else 'ended' end
    from public.trips t where t.id = p_trip_id
$$;

revoke execute on function public.my_chat_trips(), public.chat_trip_state(uuid) from public, anon;
grant execute on function public.my_chat_trips(), public.chat_trip_state(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Calificaciones y cambios de viaje: solo los involucrados
-- ---------------------------------------------------------------------
drop policy if exists "ratings_read" on public.ratings;
create policy "ratings_read_involved" on public.ratings for select to authenticated
  using (rater_id = (select auth.uid()) or rated_id = (select auth.uid()));

-- Los pasajeros reciben los cambios por my_trip_requests() y las notificaciones.
drop policy if exists "trip_updates_participants_read" on public.trip_updates;
create policy "trip_updates_driver_read" on public.trip_updates for select to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_updates.trip_id and t.driver_id = (select auth.uid())));

-- ---------------------------------------------------------------------
-- 9. Resumen de cambios sin números de casa (llega a los pasajeros)
-- ---------------------------------------------------------------------
create or replace function public.update_trip(
  p_trip_id uuid,
  p_vehicle_id uuid,
  p_origen_nombre text,
  p_origen_lat double precision,
  p_origen_lng double precision,
  p_destino_nombre text,
  p_destino_lat double precision,
  p_destino_lng double precision,
  p_salida_at timestamptz,
  p_precio numeric,
  p_cupos_totales smallint,
  p_descripcion text,
  p_ruta jsonb default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.trips;
  v_old_plate text;
  v_new_plate text;
  v_puestos smallint;
  v_taken integer;
  v_changes text[] := '{}';
  v_update_id uuid;
  v_description text := nullif(trim(coalesce(p_descripcion, '')), '');
  v_via text;
begin
  select * into t from public.trips where id = p_trip_id for update;
  if not found or t.driver_id <> auth.uid() then raise exception 'Viaje no encontrado'; end if;
  if t.estado <> 'por_empezar' then raise exception 'Solo puedes editar viajes que aún no han empezado'; end if;
  if p_salida_at <= now() then raise exception 'La salida debe ser en el futuro'; end if;
  if p_precio is null or p_precio < 0 then raise exception 'Precio inválido'; end if;
  if char_length(trim(coalesce(p_origen_nombre, ''))) = 0 or char_length(trim(coalesce(p_destino_nombre, ''))) = 0 then
    raise exception 'Indica la salida y el destino';
  end if;
  if not private.is_valid_route(p_ruta) then raise exception 'Ruta inválida'; end if;

  select puestos, placa into v_puestos, v_new_plate from public.vehicles
   where id = p_vehicle_id and driver_id = auth.uid() and activo;
  if v_puestos is null then raise exception 'Elige uno de tus vehículos'; end if;
  if p_cupos_totales is null or p_cupos_totales < 1 or p_cupos_totales > v_puestos then
    raise exception 'Los cupos deben estar entre 1 y % (los puestos del vehículo)', v_puestos;
  end if;
  v_taken := private.seats_taken(t.id);
  if p_cupos_totales < v_taken then
    raise exception 'Ya aceptaste % pasajeros; no puedes ofrecer menos cupos', v_taken;
  end if;

  -- Resumen legible de lo que cambió (se usa en la notificación).
  if t.origen_nombre is distinct from p_origen_nombre or t.origen_lat is distinct from p_origen_lat or t.origen_lng is distinct from p_origen_lng then
    v_changes := v_changes || ('Salida: ' || coalesce(private.public_label(t.origen_nombre), 'anterior') || ' → ' || coalesce(private.public_label(p_origen_nombre), 'nueva'));
  end if;
  if t.destino_nombre is distinct from p_destino_nombre or t.destino_lat is distinct from p_destino_lat or t.destino_lng is distinct from p_destino_lng then
    v_changes := v_changes || ('Destino: ' || coalesce(private.public_label(t.destino_nombre), 'anterior') || ' → ' || coalesce(private.public_label(p_destino_nombre), 'nuevo'));
  end if;
  if t.ruta -> 'coords' is distinct from p_ruta -> 'coords' then
    select string_agg(private.public_label(stop ->> 'label'), ', ') into v_via from jsonb_array_elements(coalesce(p_ruta -> 'via', '[]'::jsonb)) as stop;
    v_changes := v_changes || (case
      when v_via is not null then 'Ruta: ahora pasa por ' || v_via
      when p_ruta is not null then 'Ruta: ' || replace(round((p_ruta ->> 'km')::numeric, 1)::text, '.', ',') || ' km, unos ' || (p_ruta ->> 'minutes') || ' min'
      else 'Ruta actualizada'
    end);
  end if;
  if t.salida_at is distinct from p_salida_at then
    v_changes := v_changes || ('Hora de salida: ' || private.format_departure(t.salida_at) || ' → ' || private.format_departure(p_salida_at));
  end if;
  if t.precio is distinct from p_precio then
    v_changes := v_changes || ('Precio: ' || private.format_cop(t.precio) || ' → ' || private.format_cop(p_precio));
  end if;
  if t.cupos_totales is distinct from p_cupos_totales then
    v_changes := v_changes || ('Cupos: ' || t.cupos_totales || ' → ' || p_cupos_totales);
  end if;
  if t.vehicle_id is distinct from p_vehicle_id then
    -- Lo reciben pasajeros ya aceptados, que necesitan reconocer el vehículo.
    select placa into v_old_plate from public.vehicles where id = t.vehicle_id;
    v_changes := v_changes || ('Vehículo: ' || coalesce(v_old_plate, 'anterior') || ' → ' || v_new_plate);
  end if;
  if t.descripcion is distinct from v_description then
    v_changes := v_changes || 'Descripción actualizada'::text;
  end if;

  if coalesce(array_length(v_changes, 1), 0) = 0 then
    return jsonb_build_object('changes', '[]'::jsonb, 'update_id', null, 'accepted', v_taken);
  end if;

  update public.trips set
    vehicle_id = p_vehicle_id,
    origen_nombre = trim(p_origen_nombre),
    origen_lat = p_origen_lat,
    origen_lng = p_origen_lng,
    destino_nombre = trim(p_destino_nombre),
    destino_lat = p_destino_lat,
    destino_lng = p_destino_lng,
    ruta = p_ruta,
    salida_at = p_salida_at,
    precio = p_precio,
    cupos_totales = p_cupos_totales,
    descripcion = v_description
  where id = t.id;

  insert into public.trip_updates (trip_id, changed_by, changes)
  values (t.id, auth.uid(), v_changes)
  returning id into v_update_id;

  return jsonb_build_object('changes', to_jsonb(v_changes), 'update_id', v_update_id, 'accepted', v_taken);
end $$;
