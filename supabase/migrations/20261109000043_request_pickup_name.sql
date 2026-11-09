-- =====================================================================
-- ConVía — nombre del lugar de recogida en la solicitud
--
-- El pasajero elige la recogida en el buscador (p. ej. "Portal Norte"), pero
-- solo se guardaba la dirección. Ahora la solicitud guarda también el nombre
-- (recogida_nombre, opcional) y las listas de solicitudes lo devuelven; la app
-- lo muestra y usa la dirección cuando no hay nombre. Para el conductor, el
-- nombre sigue la misma regla de privacidad que la dirección: exacto solo de
-- pasajeros aceptados, sin número de casa en los demás.
-- =====================================================================

alter table public.trip_requests
  add column if not exists recogida_nombre text check (recogida_nombre is null or char_length(recogida_nombre) <= 200);

-- La app inserta solo estas columnas (migración 030), ahora con el nombre.
grant insert (trip_id, passenger_id, direccion, recogida_nombre, lat, lng, hora_aprox,
              destino_nombre, destino_lat, destino_lng)
  on public.trip_requests to authenticated;

-- Solicitudes del pasajero (igual que en la migración 022, más recogida_nombre).
drop function if exists public.my_trip_requests();
create function public.my_trip_requests()
returns table (
  id               uuid,
  trip_id          uuid,
  direccion        text,
  recogida_nombre  text,
  destino_nombre   text,
  estado           public.request_status,
  qr_token         uuid,
  created_at       timestamptz,
  responded_at     timestamptz,
  origen_viaje     text,
  destino_viaje    text,
  salida_at        timestamptz,
  last_changes     text[],
  last_change_at   timestamptz
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.trip_id, r.direccion, r.recogida_nombre, r.destino_nombre, r.estado, r.qr_token, r.created_at, r.responded_at,
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

-- Solicitudes para el conductor (igual que en la migración 022, más recogida_nombre).
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
  dropoff_km        double precision
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
