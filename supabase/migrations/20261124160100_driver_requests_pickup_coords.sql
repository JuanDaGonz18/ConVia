-- =====================================================================
-- ConVía — el conductor ve en el mapa dónde pide recogida el pasajero
--
-- driver_trip_requests() suma las coordenadas de recogida y bajada y las de
-- su propio viaje. Misma regla de privacidad que la dirección: exactas solo
-- cuando la solicitud está aceptada o abordada; mientras está pendiente van
-- redondeadas a ~400 m (private.fuzz), igual que en la búsqueda.
-- =====================================================================

drop function if exists public.driver_trip_requests();
create function public.driver_trip_requests()
returns table (
  id                uuid,
  trip_id           uuid,
  passenger_id      uuid,
  direccion         text,
  recogida_nombre   text,
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
  dropoff_km        double precision,
  pickup_lat        double precision,
  pickup_lng        double precision,
  dropoff_lat       double precision,
  dropoff_lng       double precision,
  trip_origen_lat   double precision,
  trip_origen_lng   double precision,
  trip_destino_lat  double precision,
  trip_destino_lng  double precision
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.trip_id, r.passenger_id,
         case when r.estado in ('aceptado', 'abordado') then r.direccion else private.public_label(r.direccion) end,
         case when r.estado in ('aceptado', 'abordado') then r.recogida_nombre else private.public_label(r.recogida_nombre) end,
         case when r.estado in ('aceptado', 'abordado') then r.destino_nombre else private.public_label(r.destino_nombre) end,
         r.estado, r.qr_token, r.created_at, r.responded_at,
         p.nombre, private.is_plus(r.passenger_id),
         t.origen_nombre, t.destino_nombre, t.salida_at,
         (m.v ->> 'score')::integer, m.v ->> 'level',
         (m.v ->> 'pickup_km')::double precision, (m.v ->> 'dropoff_km')::double precision,
         case when r.estado in ('aceptado', 'abordado') then r.lat else private.fuzz(r.lat) end,
         case when r.estado in ('aceptado', 'abordado') then r.lng else private.fuzz(r.lng) end,
         case when r.estado in ('aceptado', 'abordado') then r.destino_lat else private.fuzz(r.destino_lat) end,
         case when r.estado in ('aceptado', 'abordado') then r.destino_lng else private.fuzz(r.destino_lng) end,
         t.origen_lat, t.origen_lng, t.destino_lat, t.destino_lng
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
