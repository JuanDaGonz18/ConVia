-- =====================================================================
-- ConVía — EXPLAIN (ANALYZE, BUFFERS) de las rutas calientes (stack local
-- con scripts/perf/seed.sql). Para cada ruta:
--   * la llamada tal como la hace la app (rol authenticated, con RLS), y
--   * el cuerpo de la función SECURITY DEFINER (las funciones SQL con
--     search_path no se "inlinean", así que su EXPLAIN solo muestra
--     "Function Scan"; el cuerpo enseña qué índices usa).
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f scripts/perf/explain.sql
-- Cada sección empieza con "=== <nombre>"; el resumen del
-- "Execution Time" de cada una lo hace el paso EXPLAIN
-- de .github/workflows/perf.yml.
-- =====================================================================
\set ON_ERROR_STOP on
\pset pager off

select md5('convia-perf-user-80')::uuid  as passenger_load,   -- pasajero de carga (institución 1)
       md5('convia-perf-user-200')::uuid as passenger,        -- pasajero con ~15 solicitudes
       md5('convia-perf-user-12')::uuid  as driver,           -- conductor con 12 viajes y solicitudes
       md5('convia-perf-user-0')::uuid   as driver_load       -- conductor del viaje de chat
\gset

-- Calienta la caché (la primera ejecución lee de disco).
select set_config('request.jwt.claims', json_build_object('sub', :'passenger', 'role', 'authenticated')::text, false);
select count(*) from private.available_trip_rows();

-- ---------------------------------------------------------------------
\echo '=== available_trips (búsqueda, como la app)'
select set_config('request.jwt.claims', json_build_object('sub', :'passenger', 'role', 'authenticated')::text, false);
set role authenticated;
explain (analyze, buffers, costs off)
  select * from public.available_trips where driver_id <> :'passenger'::uuid order by salida_at;
reset role;

\echo '=== available_trips por id (detalle del viaje, como la app)'
select t.id as one_trip from public.trips t
 where t.institution_id = (select institution_id from public.profiles where id = :'passenger'::uuid)
   and t.driver_id <> :'passenger'::uuid
 order by t.salida_at limit 1 \gset
set role authenticated;
explain (analyze, buffers, costs off)
  select * from public.available_trips where id in (:'one_trip'::uuid) order by salida_at;
reset role;

\echo '=== available_trip_rows (cuerpo)'
explain (analyze, buffers, costs off)
  select t.id, private.public_label(t.origen_nombre), private.fuzz(t.origen_lat),
         t.cupos_totales - private.seats_taken(t.id), p.nombre, private.mask_plate(v.placa),
         private.public_route(t.ruta), private.is_plus(t.driver_id)
    from public.trips t
    join public.profiles p on p.id = t.driver_id
    join public.vehicles v on v.id = t.vehicle_id
   where t.estado = 'por_empezar'::public.trip_status
     and t.salida_at > (now() - '00:15:00'::interval)
     and t.institution_id = (select private.current_institution_id());

\echo '=== available_trip_rows (cuerpo, solo filtro y joins)'
explain (analyze, buffers, costs off)
  select t.id
    from public.trips t
    join public.profiles p on p.id = t.driver_id
    join public.vehicles v on v.id = t.vehicle_id
   where t.estado = 'por_empezar'::public.trip_status
     and t.salida_at > (now() - '00:15:00'::interval)
     and t.institution_id = (select private.current_institution_id());

-- ---------------------------------------------------------------------
\echo '=== my_trip_requests (rpc)'
select set_config('request.jwt.claims', json_build_object('sub', :'passenger', 'role', 'authenticated')::text, false);
set role authenticated;
explain (analyze, buffers, costs off) select * from public.my_trip_requests();
reset role;

\echo '=== my_trip_requests (cuerpo)'
explain (analyze, buffers, costs off)
  select r.id, r.trip_id, r.direccion, r.estado, private.public_label(t.origen_nombre), t.salida_at, u.changes, u.created_at
    from public.trip_requests r
    join public.trips t on t.id = r.trip_id
    left join lateral (
      select tu.changes, tu.created_at from public.trip_updates tu
       where tu.trip_id = t.id and tu.kind is distinct from 'cancelled' and tu.kind is distinct from 'finished'
       order by tu.created_at desc limit 1
    ) u on r.estado in ('pendiente', 'aceptado')
   where r.passenger_id = auth.uid()
   order by r.created_at desc;

-- ---------------------------------------------------------------------
\echo '=== driver_trip_requests (rpc)'
select set_config('request.jwt.claims', json_build_object('sub', :'driver', 'role', 'authenticated')::text, false);
set role authenticated;
explain (analyze, buffers, costs off) select * from public.driver_trip_requests();
reset role;

\echo '=== driver_trip_requests (cuerpo)'
explain (analyze, buffers, costs off)
  select r.id, p.nombre, private.is_plus(r.passenger_id), m.v
    from public.trip_requests r
    join public.trips t on t.id = r.trip_id
    join public.profiles p on p.id = r.passenger_id
    cross join lateral (select private.request_match(t, r.lat, r.lng, r.destino_lat, r.destino_lng) as v) m
   where t.driver_id = auth.uid()
     and t.estado in ('por_empezar', 'en_curso')
   order by t.salida_at, private.level_rank(m.v ->> 'level') desc, private.is_plus(r.passenger_id) desc,
            (m.v ->> 'score')::integer desc, r.created_at desc;

-- ---------------------------------------------------------------------
\echo '=== my_chat_trips (rpc, pasajero)'
select set_config('request.jwt.claims', json_build_object('sub', :'passenger', 'role', 'authenticated')::text, false);
set role authenticated;
explain (analyze, buffers, costs off) select * from public.my_chat_trips();
reset role;

\echo '=== my_chat_trips (cuerpo, pasajero)'
explain (analyze, buffers, costs off)
  select t.id, p.nombre
    from public.trips t
    join public.profiles p on p.id = t.driver_id
   where t.estado in ('por_empezar', 'en_curso')
     and (t.driver_id = auth.uid()
          or exists (select 1 from public.trip_requests r
                      where r.trip_id = t.id and r.passenger_id = auth.uid() and r.estado in ('aceptado', 'abordado')))
   order by t.salida_at;

\echo '=== chat: lista de mensajes (como la app, con RLS, pasajero)'
select string_agg(trip_id::text, ',') as chat_trip_ids from public.my_chat_trips() \gset
set role authenticated;
explain (analyze, buffers, costs off)
  select id, trip_id, sender_id, body, created_at from public.messages
   where trip_id = any (string_to_array(:'chat_trip_ids', ',')::uuid[])
   order by created_at asc;
reset role;

\echo '=== chat: lista de mensajes (como la app, con RLS, conductor de carga)'
select set_config('request.jwt.claims', json_build_object('sub', :'driver_load', 'role', 'authenticated')::text, false);
select string_agg(trip_id::text, ',') as chat_trip_ids from public.my_chat_trips() \gset
set role authenticated;
explain (analyze, buffers, costs off)
  select id, trip_id, sender_id, body, created_at from public.messages
   where trip_id = any (string_to_array(:'chat_trip_ids', ',')::uuid[])
   order by created_at asc;
reset role;

-- ---------------------------------------------------------------------
\echo '=== get_my_plan (rpc)'
select set_config('request.jwt.claims', json_build_object('sub', :'passenger', 'role', 'authenticated')::text, false);
set role authenticated;
explain (analyze, buffers, costs off) select * from public.get_my_plan();
reset role;

-- ---------------------------------------------------------------------
\echo '=== pedir cupo: has_schedule_conflict (cuerpo)'
explain (analyze, buffers, costs off)
  select exists (
    select 1 from public.trips t
    where t.driver_id = :'passenger_load'::uuid and t.estado in ('por_empezar', 'en_curso')
      and t.salida_at between now() + interval '2 days' - interval '90 minutes' and now() + interval '2 days' + interval '90 minutes'
  ) or exists (
    select 1 from public.trip_requests r
    join public.trips t on t.id = r.trip_id
    where r.passenger_id = :'passenger_load'::uuid
      and r.estado in ('pendiente', 'aceptado', 'abordado')
      and t.estado in ('por_empezar', 'en_curso')
      and t.salida_at between now() + interval '2 days' - interval '90 minutes' and now() + interval '2 days' + interval '90 minutes'
  );

\echo '=== tamaño de la base'
select pg_size_pretty(pg_database_size(current_database())) as db_size;
select relname, pg_size_pretty(pg_total_relation_size(c.oid)) as total
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
 order by pg_total_relation_size(c.oid) desc limit 6;
