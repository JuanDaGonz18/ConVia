-- =====================================================================
-- ConVía — pruebas de viajes recurrentes, alertas, preferencias,
-- estadísticas, repetir viaje y varios vehículos (base de datos real)
--
-- Uso: npx supabase db query --linked -f supabase/tests/planned_features_test.sql
-- Todo se deshace al final (el bloque termina con RAISE EXCEPTION); el
-- mensaje de error es el reporte. Cada línea dice OK o BAD.
-- =====================================================================
do $$
declare
  dA uuid := gen_random_uuid();  -- conductor A
  dX uuid := gen_random_uuid();  -- otro conductor A
  pF uuid := gen_random_uuid();  -- pasajero A (ruta compatible)
  pG uuid := gen_random_uuid();  -- pasajero A (ruta en sentido contrario)
  pH uuid := gen_random_uuid();  -- pasajero A (sin alertas)
  pB uuid := gen_random_uuid();  -- pasajero organización B (misma ruta que pF)
  vA uuid; vA2 uuid; vX uuid; sched uuid; tA uuid; tS uuid; tR uuid; tKeep uuid; tCan uuid; tEd uuid; tNew uuid;
  rtF uuid; placeG uuid;
  -- Universidad → Cota → Siberia ([lng, lat]).
  v_ruta jsonb := '{"coords": [[-74.033, 4.8615], [-74.06, 4.845], [-74.103, 4.809], [-74.13, 4.765]], "km": 14, "minutes": 25, "via": []}';
  -- Hora del horario semanal: lejos de los otros viajes de la prueba (sin choques de 90 min).
  v_hora time := date_trunc('hour', (now() at time zone 'America/Bogota') + interval '12 hours')::time;
  res jsonb; r text := ''; t text; n integer; n2 integer; ok boolean;
begin
  update public.app_config set beta_mode = true;
  insert into public.institutions (nombre, tipo, dominio) values ('Org B (prueba)', 'universidad', 'orgb-prueba.edu.co');
  insert into auth.users (id, email, raw_user_meta_data, aud, role) values
    (dA, 'zz.drivera@unisabana.edu.co', '{"nombre":"ZZ Conductor A","rol":"conductor"}', 'authenticated', 'authenticated'),
    (dX, 'zz.driverx@unisabana.edu.co', '{"nombre":"ZZ Conductor X","rol":"conductor"}', 'authenticated', 'authenticated'),
    (pF, 'zz.pf@unisabana.edu.co', '{"nombre":"ZZ Pasajero F"}', 'authenticated', 'authenticated'),
    (pG, 'zz.pg@unisabana.edu.co', '{"nombre":"ZZ Pasajero G"}', 'authenticated', 'authenticated'),
    (pH, 'zz.ph@unisabana.edu.co', '{"nombre":"ZZ Pasajero H"}', 'authenticated', 'authenticated'),
    (pB, 'zz.pb@orgb-prueba.edu.co', '{"nombre":"ZZ Pasajero B"}', 'authenticated', 'authenticated');
  update public.profiles set verification_status = 'verificado' where id in (dA, dX, pF, pG, pH, pB);
  insert into public.driver_profiles (user_id, status) values (dA, 'aprobado'), (dX, 'aprobado')
    on conflict (user_id) do update set status = 'aprobado';
  insert into public.face_verifications (user_id, status, provider, purpose, template_kind)
    select u, 'verificado', 'on_device_sface', 'trip_request', 'selfie' from unnest(array[pF, pG, pH, pB]) u;
  insert into public.face_verifications (user_id, status, provider, purpose, template_kind)
    select u, 'verificado', 'on_device_sface', 'driver_identity', 'license' from unnest(array[dA, dX]) u;
  insert into public.vehicles (driver_id, placa, marca, color, puestos) values (dA, 'ZZR901', 'Uno', 'Gris', 4) returning id into vA;
  insert into public.vehicles (driver_id, placa, marca, color, puestos) values (dX, 'ZZR903', 'Tres', 'Azul', 4) returning id into vX;

  -- ================= VARIOS VEHÍCULOS =================
  perform set_config('request.jwt.claims', json_build_object('sub', dA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.vehicles (driver_id, placa, marca, color, puestos) values (dA, 'ZZR902', 'Dos', 'Rojo', 3) returning id into vA2;
    r := r || E'\nOK  vehicles: a driver registers a 2nd vehicle (beta)';
  exception when others then r := r || E'\nBAD vehicles: 2nd vehicle → ' || sqlerrm; end;
  select count(*) into n from public.vehicles where id = vX;
  r := r || case when n = 0 then E'\nOK  vehicles: another driver''s vehicle is not readable' else E'\nBAD vehicles: read another driver''s vehicle' end;
  begin
    insert into public.trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, salida_at, precio, cupos_totales)
      values (dA, vX, 'A', 4.86, -74.03, 'B', 4.76, -74.13, now() + interval '3 days', 5000, 2);
    r := r || E'\nBAD vehicles: published a trip with another driver''s vehicle';
  exception when others then r := r || E'\nOK  vehicles: a trip can only use one''s own vehicle'; end;

  -- ================= VIAJES RECURRENTES =================
  -- Chía → Zipaquirá todos los días (no coincide con las rutas de alerta).
  res := public.save_recurring_trip(null, vA2, 'Calle 10 # 4-20, Chía', 4.86, -74.06, 'Carrera 7 # 3-15, Zipaquirá', 5.02, -74.0,
    null, v_hora, array[1,2,3,4,5,6,7]::smallint[], (now() at time zone 'America/Bogota')::date, null, 5000, 3::smallint, 'Prueba');
  sched := (res ->> 'id')::uuid;
  select count(*) into n from public.trips where recurring_trip_id = sched;
  r := r || case when (res ->> 'created')::integer >= 7 and n = (res ->> 'created')::integer
                 then E'\nOK  recurring: schedule created and its next 7 days published (' || n || ' trips)'
                 else E'\nBAD recurring: created → ' || res::text || ' rows ' || n end;
  select count(*) into n from public.trips where recurring_trip_id = sched
     and (salida_at at time zone 'America/Bogota')::time = v_hora and vehicle_id = vA2 and cupos_totales = 3;
  r := r || case when n = (res ->> 'created')::integer then E'\nOK  recurring: trips use the schedule''s local time, vehicle and seats' else E'\nBAD recurring: trip details' end;
  select count(*) into n from public.trips t join public.profiles p on p.id = dA where t.recurring_trip_id = sched and t.institution_id = p.institution_id;
  r := r || case when n = (res ->> 'created')::integer then E'\nOK  recurring: trips belong to the driver''s organization' else E'\nBAD recurring: institution' end;
  begin
    insert into public.recurring_trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, hora, dias, fecha_inicio, precio, cupos_totales)
      values (dA, vA2, 'X', 4.8, -74.0, 'Y', 4.9, -74.1, '08:00', '{1}', current_date, 1, 1);
    r := r || E'\nBAD recurring: client inserted a schedule directly';
  exception when others then r := r || E'\nOK  recurring: schedules only through the server function'; end;
  begin
    update public.vehicles set activo = false where id = vA2;
    r := r || E'\nBAD recurring: removed a vehicle used by an active schedule';
  exception when others then r := r || E'\nOK  recurring: a vehicle in an active schedule cannot be removed'; end;

  -- Cancelar y editar ocurrencias (como el conductor).
  select id into tCan from public.trips where recurring_trip_id = sched order by salida_at limit 1;
  select id into tEd from public.trips where recurring_trip_id = sched order by salida_at offset 1 limit 1;
  select id into tKeep from public.trips where recurring_trip_id = sched order by salida_at offset 2 limit 1;
  perform public.cancel_trip(tCan);
  execute 'reset role';
  update public.trips set salida_at = salida_at + interval '20 minutes' where id = tEd;  -- edición del viaje
  insert into public.trip_requests (trip_id, passenger_id, direccion, estado) values (tKeep, pH, 'Calle 1', 'pendiente');
  select count(*) into n from public.trips where recurring_trip_id = sched;
  n2 := private.generate_recurring_trips(sched);
  r := r || case when n2 = 0 then E'\nOK  recurring: generating again creates no duplicates' else E'\nBAD recurring: duplicates → ' || n2 end;
  r := r || case when (select estado from public.trips where id = tCan) = 'cancelado'
                      and (select count(*) from public.trips where recurring_trip_id = sched and recurring_slot = (select recurring_slot from public.trips where id = tCan)) = 1
                 then E'\nOK  recurring: a cancelled date is not published again' else E'\nBAD recurring: cancelled date regenerated' end;
  r := r || case when (select count(*) from public.trips where recurring_trip_id = sched and recurring_slot = (select recurring_slot from public.trips where id = tEd)) = 1
                 then E'\nOK  recurring: an edited trip is not duplicated' else E'\nBAD recurring: edited trip duplicated' end;

  -- Editar el horario: se regeneran los viajes sin solicitudes; el pedido se conserva.
  perform set_config('request.jwt.claims', json_build_object('sub', dA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  res := public.save_recurring_trip(sched, vA2, 'Calle 10 # 4-20, Chía', 4.86, -74.06, 'Carrera 7 # 3-15, Zipaquirá', 5.02, -74.0,
    null, v_hora, array[1,2,3,4,5,6,7]::smallint[], (now() at time zone 'America/Bogota')::date, null, 7000, 3::smallint, 'Prueba');
  execute 'reset role';
  r := r || case when (res ->> 'kept')::integer = 1 and (select precio from public.trips where id = tKeep) = 5000
                      and not exists (select 1 from public.trips where recurring_trip_id = sched and estado = 'por_empezar' and id <> tKeep and precio <> 7000)
                 then E'\nOK  recurring: editing the schedule updates future trips and keeps requested ones' else E'\nBAD recurring: edit → ' || res::text end;

  -- Propiedad y organización.
  perform set_config('request.jwt.claims', json_build_object('sub', dX, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.recurring_trips;
  r := r || case when n = 0 then E'\nOK  recurring: other drivers cannot see the schedule' else E'\nBAD recurring: visible to others' end;
  begin
    perform public.save_recurring_trip(sched, vX, 'A', 4.86, -74.06, 'B', 5.02, -74.0, null, '06:00', '{1}', current_date, null, 1, 1::smallint, null);
    r := r || E'\nBAD recurring: another driver edited the schedule';
  exception when others then r := r || E'\nOK  recurring: only the owner edits the schedule'; end;
  begin
    perform public.save_recurring_trip(null, vA, 'A', 4.86, -74.06, 'B', 5.02, -74.0, null, '06:00', '{1}', current_date, null, 1, 1::smallint, null);
    r := r || E'\nBAD recurring: schedule with another driver''s vehicle';
  exception when others then r := r || E'\nOK  recurring: schedule only with one''s own vehicle'; end;
  begin
    perform public.set_recurring_trip_active(sched, false);
    r := r || E'\nBAD recurring: another driver paused the schedule';
  exception when others then r := r || E'\nOK  recurring: only the owner pauses the schedule'; end;
  begin
    insert into public.trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, salida_at, precio, cupos_totales, recurring_trip_id, recurring_slot)
      values (dX, vX, 'A', 4.86, -74.03, 'B', 4.76, -74.13, now() + interval '9 days', 5000, 2, sched, now() + interval '9 days');
    r := r || E'\nBAD recurring: another driver took a date of the schedule';
  exception when others then r := r || E'\nOK  recurring: a trip cannot occupy another driver''s schedule'; end;
  execute 'reset role';

  -- Pausar.
  perform set_config('request.jwt.claims', json_build_object('sub', dA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  res := public.set_recurring_trip_active(sched, false);
  execute 'reset role';
  select count(*) into n from public.trips where recurring_trip_id = sched and estado = 'por_empezar';
  r := r || case when (res ->> 'kept')::integer = 1 and n = 1 and private.generate_recurring_trips(sched) = 0
                 then E'\nOK  recurring: pausing removes unrequested trips and stops publishing' else E'\nBAD recurring: pause → ' || res::text || ' open ' || n end;

  -- Sin beta, un conductor FREE no crea horarios y los existentes quedan en pausa.
  update public.app_config set beta_mode = false;
  update public.recurring_trips set activo = true where id = sched;
  r := r || case when private.generate_recurring_trips(sched) = 0 then E'\nOK  recurring: without beta, FREE schedules stop publishing' else E'\nBAD recurring: FREE schedule published without beta' end;
  perform set_config('request.jwt.claims', json_build_object('sub', dA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.save_recurring_trip(null, vA, 'A', 4.86, -74.06, 'B', 5.02, -74.0, null, '09:00', '{1}', current_date, null, 1, 1::smallint, null);
    r := r || E'\nBAD recurring: FREE created a schedule without beta';
  exception when others then
    r := r || case when sqlerrm like 'CAPACIDAD_PLAN:recurring_trips%' then E'\nOK  recurring: without beta it is ConVía+ (server check)' else E'\nBAD recurring: unexpected error ' || sqlerrm end;
  end;
  execute 'reset role';
  update public.recurring_trips set activo = false where id = sched;
  update public.app_config set beta_mode = true;

  -- ================= ALERTAS DE VIAJES COMPATIBLES =================
  perform set_config('request.jwt.claims', json_build_object('sub', pF, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.saved_routes (user_id, nombre, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, alerta)
    values (pF, 'U a Siberia', 'Universidad', 4.8605, -74.035, 'Siberia', 4.766, -74.128, true) returning id into rtF;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', pG, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.saved_routes (user_id, nombre, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, alerta)
    values (pG, 'Siberia a U', 'Siberia', 4.766, -74.128, 'Universidad', 4.8605, -74.035, true);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', pB, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.saved_routes (user_id, nombre, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, alerta)
    values (pB, 'U a Siberia', 'Universidad', 4.8605, -74.035, 'Siberia', 4.766, -74.128, true);
  execute 'reset role';
  -- El conductor A publica Universidad → Siberia.
  perform set_config('request.jwt.claims', json_build_object('sub', dA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, salida_at, precio, cupos_totales, ruta)
    values (dA, vA, 'Calle 153 # 55-40, Colina', 4.8615, -74.033, 'Carrera 7 # 45-10, Siberia', 4.765, -74.13, now() + interval '1 day' + interval '5 hours', 5000, 3, v_ruta)
    returning id into tA;
  execute 'reset role';
  select count(*) into n from public.trip_alert_hits where trip_id = tA and user_id = pF and level in ('excellent', 'good');
  r := r || case when n = 1 then E'\nOK  alerts: a compatible new trip creates an alert' else E'\nBAD alerts: compatible trip → ' || n end;
  select count(*) into n from public.trip_alert_hits where trip_id = tA and user_id = pG;
  r := r || case when n = 0 then E'\nOK  alerts: a trip going the other way does not alert' else E'\nBAD alerts: incompatible trip alerted' end;
  select count(*) into n from public.trip_alert_hits where trip_id = tA and user_id = pB;
  r := r || case when n = 0 then E'\nOK  alerts: other organizations are never alerted' else E'\nBAD alerts: cross-organization alert' end;
  select count(*) into n from public.trip_alert_hits where trip_id = tA and user_id = dA;
  r := r || case when n = 0 then E'\nOK  alerts: drivers are not alerted of their own trip' else E'\nBAD alerts: own trip alerted' end;
  perform private.match_trip_alerts(tA);
  update public.trips set salida_at = salida_at + interval '10 minutes' where id = tA;
  select count(*) into n from public.trip_alert_hits where trip_id = tA and user_id = pF;
  r := r || case when n = 1 then E'\nOK  alerts: one alert per user and trip (no duplicates on re-check or edit)' else E'\nBAD alerts: duplicates → ' || n end;
  -- Franja horaria: una ruta de otra hora no recibe este viaje.
  -- Una franja de una hora que no incluye la salida del viaje.
  if extract(hour from (select salida_at from public.trips where id = tA) at time zone 'America/Bogota') >= 12 then
    update public.saved_routes set hora_desde = '01:00', hora_hasta = '02:00' where id = rtF;
  else
    update public.saved_routes set hora_desde = '20:00', hora_hasta = '21:00' where id = rtF;
  end if;
  delete from public.trip_alert_hits where trip_id = tA;
  perform private.match_trip_alerts(tA);
  select count(*) into n from public.trip_alert_hits where trip_id = tA and user_id = pF;
  r := r || case when n = 0 then E'\nOK  alerts: the route''s time window is respected' else E'\nBAD alerts: time window ignored' end;
  update public.saved_routes set hora_desde = null, hora_hasta = null where id = rtF;
  perform private.match_trip_alerts(tA);

  -- Privacidad de las alertas.
  perform set_config('request.jwt.claims', json_build_object('sub', pG, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.trip_alert_hits;
  select count(*) into n2 from public.saved_routes where user_id <> pG;
  r := r || case when n = 0 and n2 = 0 then E'\nOK  alerts: nobody sees another user''s routes or alerts' else E'\nBAD alerts: leaked ' || n || '/' || n2 end;
  begin
    perform * from public.claim_alert_pushes(tA, null);
    r := r || E'\nBAD alerts: a user can claim pushes';
  exception when others then r := r || E'\nOK  alerts: only the server sends alert notifications'; end;
  begin
    insert into public.trip_alert_hits (user_id, trip_id, score, level) values (pG, tA, 99, 'excellent');
    r := r || E'\nBAD alerts: a user created an alert';
  exception when others then r := r || E'\nOK  alerts: users cannot create alerts'; end;
  execute 'reset role';

  -- Aviso: texto sin número de casa, una sola vez.
  select count(*), bool_and(body not like '%#%' and body not like '%55-40%') into n, ok from public.claim_alert_pushes(tA, null) c where c.user_id = pF;
  r := r || case when n = 1 and ok then E'\nOK  alerts: the notification shows places without house numbers' else E'\nBAD alerts: push → ' || n end;
  select count(*) into n from public.claim_alert_pushes(tA, null);
  r := r || case when n = 0 then E'\nOK  alerts: the same alert is never notified twice' else E'\nBAD alerts: notified again' end;
  -- Máximo 3 notificaciones de alertas por día: 3 viajes más, solo 2 se notifican.
  perform set_config('request.jwt.claims', json_build_object('sub', dA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, salida_at, precio, cupos_totales, ruta)
    values (dA, vA, 'U', 4.8615, -74.033, 'Siberia', 4.765, -74.13, now() + interval '2 days' + interval '5 hours', 5000, 3, v_ruta),
           (dA, vA, 'U', 4.8615, -74.033, 'Siberia', 4.765, -74.13, now() + interval '3 days' + interval '5 hours', 5000, 3, v_ruta),
           (dA, vA, 'U', 4.8615, -74.033, 'Siberia', 4.765, -74.13, now() + interval '4 days' + interval '5 hours', 5000, 3, v_ruta);
  execute 'reset role';
  select count(*) into n from public.claim_alert_pushes(null, null) c where c.user_id = pF;
  select count(*) into n2 from public.trip_alert_hits where user_id = pF and pushed_at is not null and not push_sent;
  r := r || case when n = 2 and n2 = 1 then E'\nOK  alerts: at most 3 alert notifications per user per day' else E'\nBAD alerts: anti-spam → sent ' || n || ' suppressed ' || n2 end;

  -- Sin beta: FREE no activa alertas y tiene 1 ruta guardada.
  update public.app_config set beta_mode = false;
  perform set_config('request.jwt.claims', json_build_object('sub', pH, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.saved_routes (user_id, nombre, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, alerta)
      values (pH, 'Con alerta', 'A', 4.86, -74.03, 'B', 4.76, -74.13, true);
    r := r || E'\nBAD alerts: FREE enabled an alert without beta';
  exception when others then r := r || E'\nOK  alerts: without beta, alerts are ConVía+ (server check)'; end;
  insert into public.saved_routes (user_id, nombre, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng)
    values (pH, 'Una', 'A', 4.86, -74.03, 'B', 4.76, -74.13);
  begin
    insert into public.saved_routes (user_id, nombre, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng)
      values (pH, 'Dos', 'A', 4.86, -74.03, 'C', 4.70, -74.10);
    r := r || E'\nBAD routes: FREE saved a 2nd route without beta';
  exception when others then
    r := r || case when sqlerrm like 'LIMITE_PLAN:saved_routes:1%' then E'\nOK  routes: FREE saved-route limit enforced (1)' else E'\nBAD routes: ' || sqlerrm end;
  end;
  execute 'reset role';
  update public.app_config set beta_mode = true;

  -- ================= PREFERENCIAS =================
  insert into public.saved_places (user_id, kind, label, address, lat, lng) values (pG, 'home', 'Casa G', 'Calle 2', 4.8, -74.0) returning id into placeG;
  perform set_config('request.jwt.claims', json_build_object('sub', pF, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.user_preferences (user_id, orden, max_bajada_km) values (pF, 'departure', 1.5);
  begin
    update public.user_preferences set recogida_place_id = placeG where user_id = pF;
    r := r || E'\nBAD preferences: used another user''s place';
  exception when others then r := r || E'\nOK  preferences: only one''s own places'; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', pG, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.user_preferences;
  r := r || case when n = 0 then E'\nOK  preferences: private to each user' else E'\nBAD preferences: leaked' end;
  execute 'reset role';

  -- ================= ESTADÍSTICAS =================
  -- Viaje finalizado de A con dos pasajeras aceptadas (una pagó) y una rechazada.
  insert into public.trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, salida_at, precio, cupos_totales, ruta)
    values (dA, vA, 'U', 4.8615, -74.033, 'Siberia', 4.765, -74.13, now() - interval '2 days', 6000, 3, v_ruta) returning id into tS;
  update public.trips set estado = 'finalizado', started_at = now() - interval '2 days', finished_at = now() - interval '2 days' where id = tS;
  insert into public.trip_requests (trip_id, passenger_id, direccion, lat, lng, estado, pago) values
    (tS, pF, 'Calle 1', 4.8615, -74.033, 'abordado', 'pagado'),
    (tS, pG, 'Calle 2', 4.8615, -74.033, 'aceptado', 'no_pagado'),
    (tS, pH, 'Calle 3', 4.8615, -74.033, 'negado', null);
  perform set_config('request.jwt.claims', json_build_object('sub', dA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  res := public.my_trip_stats() -> 'driver';
  execute 'reset role';
  r := r || case when (res ->> 'completed')::integer = 1 and (res ->> 'passengers')::integer = 2 and (res ->> 'agreed')::numeric = 12000
                      and (res ->> 'paid')::numeric = 6000 and (res ->> 'km')::numeric = 14 and (res ->> 'rejected')::integer = 1
                      and (res ->> 'accepted')::integer = 2 and (res ->> 'seats_offered')::integer = 3
                 then E'\nOK  stats: driver totals (trips, passengers, km, agreed and paid)' else E'\nBAD stats: driver → ' || coalesce(res::text, 'null') end;
  perform set_config('request.jwt.claims', json_build_object('sub', pF, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  res := public.my_trip_stats();
  execute 'reset role';
  r := r || case when (res -> 'passenger' ->> 'completed')::integer = 1 and (res -> 'passenger' ->> 'spent')::numeric = 6000
                      and (res -> 'passenger' ->> 'km')::numeric = 14 and (res -> 'driver' ->> 'published')::integer = 0
                 then E'\nOK  stats: passenger totals, and no data from other users' else E'\nBAD stats: passenger → ' || coalesce(res::text, 'null') end;
  perform set_config('request.jwt.claims', json_build_object('sub', pB, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  res := public.my_trip_stats();
  execute 'reset role';
  r := r || case when (res -> 'passenger' ->> 'completed')::integer = 0 and (res -> 'driver' ->> 'published')::integer = 0
                 then E'\nOK  stats: another organization sees nothing of these trips' else E'\nBAD stats: cross-organization → ' || res::text end;
  update public.app_config set beta_mode = false;
  perform set_config('request.jwt.claims', json_build_object('sub', pF, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  res := public.my_trip_stats();
  execute 'reset role';
  r := r || case when res -> 'passenger' = 'null'::jsonb and res -> 'driver' = 'null'::jsonb
                 then E'\nOK  stats: without beta, statistics are ConVía+ (server check)' else E'\nBAD stats: FREE without beta → ' || res::text end;
  update public.app_config set beta_mode = true;

  -- ================= REPETIR VIAJE =================
  -- Repetir = publicar un viaje nuevo con la configuración del anterior.
  perform set_config('request.jwt.claims', json_build_object('sub', dA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, salida_at, precio, cupos_totales, descripcion, ruta)
    select driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, now() + interval '6 days', precio, cupos_totales, descripcion, ruta
      from public.trips where id = tS
    returning id into tNew;
  execute 'reset role';
  select count(*) into n from public.trip_requests where trip_id = tNew;
  select count(*) into n2 from public.messages where trip_id = tNew;
  r := r || case when n = 0 and n2 = 0 and (select estado from public.trips where id = tNew) = 'por_empezar'
                      and (select started_at is null and finished_at is null from public.trips where id = tNew)
                      and (select ruta = v_ruta from public.trips where id = tNew)
                 then E'\nOK  repeat: a new open trip with the same route, and no requests, chat or history'
                 else E'\nBAD repeat: requests ' || n || ' messages ' || n2 end;

  -- Privacidad del vehículo antes de aceptar.
  perform set_config('request.jwt.claims', json_build_object('sub', pH, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select vehicle_placa into t from public.available_trips where id = tA;
  r := r || case when t = 'Z••••1' then E'\nOK  vehicles: passengers see the plate masked before acceptance' else E'\nBAD vehicles: plate → ' || coalesce(t, 'null') end;
  execute 'reset role';

  raise exception 'RESULTADO (todo se deshizo):%', r;
end $$;
