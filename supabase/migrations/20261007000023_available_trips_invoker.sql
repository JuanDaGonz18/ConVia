-- =====================================================================
-- ConVía — available_trips sin vista SECURITY DEFINER
--  La vista de la migración 22 corría con permisos del dueño para devolver
--  datos reducidos (dirección sin número de casa, coordenadas aproximadas,
--  ruta recortada, placa enmascarada) filtrando la organización en su WHERE.
--  Mismo resultado, patrón recomendado por Supabase: la vista vuelve a correr
--  con permisos del usuario y los datos los entrega una función del servidor
--  que aplica los mismos filtros. La app no cambia (sigue leyendo la vista).
-- =====================================================================

create or replace function private.available_trip_rows()
returns table (
  id uuid, driver_id uuid, vehicle_id uuid, institution_id uuid,
  origen_nombre text, origen_lat double precision, origen_lng double precision,
  destino_nombre text, destino_lat double precision, destino_lng double precision,
  sector text, salida_at timestamptz, precio numeric(10,2), cupos_totales smallint, descripcion text,
  estado public.trip_status, started_at timestamptz, finished_at timestamptz, created_at timestamptz, updated_at timestamptz,
  cupos_disponibles integer, driver_nombre text, driver_avatar_url text, driver_rating numeric(3,2),
  vehicle_marca text, vehicle_color text, vehicle_placa text, vehicle_foto_url text, ruta jsonb, driver_is_plus boolean
)
language sql stable security definer set search_path = '' as $$
  select t.id, t.driver_id, t.vehicle_id, t.institution_id,
         private.public_label(t.origen_nombre), private.fuzz(t.origen_lat), private.fuzz(t.origen_lng),
         private.public_label(t.destino_nombre), private.fuzz(t.destino_lat), private.fuzz(t.destino_lng),
         t.sector, t.salida_at, t.precio, t.cupos_totales, t.descripcion,
         t.estado, t.started_at, t.finished_at, t.created_at, t.updated_at,
         t.cupos_totales - private.seats_taken(t.id), p.nombre, p.avatar_url, p.rating_driver_avg,
         v.marca, v.color, private.mask_plate(v.placa), v.foto_url, private.public_route(t.ruta), private.is_plus(t.driver_id)
    from public.trips t
    join public.profiles p on p.id = t.driver_id
    join public.vehicles v on v.id = t.vehicle_id
   where t.estado = 'por_empezar'::public.trip_status
     and t.salida_at > (now() - '00:15:00'::interval)
     and t.institution_id = (select private.current_institution_id())
$$;

revoke execute on function private.available_trip_rows() from public, anon;
grant execute on function private.available_trip_rows() to authenticated;

-- Mismas columnas y tipos que la vista anterior (las funciones pierden la precisión de numeric).
create or replace view public.available_trips with (security_invoker = true) as
  select id, driver_id, vehicle_id, institution_id,
         origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng,
         sector, salida_at, precio::numeric(10,2) as precio, cupos_totales, descripcion,
         estado, started_at, finished_at, created_at, updated_at,
         cupos_disponibles, driver_nombre, driver_avatar_url, driver_rating::numeric(3,2) as driver_rating,
         vehicle_marca, vehicle_color, vehicle_placa, vehicle_foto_url, ruta, driver_is_plus
    from private.available_trip_rows();

revoke all on public.available_trips from anon, authenticated;
grant select on public.available_trips to authenticated;
