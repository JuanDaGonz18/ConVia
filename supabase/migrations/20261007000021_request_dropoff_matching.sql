-- =====================================================================
-- ConVía — datos para el emparejamiento de viajes
--  * trip_requests guarda dónde se quiere bajar el pasajero (opcional), para
--    que el conductor vea qué tan compatible es cada solicitud con su ruta.
--  * La app solo puede escribir las columnas propias de una solicitud nueva
--    (antes podía enviar también pago, abordaje, etc. al crearla).
--  * driver_trip_requests() devuelve además la geometría del viaje y de la
--    solicitud; la app calcula la compatibilidad (src/services/tripMatching.ts)
--    y ordena: compatibilidad primero, ConVía+ como desempate. La prioridad
--    ConVía+ al aceptar sigue aplicándose en respond_trip_request().
-- =====================================================================

alter table public.trip_requests
  add column destino_nombre text check (destino_nombre is null or char_length(destino_nombre) <= 200),
  add column destino_lat double precision check (destino_lat is null or destino_lat between -90 and 90),
  add column destino_lng double precision check (destino_lng is null or destino_lng between -180 and 180);

revoke insert on public.trip_requests from authenticated;
grant insert (trip_id, passenger_id, direccion, lat, lng, hora_aprox, destino_nombre, destino_lat, destino_lng)
  on public.trip_requests to authenticated;

drop function if exists public.driver_trip_requests();

create function public.driver_trip_requests()
returns table (
  id                uuid,
  trip_id           uuid,
  passenger_id      uuid,
  direccion         text,
  lat               double precision,
  lng               double precision,
  destino_nombre    text,
  destino_lat       double precision,
  destino_lng       double precision,
  estado            public.request_status,
  qr_token          uuid,
  created_at        timestamptz,
  responded_at      timestamptz,
  passenger_nombre  text,
  passenger_is_plus boolean,
  origen_nombre     text,
  destino_viaje     text,
  salida_at         timestamptz,
  trip_origen_lat   double precision,
  trip_origen_lng   double precision,
  trip_destino_lat  double precision,
  trip_destino_lng  double precision,
  trip_ruta         jsonb
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.trip_id, r.passenger_id, r.direccion, r.lat, r.lng,
         r.destino_nombre, r.destino_lat, r.destino_lng,
         r.estado, r.qr_token, r.created_at, r.responded_at,
         p.nombre, private.is_plus(r.passenger_id),
         t.origen_nombre, t.destino_nombre, t.salida_at,
         t.origen_lat, t.origen_lng, t.destino_lat, t.destino_lng, t.ruta
    from public.trip_requests r
    join public.trips t on t.id = r.trip_id
    join public.profiles p on p.id = r.passenger_id
   where t.driver_id = auth.uid()
     and t.estado in ('por_empezar', 'en_curso')
   order by t.salida_at, r.created_at desc
$$;

revoke execute on function public.driver_trip_requests() from public, anon;
grant execute on function public.driver_trip_requests() to authenticated;
