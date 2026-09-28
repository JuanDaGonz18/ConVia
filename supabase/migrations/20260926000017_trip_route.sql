-- =====================================================================
-- WheelsApp — ruta elegida por el conductor
--  El conductor escoge la ruta al publicar (entre alternativas o agregando
--  paradas intermedias). Se guarda en trips.ruta y es la que ven los
--  pasajeros:
--    { "coords": [[lng, lat], ...],   -- 2 a 400 puntos (simplificada)
--      "km": 23.8, "minutes": 32,
--      "via": [{ "label": "Unicentro", "lat": 4.70, "lng": -74.04 }] }  -- 0 a 3 paradas
-- =====================================================================

create or replace function private.is_valid_route(p_route jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select p_route is null or (
    jsonb_typeof(p_route) = 'object'
    and jsonb_typeof(p_route -> 'coords') = 'array'
    and jsonb_array_length(p_route -> 'coords') between 2 and 400
    and jsonb_typeof(p_route -> 'km') = 'number'
    and (p_route ->> 'km')::numeric between 0 and 2000
    and jsonb_typeof(p_route -> 'minutes') = 'number'
    and (p_route ->> 'minutes')::numeric between 0 and 2880
    and coalesce(jsonb_typeof(p_route -> 'via'), 'array') = 'array'
    and coalesce(jsonb_array_length(p_route -> 'via'), 0) <= 3
    and not exists (
      select 1 from jsonb_array_elements(p_route -> 'coords') as point
      where jsonb_typeof(point) <> 'array' or jsonb_array_length(point) <> 2
         or jsonb_typeof(point -> 0) <> 'number' or jsonb_typeof(point -> 1) <> 'number'
    )
  )
$$;

alter table public.trips add column ruta jsonb check (private.is_valid_route(ruta));

-- La vista solo gana la columna al final (create or replace no permite reordenar).
create or replace view public.available_trips with (security_invoker = true) as
select
  t.id, t.driver_id, t.vehicle_id, t.institution_id,
  t.origen_nombre, t.origen_lat, t.origen_lng,
  t.destino_nombre, t.destino_lat, t.destino_lng,
  t.sector, t.salida_at, t.precio, t.cupos_totales, t.descripcion, t.estado,
  t.started_at, t.finished_at, t.created_at, t.updated_at,
  t.cupos_totales - private.seats_taken(t.id) as cupos_disponibles,
  p.nombre as driver_nombre,
  p.avatar_url as driver_avatar_url,
  p.rating_driver_avg as driver_rating,
  v.marca as vehicle_marca,
  v.color as vehicle_color,
  v.placa as vehicle_placa,
  v.foto_url as vehicle_foto_url,
  t.ruta
from public.trips t
join public.profiles p on p.id = t.driver_id
join public.vehicles v on v.id = t.vehicle_id
where t.estado = 'por_empezar'
  and t.salida_at > now() - interval '15 minutes';

-- ---------------------------------------------------------------------
-- update_trip() también recibe la ruta
-- ---------------------------------------------------------------------
drop function if exists public.update_trip(uuid, uuid, text, double precision, double precision, text, double precision, double precision, timestamptz, numeric, smallint, text);

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
    v_changes := v_changes || ('Salida: ' || t.origen_nombre || ' → ' || p_origen_nombre);
  end if;
  if t.destino_nombre is distinct from p_destino_nombre or t.destino_lat is distinct from p_destino_lat or t.destino_lng is distinct from p_destino_lng then
    v_changes := v_changes || ('Destino: ' || t.destino_nombre || ' → ' || p_destino_nombre);
  end if;
  if t.ruta -> 'coords' is distinct from p_ruta -> 'coords' then
    select string_agg(stop ->> 'label', ', ') into v_via from jsonb_array_elements(coalesce(p_ruta -> 'via', '[]'::jsonb)) as stop;
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
    select placa into v_old_plate from public.vehicles where id = t.vehicle_id;
    v_changes := v_changes || ('Vehículo: ' || coalesce(v_old_plate, 'anterior') || ' → ' || v_new_plate);
  end if;
  if t.descripcion is distinct from v_description then
    v_changes := v_changes || 'Descripción actualizada'::text;
  end if;

  if coalesce(array_length(v_changes, 1), 0) = 0 then
    return jsonb_build_object('changes', '[]'::jsonb, 'update_id', null, 'accepted', v_taken);
  end if;

  -- trips_before_update_schedule_trg revisa choques de horario al cambiar la salida.
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

revoke execute on function public.update_trip(uuid, uuid, text, double precision, double precision, text, double precision, double precision, timestamptz, numeric, smallint, text, jsonb) from public, anon;
grant execute on function public.update_trip(uuid, uuid, text, double precision, double precision, text, double precision, double precision, timestamptz, numeric, smallint, text, jsonb) to authenticated, service_role;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
