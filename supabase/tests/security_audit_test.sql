-- =====================================================================
-- ConVía — pruebas de seguridad, privacidad y prioridad (base de datos real)
--
-- Uso: npx supabase db query --linked -f supabase/tests/security_audit_test.sql
-- Todo corre en un bloque que termina con RAISE EXCEPTION, así que NADA queda
-- guardado: el mensaje de error es el reporte. Cada línea dice OK o BAD.
-- =====================================================================
do $$
declare
  -- Organización A (unisabana.edu.co) y B (de prueba).
  dA uuid := gen_random_uuid();  -- conductor A
  pF uuid := gen_random_uuid();  -- pasajero FREE A
  pF2 uuid := gen_random_uuid(); -- pasajero FREE A (2)
  pP uuid := gen_random_uuid();  -- pasajero ConVía+ A
  pP2 uuid := gen_random_uuid(); -- pasajero ConVía+ A (2)
  dB uuid := gen_random_uuid();  -- conductor B
  pB uuid := gen_random_uuid();  -- pasajero B
  vA uuid; vB uuid; tA uuid; tB uuid; t1 uuid; t2 uuid; t3 uuid;
  rq uuid; rqF uuid; rqP uuid; rqP2 uuid; rqF2 uuid;
  -- Ruta Universidad → Cota → Siberia ([lng, lat]).
  v_ruta jsonb := '{"coords": [[-74.033, 4.8615], [-74.06, 4.845], [-74.103, 4.809], [-74.13, 4.765]], "km": 14, "minutes": 25, "via": []}';
  r text := ''; t text; n integer; ok boolean;
  bad integer := 0;

begin
  -- ---------------- datos de prueba (como administrador) ----------------
  insert into public.institutions (nombre, tipo, dominio) values ('Org B (prueba)', 'universidad', 'orgb-prueba.edu.co');
  insert into auth.users (id, email, raw_user_meta_data, aud, role) values
    (dA,  'zz.driver@unisabana.edu.co', '{"nombre":"ZZ Conductor A","rol":"conductor"}', 'authenticated', 'authenticated'),
    (pF,  'zz.free@unisabana.edu.co',   '{"nombre":"ZZ Free"}',  'authenticated', 'authenticated'),
    (pF2, 'zz.free2@unisabana.edu.co',  '{"nombre":"ZZ Free2"}', 'authenticated', 'authenticated'),
    (pP,  'zz.plus@unisabana.edu.co',   '{"nombre":"ZZ Plus"}',  'authenticated', 'authenticated'),
    (pP2, 'zz.plus2@unisabana.edu.co',  '{"nombre":"ZZ Plus2"}', 'authenticated', 'authenticated'),
    (dB,  'zz.driverb@orgb-prueba.edu.co', '{"nombre":"ZZ Conductor B","rol":"conductor"}', 'authenticated', 'authenticated'),
    (pB,  'zz.b@orgb-prueba.edu.co',    '{"nombre":"ZZ OrgB"}',  'authenticated', 'authenticated');
  update public.profiles set verification_status = 'verificado', telefono = '3000000000' where id in (dA, pF, pF2, pP, pP2, dB, pB);
  insert into public.driver_profiles (user_id, status) values (dA, 'aprobado'), (dB, 'aprobado')
    on conflict (user_id) do update set status = 'aprobado';
  insert into public.face_verifications (user_id, status, provider, purpose, template_kind)
    select u, 'verificado', 'on_device_sface', 'trip_request', 'selfie' from unnest(array[pF, pF2, pP, pP2, pB]) u;
  insert into public.face_verifications (user_id, status, provider, purpose, template_kind)
    select u, 'verificado', 'on_device_sface', 'driver_identity', 'license' from unnest(array[dA, dB]) u;
  insert into public.subscriptions (user_id, tier, provider) values (pP, 'plus', 'manual'), (pP2, 'plus', 'manual');
  insert into public.vehicles (driver_id, placa, marca, color, puestos) values (dA, 'ZZT952', 'Prueba', 'Gris', 4) returning id into vA;
  insert into public.vehicles (driver_id, placa, marca, color, puestos) values (dB, 'ZZB953', 'Prueba', 'Azul', 4) returning id into vB;
  insert into public.trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, salida_at, precio, cupos_totales, ruta)
    values (dA, vA, 'Calle 153 # 55-40, Colina', 4.8615, -74.033, 'Carrera 7 # 45-10, Siberia', 4.765, -74.13, now() + interval '1 day', 5000, 3, v_ruta)
    returning id into tA;
  insert into public.trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, salida_at, precio, cupos_totales)
    values (dB, vB, 'Org B origen', 4.70, -74.05, 'Org B destino', 4.65, -74.06, now() + interval '1 day', 5000, 3)
    returning id into tB;
  insert into public.saved_places (user_id, kind, label, address, lat, lng) values (pB, 'home', 'Casa B', 'Calle B # 1-2', 4.7, -74.0);

  -- ================= 1. PRIVACIDAD antes de aceptar =================
  perform set_config('request.jwt.claims', json_build_object('sub', pF, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin select email into t from public.profiles where id = dA; r := r || E'\nBAD privacy: other user email readable';
  exception when insufficient_privilege then r := r || E'\nOK  privacy: other users'' email not readable'; end;
  begin select telefono into t from public.profiles where id = dA; r := r || E'\nBAD privacy: other user phone readable';
  exception when insufficient_privilege then r := r || E'\nOK  privacy: other users'' phone not readable'; end;
  begin select expo_push_token into t from public.profiles where id = dA; r := r || E'\nBAD privacy: push token readable';
  exception when insufficient_privilege then r := r || E'\nOK  privacy: push tokens not readable'; end;
  select (public.get_my_profile() ->> 'email') = 'zz.free@unisabana.edu.co' into ok;
  r := r || case when ok then E'\nOK  privacy: get_my_profile returns own email' else E'\nBAD privacy: get_my_profile' end;

  select count(*) into n from public.trips where id = tA;
  r := r || case when n = 0 then E'\nOK  privacy: trips table not readable by non-owner' else E'\nBAD privacy: trip row readable' end;
  select count(*) into n from public.vehicles where id = vA;
  r := r || case when n = 0 then E'\nOK  privacy: vehicles table not readable by non-owner' else E'\nBAD privacy: vehicle row readable' end;
  select origen_nombre || ' | ' || origen_lat || ',' || origen_lng || ' | ' || vehicle_placa || ' | ' || coalesce(jsonb_array_length(ruta -> 'coords')::text, 'sin ruta')
    into t from public.available_trips where id = tA;
  r := r || case when t like 'Calle 153, Colina | %' and t like '% | Z••••2 | %' and t not like '%4.8615%'
                 then E'\nOK  privacy: available_trips reduced → ' || t else E'\nBAD privacy: available_trips → ' || coalesce(t, 'null') end;

  insert into public.trip_requests (trip_id, passenger_id, direccion, lat, lng, destino_nombre, destino_lat, destino_lng)
    values (tA, pF, 'Carrera 9 # 140-20, Cedritos', 4.8605, -74.036, 'Cota centro', 4.809, -74.103) returning id into rq;
  begin perform public.trip_members(tA); r := r || E'\nBAD privacy: pending passenger reads trip_members';
  exception when others then r := r || E'\nOK  privacy: pending passenger cannot read trip_members'; end;
  select direccion || ' | ' || origen_viaje into t from public.my_trip_requests() where id = rq;
  r := r || case when t = 'Carrera 9 # 140-20, Cedritos | Calle 153, Colina' then E'\nOK  privacy: my_trip_requests (own address exact, trip reduced)' else E'\nBAD privacy: my_trip_requests → ' || coalesce(t, 'null') end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', dA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin select direccion into t from public.trip_requests where id = rq; r := r || E'\nBAD privacy: driver reads pending address directly';
  exception when insufficient_privilege then r := r || E'\nOK  privacy: request address not readable directly'; end;
  begin select lat::text into t from public.trip_requests where id = rq; r := r || E'\nBAD privacy: driver reads pending coords directly';
  exception when insufficient_privilege then r := r || E'\nOK  privacy: request coordinates not readable directly'; end;
  select direccion || ' | ' || coalesce(destino_nombre, '-') || ' | ' || match_level into t from public.driver_trip_requests() where id = rq;
  r := r || case when t like 'Carrera 9, Cedritos | Cota centro | %' then E'\nOK  privacy: driver sees pending pickup without house number → ' || t else E'\nBAD privacy: driver_trip_requests pending → ' || coalesce(t, 'null') end;
  perform public.respond_trip_request(rq, true);
  select direccion into t from public.driver_trip_requests() where id = rq;
  r := r || case when t = 'Carrera 9 # 140-20, Cedritos' then E'\nOK  privacy: exact pickup revealed after acceptance' else E'\nBAD privacy: accepted pickup → ' || coalesce(t, 'null') end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', pF, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select (public.trip_members(tA) #>> '{trip,vehicle,placa}') || ' | ' || (public.trip_members(tA) #>> '{trip,origen_nombre}') into t;
  r := r || case when t = 'ZZT952 | Calle 153, Colina' then E'\nOK  privacy: accepted passenger sees full plate, driver origin reduced' else E'\nBAD privacy: accepted passenger → ' || coalesce(t, 'null') end;
  execute 'reset role';

  update public.trips set estado = 'finalizado', finished_at = now() where id = tA;
  perform set_config('request.jwt.claims', json_build_object('sub', pF, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.trip_members(tA) #>> '{trip,vehicle,placa}' into t;
  r := r || case when t = 'Z••••2' then E'\nOK  privacy: plate masked again after the trip' else E'\nBAD privacy: plate after trip → ' || coalesce(t, 'null') end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', dA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.trip_members(tA) #>> '{passengers,0,direccion}' into t;
  r := r || case when t = 'Carrera 9, Cedritos' then E'\nOK  privacy: driver no longer sees exact pickup after the trip' else E'\nBAD privacy: pickup after trip → ' || coalesce(t, 'null') end;
  execute 'reset role';

  -- ================= 2. CHAT y CALIFICACIONES tras el viaje =================
  perform set_config('request.jwt.claims', json_build_object('sub', pF, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin insert into public.messages (trip_id, sender_id, body) values (tA, pF, 'hola'); r := r || E'\nBAD chat: passenger writes after trip';
  exception when others then r := r || E'\nOK  chat: passenger cannot write after trip'; end;
  select count(*) into n from public.my_chat_trips() where trip_id = tA;
  r := r || case when n = 0 then E'\nOK  chat: finished trip not in chat list' else E'\nBAD chat: finished trip listed' end;
  select public.chat_trip_state(tA) into t;
  r := r || case when t = 'ended' then E'\nOK  chat: state of finished trip is "ended"' else E'\nBAD chat: state → ' || coalesce(t, 'null') end;
  perform public.rate_trip_driver(tA, 5::smallint, 'Excelente');
  begin perform public.rate_trip_driver(tA, 4::smallint, null); r := r || E'\nBAD rating: second rating accepted';
  exception when others then r := r || E'\nOK  rating: one rating per passenger and trip'; end;
  begin insert into public.ratings (trip_id, rater_id, rated_id, score) values (tA, pF, dA, 1); r := r || E'\nBAD rating: direct insert allowed';
  exception when insufficient_privilege then r := r || E'\nOK  rating: direct insert blocked'; end;
  select score::text into t from public.ratings where trip_id = tA and rater_id = pF;
  r := r || case when t = '5' then E'\nOK  rating: rater sees own rating' else E'\nBAD rating: own rating → ' || coalesce(t, 'null') end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', pP, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.ratings where trip_id = tA;
  r := r || case when n = 0 then E'\nOK  rating: uninvolved user cannot read others'' ratings' else E'\nBAD rating: readable by uninvolved' end;
  begin perform public.rate_trip_driver(tA, 1::smallint, null); r := r || E'\nBAD rating: user without seat rated';
  exception when others then r := r || E'\nOK  rating: only passengers with a seat can rate'; end;
  execute 'reset role';
  select rating_driver_avg::text into t from public.profiles where id = dA;
  r := r || case when t = '5.00' then E'\nOK  rating: driver average updated (5.00)' else E'\nBAD rating: average → ' || coalesce(t, 'null') end;

  -- ================= 3. AISLAMIENTO ENTRE ORGANIZACIONES =================
  perform set_config('request.jwt.claims', json_build_object('sub', pB, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.available_trips where id = tA;
  r := r || case when n = 0 then E'\nOK  org: available_trips of another org hidden' else E'\nBAD org: available_trips leak' end;
  select count(*) into n from public.profiles where id in (dA, pF, pP);
  r := r || case when n = 0 then E'\nOK  org: profiles of another org hidden' else E'\nBAD org: profiles leak' end;
  select count(*) into n from public.trips where id = tA;
  r := r || case when n = 0 then E'\nOK  org: trips of another org hidden' else E'\nBAD org: trips leak' end;
  select count(*) into n from public.vehicles where id = vA;
  r := r || case when n = 0 then E'\nOK  org: vehicles of another org hidden' else E'\nBAD org: vehicles leak' end;
  select count(*) into n from public.trip_requests where trip_id = tA;
  r := r || case when n = 0 then E'\nOK  org: requests of another org hidden' else E'\nBAD org: requests leak' end;
  select count(*) into n from public.messages where trip_id = tA;
  r := r || case when n = 0 then E'\nOK  org: chat of another org hidden' else E'\nBAD org: chat leak' end;
  select count(*) into n from public.ratings where trip_id = tA;
  r := r || case when n = 0 then E'\nOK  org: ratings of another org hidden' else E'\nBAD org: ratings leak' end;
  select count(*) into n from public.subscriptions where user_id in (pP, pP2);
  r := r || case when n = 0 then E'\nOK  org: subscriptions of others hidden' else E'\nBAD org: subscriptions leak' end;
  select count(*) into n from public.trip_updates where trip_id = tA;
  r := r || case when n = 0 then E'\nOK  org: trip updates of another org hidden' else E'\nBAD org: trip updates leak' end;
  select count(*) into n from public.driver_trip_requests() where trip_id = tA;
  r := r || case when n = 0 then E'\nOK  org: driver_trip_requests of another driver hidden' else E'\nBAD org: driver_trip_requests leak' end;
  begin insert into public.trip_requests (trip_id, passenger_id, direccion) values (tA, pB, 'x'); r := r || E'\nBAD org: cross-org request created';
  exception when others then r := r || E'\nOK  org: cannot request a seat in another org'; end;
  begin insert into public.favorite_drivers (user_id, driver_id) values (pB, dA); r := r || E'\nBAD org: cross-org favorite';
  exception when others then r := r || E'\nOK  org: cannot favorite a driver of another org'; end;
  begin insert into public.messages (trip_id, sender_id, body) values (tA, pB, 'hola'); r := r || E'\nBAD org: cross-org chat';
  exception when others then r := r || E'\nOK  org: cannot write in another org''s chat'; end;
  begin perform public.trip_members(tA); r := r || E'\nBAD org: trip_members of another org';
  exception when others then r := r || E'\nOK  org: trip_members of another org blocked'; end;
  select public.chat_trip_state(tA) into t;
  r := r || case when t = 'none' then E'\nOK  org: chat state of another org is "none"' else E'\nBAD org: chat state → ' || coalesce(t, 'null') end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', pF, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.saved_places where user_id = pB;
  r := r || case when n = 0 then E'\nOK  org: saved places of others hidden' else E'\nBAD org: saved places leak' end;

  -- ================= 4. PLANES (no se pueden saltar) =================
  begin insert into public.subscriptions (user_id, tier) values (pF, 'plus'); r := r || E'\nBAD plan: self-upgrade';
  exception when insufficient_privilege then r := r || E'\nOK  plan: users cannot give themselves ConVía+'; end;
  begin update public.plans set limits = '{"vehicles": 99}' where tier = 'free';
    get diagnostics n = row_count;
    r := r || case when n = 0 then E'\nOK  plan: plans not editable' else E'\nBAD plan: plans edited' end;
  exception when insufficient_privilege then r := r || E'\nOK  plan: plans not editable'; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', dA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin insert into public.vehicles (driver_id, placa, marca, color, puestos) values (dA, 'ZZT954', 'Otro', 'Rojo', 4); r := r || E'\nBAD plan: FREE second vehicle';
  exception when others then r := r || E'\nOK  plan: FREE driver cannot register a 2nd vehicle'; end;
  execute 'reset role';

  -- ================= 5. PRIORIDAD ConVía+ vs COMPATIBILIDAD =================
  -- Escenario 1: 1 cupo. FREE muy compatible vs ConVía+ incompatible → se acepta la FREE.
  insert into public.trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, salida_at, precio, cupos_totales, ruta)
    values (dA, vA, 'Universidad', 4.8615, -74.033, 'Siberia', 4.765, -74.13, now() + interval '3 days', 5000, 1, v_ruta) returning id into t1;
  insert into public.trip_requests (trip_id, passenger_id, direccion, lat, lng, destino_lat, destino_lng) values
    (t1, pF2, 'Entrada', 4.8605, -74.036, 4.809, -74.103) returning id into rqF;          -- va a Cota: muy compatible
  insert into public.trip_requests (trip_id, passenger_id, direccion, lat, lng, destino_lat, destino_lng) values
    (t1, pP, 'Entrada', 4.8605, -74.036, 4.7545, -74.046) returning id into rqP;          -- va a Portal Norte: incompatible
  perform set_config('request.jwt.claims', json_build_object('sub', dA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select string_agg(passenger_nombre || ':' || match_level || ':' || passenger_is_plus, ' > ') into t from public.driver_trip_requests() where trip_id = t1;
  r := r || case when t like 'ZZ Free2:excellent:false > ZZ Plus:low:true' then E'\nOK  priority: order puts compatible FREE above incompatible PLUS → ' || t else E'\nBAD priority: order → ' || coalesce(t, 'null') end;
  begin perform public.respond_trip_request(rqF, true); r := r || E'\nOK  priority: compatible FREE accepted despite incompatible PLUS pending';
  exception when others then r := r || E'\nBAD priority: compatible FREE blocked: ' || sqlerrm; end;
  execute 'reset role';

  -- Escenario 2: 1 cupo. FREE y ConVía+ igual de compatibles → la ConVía+ tiene prioridad.
  insert into public.trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, salida_at, precio, cupos_totales, ruta)
    values (dA, vA, 'Universidad', 4.8615, -74.033, 'Siberia', 4.765, -74.13, now() + interval '5 days', 5000, 1, v_ruta) returning id into t2;
  insert into public.trip_requests (trip_id, passenger_id, direccion, lat, lng, destino_lat, destino_lng) values
    (t2, pF2, 'Entrada', 4.8605, -74.036, 4.809, -74.103) returning id into rqF2;
  insert into public.trip_requests (trip_id, passenger_id, direccion, lat, lng, destino_lat, destino_lng) values
    (t2, pP2, 'Entrada', 4.8605, -74.036, 4.809, -74.103) returning id into rqP2;
  perform set_config('request.jwt.claims', json_build_object('sub', dA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select string_agg(passenger_nombre || ':' || match_level, ' > ') into t from public.driver_trip_requests() where trip_id = t2;
  r := r || case when t like 'ZZ Plus2:excellent > ZZ Free2:excellent' then E'\nOK  priority: equal compatibility → PLUS first' else E'\nBAD priority: tie order → ' || coalesce(t, 'null') end;
  begin perform public.respond_trip_request(rqF2, true); r := r || E'\nBAD priority: FREE took the seat from an equally compatible PLUS';
  exception when others then r := r || E'\nOK  priority: equally compatible PLUS goes first (FREE waits, not rejected)'; end;
  select estado::text into t from public.trip_requests where id = rqF2;
  r := r || case when t = 'pendiente' then E'\nOK  priority: FREE request still pending (not auto-rejected)' else E'\nBAD priority: FREE state → ' || t end;
  perform public.respond_trip_request(rqP2, true);
  r := r || E'\nOK  priority: PLUS accepted';
  execute 'reset role';

  -- Escenario 3: 1 cupo. FREE muy compatible vs ConVía+ menos compatible (recoge lejos) → la FREE no se bloquea.
  insert into public.trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, salida_at, precio, cupos_totales, ruta)
    values (dA, vA, 'Universidad', 4.8615, -74.033, 'Siberia', 4.765, -74.13, now() + interval '7 days', 5000, 1, v_ruta) returning id into t3;
  insert into public.trip_requests (trip_id, passenger_id, direccion, lat, lng, destino_lat, destino_lng) values
    (t3, pF, 'Entrada', 4.8605, -74.036, 4.809, -74.103) returning id into rqF;
  insert into public.trip_requests (trip_id, passenger_id, direccion, lat, lng, destino_lat, destino_lng) values
    (t3, pP, 'Lejos', 4.8615, -74.003, 4.809, -74.103) returning id into rqP;             -- ~3,3 km de la ruta
  perform set_config('request.jwt.claims', json_build_object('sub', dA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select string_agg(passenger_nombre || ':' || match_level, ' > ') into t from public.driver_trip_requests() where trip_id = t3;
  r := r || E'\n    priority scenario 3 order: ' || coalesce(t, 'null');
  begin perform public.respond_trip_request(rqF, true); r := r || E'\nOK  priority: more compatible FREE not blocked by less compatible PLUS';
  exception when others then r := r || E'\nBAD priority: FREE blocked by less compatible PLUS: ' || sqlerrm; end;
  execute 'reset role';

  bad := (length(r) - length(replace(r, E'\nBAD', ''))) / 4;
  raise exception 'SECURITY AUDIT (rolled back) — % failing:%', bad, r;
end $$;
