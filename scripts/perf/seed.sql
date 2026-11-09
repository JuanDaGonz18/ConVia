-- =====================================================================
-- ConVía — datos sintéticos para la prueba de carga (SOLO stack local)
--
--   npx supabase db reset
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f scripts/perf/seed.sql
--
-- Nunca contra producción: el bloque de abajo se niega a correr si la base
-- ya tiene usuarios que no son de example.test.
--
-- Qué crea (todo con nombres "Prueba" y correos @*.example.test):
--   5 instituciones, 2 000 usuarios (400 por institución: 80 conductores
--   aprobados con un vehículo, 320 pasajeros verificados), 5 000 viajes
--   futuros con ruta (Chía, Cota, Bogotá ↔ campus), 20 000 solicitudes,
--   30 000 mensajes de chat.
--
-- Usuarios de la prueba k6 (scripts/perf/tokens.mjs usa el mismo esquema):
--   n = 0..1999 · institución = n / 400 · local = n % 400
--   local   0..11  conductor "de carga": su viaje 13 (día +20) es el chat de la prueba
--   local  12..79  conductor
--   local  80..127 pasajero "de carga": aceptado en el viaje de chat del conductor
--                  (local-80)/4; sin otras solicitudes, así puede pedir cupo sin choques
--   local 128..399 pasajero (solicitudes sembradas)
--   id = md5('convia-perf-user-' || n)::uuid
-- =====================================================================

\set ON_ERROR_STOP on
set statement_timeout = 0;

do $$
begin
  if exists (select 1 from auth.users where email not like '%.example.test') then
    raise exception 'La base tiene usuarios reales: este seed es solo para el stack local vacío (npx supabase db reset).';
  end if;
  if exists (select 1 from auth.users where email like '%.example.test') then
    raise exception 'El seed ya se aplicó: corre npx supabase db reset primero.';
  end if;
end $$;

begin;

-- Lugares de la zona (aprox.) y campus sintéticos -----------------------
create temp table perf_places (idx int primary key, nombre text, lat float8, lng float8) on commit drop;
insert into perf_places values
  (0,  'Parque Principal de Chía', 4.8616, -74.0587),
  (1,  'C.C. Fontanar, Chía', 4.8836, -74.0378),
  (2,  'La Balsa, Chía', 4.8780, -74.0620),
  (3,  'Parque Principal de Cota', 4.8095, -74.1023),
  (4,  'Siberia, Cota', 4.7720, -74.1530),
  (5,  'Portal Norte, Bogotá', 4.7546, -74.0460),
  (6,  'Unicentro, Bogotá', 4.7024, -74.0420),
  (7,  'Usaquén, Bogotá', 4.6953, -74.0310),
  (8,  'Suba Centro, Bogotá', 4.7410, -74.0840),
  (9,  'Calle 80, Bogotá', 4.6930, -74.0880),
  (10, 'Chapinero, Bogotá', 4.6486, -74.0628),
  (11, 'Cedritos, Bogotá', 4.7230, -74.0400),
  (12, 'Colina Campestre, Bogotá', 4.7330, -74.0650),
  (13, 'Mazurén, Bogotá', 4.7300, -74.0480);

create temp table perf_campus (inst int primary key, nombre text, lat float8, lng float8) on commit drop;
insert into perf_campus values
  (0, 'Campus Prueba Uno (Chía)', 4.8614, -74.0326),
  (1, 'Campus Prueba Dos (Cota)', 4.8100, -74.0950),
  (2, 'Campus Prueba Tres (Bogotá norte)', 4.7560, -74.0440),
  (3, 'Campus Prueba Cuatro (Bogotá occidente)', 4.6380, -74.0830),
  (4, 'Campus Prueba Cinco (Bogotá centro)', 4.6280, -74.0650);

-- Instituciones (el trigger agrega el dominio a institution_domains) -----
insert into public.institutions (id, nombre, nombre_corto, tipo, dominio, ciudad, activo)
select md5('convia-perf-inst-' || i)::uuid,
       'Institución Prueba ' || (i + 1), 'Prueba ' || (i + 1),
       case when i < 4 then 'universidad' else 'empresa' end::public.community_type,
       'prueba' || (i + 1) || '.example.test',
       case i when 0 then 'Chía' when 1 then 'Cota' else 'Bogotá' end,
       true
  from generate_series(0, 4) i;

-- Usuarios: auth.users dispara handle_new_user (perfil + membresía verificada)
create temp table perf_users on commit drop as
select n, n / 400 as inst, n % 400 as local,
       md5('convia-perf-user-' || n)::uuid as id,
       'perf.' || lpad(n::text, 4, '0') || '@prueba' || (n / 400 + 1) || '.example.test' as email,
       case when n % 400 < 80 then 'Conductor' else 'Pasajero' end || ' Prueba ' || lpad(n::text, 4, '0') as nombre,
       n % 400 < 80 as is_driver
  from generate_series(0, 1999) n;
create index on perf_users (inst, local);

-- Una sola contraseña cifrada para todos (bcrypt 2 000 veces sería lento).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, pw.hash, now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('nombre', u.nombre, 'terms_accepted', true, 'terms_version', '1.2'),
       now() - interval '30 days', now(), '', '', '', ''
  from perf_users u
 cross join (select extensions.crypt('Perf-Test-2026!', extensions.gen_salt('bf', 4)) as hash) pw;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now(), now()
  from perf_users u;

do $$
begin
  if (select count(*) from public.institution_memberships m
        join perf_users u on u.id = m.user_id where m.status = 'verified') <> 2000 then
    raise exception 'handle_new_user no dejó las 2 000 membresías verificadas';
  end if;
end $$;

-- A partir de aquí, carga masiva sin triggers de validación ni avisos
-- (los datos ya cumplen las reglas: mismas instituciones, sin choques de horario).
set local session_replication_role = replica;

update public.profiles p
   set verification_status = 'verificado', verified_at = now() - interval '29 days',
       onboarding_completed = true,
       rol = case when u.is_driver then 'conductor' else 'usuario' end::public.user_role,
       rating_avg = 4 + (u.n % 10) / 10.0, rating_count = 5 + u.n % 20,
       rating_driver_avg = case when u.is_driver then 4 + (u.n % 10) / 10.0 else 0 end,
       rating_driver_count = case when u.is_driver then 5 + u.n % 20 else 0 end
  from perf_users u where u.id = p.id;

insert into public.driver_profiles (user_id, status, submitted_at, reviewed_at, identity_verified_at)
select id, 'aprobado', now() - interval '28 days', now() - interval '28 days', now() - interval '28 days'
  from perf_users where is_driver
on conflict (user_id) do update set status = 'aprobado';

insert into public.vehicles (id, driver_id, placa, marca, color, puestos, activo)
select md5('convia-perf-vehicle-' || n)::uuid, id,
       'PRF' || lpad(n::text, 4, '0'),
       (array['Renault Logan', 'Chevrolet Onix', 'Mazda 2', 'Kia Picanto', 'Toyota Corolla'])[1 + n % 5],
       (array['Gris', 'Blanco', 'Rojo', 'Negro', 'Azul'])[1 + (n / 5) % 5],
       4, true
  from perf_users where is_driver;

-- Viajes: 400 conductores × 12 (días +1..+12, mañana o tarde) + 200 extra = 5 000
create temp table perf_trips on commit drop as
with slots as (
  select u.n, u.inst, u.local, u.id as driver_id, j
    from perf_users u
   cross join generate_series(0, 12) j
   where u.is_driver and (j < 12 or u.local < 40)   -- 40 por institución tienen un viaje 13
), t as (
  select s.*,
         case when j = 12 and s.local < 12 then 20 else j + 1 end as day,  -- carga: chat el día +20
         (s.n + j) % 2 = 0 as morning,
         (s.n * 7 + j * 3) % 14 as place_idx
    from slots s
)
select md5('convia-perf-trip-' || t.n || '-' || t.j)::uuid as id, t.*,
       -- Hora de Bogotá (UTC-5): mañana 05:30–07:45, tarde 16:00–19:15
       ((now() at time zone 'America/Bogota')::date + t.day)::timestamp
         + case when t.morning then interval '5 hours 30 minutes' + ((t.n + t.j) % 10) * interval '15 minutes'
                else interval '16 hours' + ((t.n + t.j) % 14) * interval '15 minutes' end
         as salida_local
  from t;
create index on perf_trips (inst, day);

insert into public.trips (id, driver_id, vehicle_id, institution_id,
                          origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng,
                          sector, salida_at, precio, cupos_totales, descripcion, estado, ruta, created_at, updated_at)
select t.id, t.driver_id, md5('convia-perf-vehicle-' || t.n)::uuid, md5('convia-perf-inst-' || t.inst)::uuid,
       case when t.morning then p.nombre else c.nombre end,
       case when t.morning then p.lat else c.lat end, case when t.morning then p.lng else c.lng end,
       case when t.morning then c.nombre else p.nombre end,
       case when t.morning then c.lat else p.lat end, case when t.morning then c.lng else p.lng end,
       split_part(p.nombre, ', ', 2),
       t.salida_local at time zone 'America/Bogota',
       (array[4000, 5000, 6000, 7000, 8000, 10000])[1 + t.n % 6],
       4,
       case when t.n % 3 = 0 then 'Salgo puntual. Viaje de prueba sintético.' end,
       'por_empezar',
       r.ruta,
       now() - interval '2 days', now() - interval '2 days'
  from perf_trips t
  join perf_places p on p.idx = t.place_idx
  join perf_campus c on c.inst = t.inst
  cross join lateral (
    -- Ruta sintética: 80 puntos entre origen y destino con una curva suave.
    select jsonb_build_object(
             'coords', jsonb_agg(jsonb_build_array(
                round((lng0 + (lng1 - lng0) * k / 79.0 + 0.004 * sin(pi() * k / 79.0))::numeric, 6),
                round((lat0 + (lat1 - lat0) * k / 79.0 + 0.003 * sin(2 * pi() * k / 79.0))::numeric, 6)) order by k),
             'km', round((111 * sqrt(power(lat1 - lat0, 2) + power(lng1 - lng0, 2)) * 1.3)::numeric, 1),
             'minutes', round((111 * sqrt(power(lat1 - lat0, 2) + power(lng1 - lng0, 2)) * 1.3 * 2.2)::numeric),
             'via', '[]'::jsonb) as ruta
      from (select case when t.morning then p.lat else c.lat end as lat0,
                   case when t.morning then p.lng else c.lng end as lng0,
                   case when t.morning then c.lat else p.lat end as lat1,
                   case when t.morning then c.lng else p.lng end as lng1) e
     cross join generate_series(0, 79) k
     group by lat0, lng0, lat1, lng1
  ) r;

-- Solicitudes: 4 por viaje normal (19 760) + 240 pasajeros de carga aceptados = 20 000
create temp table perf_regular_trips on commit drop as
select row_number() over (partition by inst order by id) - 1 as k, t.*
  from perf_trips t where not (t.day = 20);

insert into public.trip_requests (trip_id, passenger_id, direccion, recogida_nombre, lat, lng,
                                  destino_nombre, destino_lat, destino_lng,
                                  estado, responded_at, created_at, updated_at)
select t.id, pu.id,
       'Calle ' || (100 + (t.k + q) % 90) || ' # ' || (5 + q * 3) || '-' || (10 + t.k % 80) || ', ' || split_part(p.nombre, ', ', 2),
       p.nombre,
       p.lat + ((t.k * 13 + q * 7) % 21 - 10) * 0.0004, p.lng + ((t.k * 11 + q * 5) % 21 - 10) * 0.0004,
       case when t.morning then c.nombre else p.nombre end,
       case when t.morning then c.lat else p.lat end, case when t.morning then c.lng else p.lng end,
       (case
          when q = 0 then 'aceptado'
          when q = 1 then case when t.k % 3 < 2 then 'aceptado' else 'pendiente' end
          when q = 2 then 'pendiente'
          else (array['pendiente', 'negado', 'cancelado'])[1 + t.k % 3]
        end)::public.request_status,
       case when q < 2 or (q = 3 and t.k % 3 > 0) then now() - interval '1 day' end,
       now() - interval '1 day' - q * interval '1 hour', now() - interval '1 day'
  from perf_regular_trips t
 cross join generate_series(0, 3) q
  join perf_places p on p.idx = (t.place_idx + q) % 14
  join perf_campus c on c.inst = t.inst
  join perf_users pu on pu.inst = t.inst and pu.local = 128 + (t.k * 7 + q * 61) % 272;

insert into public.trip_requests (trip_id, passenger_id, direccion, recogida_nombre, lat, lng,
                                  estado, responded_at, created_at, updated_at)
select t.id, pu.id, 'Carrera 7 # ' || (100 + pu.local) || '-20, Chía', 'Parque Principal de Chía',
       4.8616, -74.0587, 'aceptado', now() - interval '1 day', now() - interval '2 days', now() - interval '1 day'
  from perf_users pu
  join perf_trips t on t.inst = pu.inst and t.local = (pu.local - 80) / 4 and t.day = 20
 where pu.local between 80 and 127;

-- Mensajes: 50 por chat de carga (3 000) + 27 000 en viajes normales = 30 000
insert into public.messages (trip_id, sender_id, body, created_at)
select t.id,
       case when m % 2 = 0 then t.driver_id
            else (select pu.id from perf_users pu where pu.inst = t.inst and pu.local = 80 + t.local * 4 + (m / 2) % 4) end,
       (array['Buenos días, salgo en 10 minutos', 'Voy llegando al punto', '¿Me esperas 2 minutos?',
              'Listo, gracias', 'Estoy en la portería', 'Hay trancón en la autopista'])[1 + m % 6] || ' (#' || m || ')',
       now() - interval '20 hours' + m * interval '1 minute'
  from perf_trips t
 cross join generate_series(0, 49) m
 where t.day = 20;

insert into public.messages (trip_id, sender_id, body, created_at)
select r.trip_id,
       case when m % 2 = 0 then t.driver_id else r.passenger_id end,
       (array['Hola, ¿dónde te recojo?', 'En la entrada principal', 'Perfecto', 'Voy 5 min tarde',
              'Gracias por el viaje', '¿Puedo llevar una maleta pequeña?'])[1 + m % 6] || ' (#' || m || ')',
       now() - interval '10 hours' + m * interval '3 minutes'
  from (select row_number() over (order by trip_id) - 1 as i, trip_id, passenger_id
          from public.trip_requests tr
         where tr.estado = 'aceptado'
           and tr.passenger_id in (select id from perf_users where local >= 128)
           and tr.created_at = now() - interval '1 day'   -- la solicitud q = 0 de cada viaje
       ) r
  join perf_trips t on t.id = r.trip_id
 cross join generate_series(0, 8) m
 where r.i < 3000;

-- Verificación facial reciente (válida 10 min en la app) para los pasajeros de carga:
-- se fecha 3 h en el futuro para que dure toda la prueba. Solo datos sintéticos locales.
insert into public.face_verifications (user_id, status, provider, purpose, template_kind, score, created_at, updated_at)
select id, 'verificado', 'on_device_sface', 'trip_request', 'selfie', 0.9, now() + interval '3 hours', now()
  from perf_users where local between 80 and 127;

set local session_replication_role = origin;

do $$
declare v_users int; v_trips int; v_req int; v_msg int;
begin
  select count(*) into v_users from auth.users where email like '%.example.test';
  select count(*) into v_trips from public.trips where salida_at > now();
  select count(*) into v_req from public.trip_requests;
  select count(*) into v_msg from public.messages;
  raise notice 'perf seed: % usuarios, % viajes futuros, % solicitudes, % mensajes', v_users, v_trips, v_req, v_msg;
  if v_users <> 2000 or v_trips <> 5000 or v_req <> 20000 or v_msg <> 30000 then
    raise exception 'Conteos inesperados';
  end if;
end $$;

commit;

analyze;
