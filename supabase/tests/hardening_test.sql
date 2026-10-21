-- =====================================================================
-- ConVía — pruebas de endurecimiento (base de datos real)
--  Microsoft por tenant, borrado de viajes, transiciones de estado
--  inválidas, escalamiento de privilegios, Storage y Realtime.
--
-- Uso: npx supabase db query --linked -f supabase/tests/hardening_test.sql
-- Todo se deshace al final (el bloque termina con RAISE EXCEPTION).
-- =====================================================================
do $$
declare
  dA uuid := gen_random_uuid();  -- conductor
  dX uuid := gen_random_uuid();  -- otro conductor
  pF uuid := gen_random_uuid();  -- pasajero
  pG uuid := gen_random_uuid();  -- pasajero 2
  uM uuid := gen_random_uuid();  -- usuario que entra con Microsoft
  uO uuid := gen_random_uuid();  -- usuario de otro dominio
  vA uuid; vX uuid; tA uuid; tE uuid; tOne uuid; rq uuid; rq2 uuid; v_token uuid;
  v_tenant text := '11111111-2222-3333-4444-555555555555';
  v_inst uuid;
  r text := ''; n integer; ok boolean;
begin
  update public.app_config set beta_mode = true;
  insert into public.institutions (nombre, tipo, dominio) values ('Org O (prueba)', 'universidad', 'orgo-prueba.edu.co');
  insert into auth.users (id, email, raw_user_meta_data, aud, role) values
    (dA, 'zz.hd.a@unisabana.edu.co', '{"nombre":"ZZ A","rol":"conductor"}', 'authenticated', 'authenticated'),
    (dX, 'zz.hd.x@unisabana.edu.co', '{"nombre":"ZZ X","rol":"conductor"}', 'authenticated', 'authenticated'),
    (pF, 'zz.hd.f@unisabana.edu.co', '{"nombre":"ZZ F"}', 'authenticated', 'authenticated'),
    (pG, 'zz.hd.g@unisabana.edu.co', '{"nombre":"ZZ G"}', 'authenticated', 'authenticated'),
    (uM, 'zz.hd.m@unisabana.edu.co', '{"full_name":"ZZ Microsoft Persona"}', 'authenticated', 'authenticated'),
    (uO, 'zz.hd.o@orgo-prueba.edu.co', '{"nombre":"ZZ O"}', 'authenticated', 'authenticated');
  update public.profiles set verification_status = 'verificado' where id in (dA, dX, pF, pG);
  insert into public.driver_profiles (user_id, status) values (dA, 'aprobado'), (dX, 'aprobado')
    on conflict (user_id) do update set status = 'aprobado';
  insert into public.face_verifications (user_id, status, provider, purpose, template_kind)
    select u, 'verificado', 'on_device_sface', 'trip_request', 'selfie' from unnest(array[pF, pG]) u;
  insert into public.face_verifications (user_id, status, provider, purpose, template_kind)
    select u, 'verificado', 'on_device_sface', 'driver_identity', 'license' from unnest(array[dA, dX]) u;
  insert into public.vehicles (driver_id, placa, marca, color, puestos) values (dA, 'ZZH901', 'Uno', 'Gris', 4) returning id into vA;
  insert into public.vehicles (driver_id, placa, marca, color, puestos) values (dX, 'ZZH902', 'Dos', 'Azul', 4) returning id into vX;
  insert into public.trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, salida_at, precio, cupos_totales)
    values (dA, vA, 'U', 4.86, -74.03, 'Siberia', 4.76, -74.13, now() + interval '1 day', 5000, 3) returning id into tA;
  insert into public.trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, salida_at, precio, cupos_totales)
    values (dA, vA, 'U', 4.86, -74.03, 'Chía', 4.86, -74.06, now() + interval '3 days', 5000, 3) returning id into tE;
  insert into public.trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, salida_at, precio, cupos_totales)
    values (dX, vX, 'U', 4.86, -74.03, 'Cota', 4.81, -74.10, now() + interval '2 days', 5000, 1) returning id into tOne;
  insert into public.trip_requests (trip_id, passenger_id, direccion, estado) values (tA, pF, 'Calle 1', 'pendiente') returning id, qr_token into rq, v_token;

  -- ================= MICROSOFT: TENANT AUTORIZADO =================
  r := r || case when (select nombre from public.profiles where id = uM) = 'ZZ Microsoft Persona'
                 then E'\nOK  microsoft: profile name taken from the Microsoft full_name' else E'\nBAD microsoft: profile name' end;
  begin
    insert into auth.identities (provider_id, user_id, provider, identity_data, last_sign_in_at)
      values ('ms-1', uM, 'azure', jsonb_build_object('sub', 'ms-1', 'email', 'zz.hd.m@unisabana.edu.co', 'custom_claims', jsonb_build_object('tid', v_tenant)), now());
    r := r || E'\nBAD microsoft: an unlisted tenant was accepted';
  exception when others then
    r := r || case when sqlerrm like 'TENANT_NO_AUTORIZADO%' then E'\nOK  microsoft: tenants outside the allowlist are rejected' else E'\nBAD microsoft: ' || sqlerrm end;
  end;
  select id into v_inst from public.institutions where dominio = 'unisabana.edu.co';
  insert into public.institution_identity_providers (provider, tenant_id, institution_id) values ('azure', v_tenant, v_inst);
  begin
    insert into auth.identities (provider_id, user_id, provider, identity_data, last_sign_in_at)
      values ('ms-2', uM, 'azure', jsonb_build_object('sub', 'ms-2', 'email', 'zz.hd.m@unisabana.edu.co', 'custom_claims', jsonb_build_object('tid', upper(v_tenant))), now());
    r := r || E'\nOK  microsoft: an allowlisted tenant with the institution''s domain is accepted';
  exception when others then r := r || E'\nBAD microsoft: allowed tenant rejected: ' || sqlerrm; end;
  begin
    insert into auth.identities (provider_id, user_id, provider, identity_data, last_sign_in_at)
      values ('ms-3', uM, 'azure', jsonb_build_object('sub', 'ms-3', 'email', 'zz.hd.m@unisabana.edu.co', 'iss', 'https://login.microsoftonline.com/' || v_tenant || '/v2.0'), now());
    r := r || E'\nOK  microsoft: the tenant is also read from the issuer';
  exception when others then r := r || E'\nBAD microsoft: issuer form rejected: ' || sqlerrm; end;
  begin
    insert into auth.identities (provider_id, user_id, provider, identity_data, last_sign_in_at)
      values ('ms-4', uO, 'azure', jsonb_build_object('sub', 'ms-4', 'email', 'zz.hd.o@orgo-prueba.edu.co', 'custom_claims', jsonb_build_object('tid', v_tenant)), now());
    r := r || E'\nBAD microsoft: a tenant was accepted for another institution''s domain';
  exception when others then r := r || E'\nOK  microsoft: a tenant only signs in its own institution''s domain'; end;
  begin
    insert into auth.identities (provider_id, user_id, provider, identity_data, last_sign_in_at)
      values ('ms-5', uM, 'azure', jsonb_build_object('sub', 'ms-5', 'email', 'zz.hd.m@unisabana.edu.co'), now());
    r := r || E'\nBAD microsoft: an identity without tenant was accepted';
  exception when others then r := r || E'\nOK  microsoft: no tenant in the identity → rejected (fails closed)'; end;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', pF, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into public.institution_identity_providers (provider, tenant_id, institution_id) values ('azure', '99999999-2222-3333-4444-555555555555', v_inst);
    r := r || E'\nBAD microsoft: a user added a tenant';
  exception when others then r := r || E'\nOK  microsoft: users cannot read or change the tenant allowlist'; end;
  execute 'reset role';

  -- ================= BORRAR VIAJES =================
  perform set_config('request.jwt.claims', json_build_object('sub', dA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  delete from public.trips where id = tA;
  delete from public.trips where id = tE;
  execute 'reset role';
  r := r || case when exists (select 1 from public.trips where id = tA) and exists (select 1 from public.trip_requests where id = rq)
                 then E'\nOK  trips: a trip with pending requests cannot be deleted (cancel_trip notifies)' else E'\nBAD trips: deleted a trip with a pending request' end;
  r := r || case when not exists (select 1 from public.trips where id = tE)
                 then E'\nOK  trips: a driver can still delete an unrequested trip' else E'\nBAD trips: unrequested trip not deleted' end;

  -- ================= TRANSICIONES INVÁLIDAS =================
  perform set_config('request.jwt.claims', json_build_object('sub', pF, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.start_trip(tA); r := r || E'\nBAD state: a passenger started the trip';
  exception when others then r := r || E'\nOK  state: only the driver starts a trip'; end;
  begin perform public.respond_trip_request(rq, true); r := r || E'\nBAD state: a passenger accepted a request';
  exception when others then r := r || E'\nOK  state: only the trip''s driver accepts requests'; end;
  begin
    insert into public.trip_requests (trip_id, passenger_id, direccion, estado) values (tA, pF, 'Otra', 'pendiente');
    r := r || E'\nBAD state: two active requests for the same trip';
  exception when others then r := r || E'\nOK  state: no duplicate active request (double booking)'; end;
  begin
    insert into public.trip_requests (trip_id, passenger_id, direccion, estado) values (tOne, pF, 'Calle', 'aceptado');
    r := r || E'\nBAD state: a passenger self-accepted';
  exception when others then r := r || E'\nOK  state: a request cannot be created already accepted'; end;
  begin update public.trips set estado = 'finalizado' where id = tA; exception when others then null; end;
  begin update public.trip_requests set estado = 'aceptado' where id = rq; exception when others then null; end;
  execute 'reset role';
  r := r || case when (select estado from public.trips where id = tA) = 'por_empezar' and (select estado from public.trip_requests where id = rq) = 'pendiente'
                 then E'\nOK  state: trips and requests cannot change state by direct update' else E'\nBAD state: direct state update worked' end;

  perform set_config('request.jwt.claims', json_build_object('sub', dX, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.respond_trip_request(rq, true); r := r || E'\nBAD state: another driver accepted the request';
  exception when others then r := r || E'\nOK  state: another driver cannot answer the request'; end;
  begin perform public.finish_trip(tA); r := r || E'\nBAD state: another driver finished the trip';
  exception when others then r := r || E'\nOK  state: another driver cannot finish the trip'; end;
  begin perform public.cancel_trip(tA); r := r || E'\nBAD state: another driver cancelled the trip';
  exception when others then r := r || E'\nOK  state: another driver cannot cancel the trip'; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', dA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.board_passenger(v_token); r := r || E'\nBAD state: boarded a passenger that was never accepted';
  exception when others then r := r || E'\nOK  state: only accepted passengers can board'; end;
  begin perform public.finish_trip(tA); r := r || E'\nBAD state: finished a trip that never started';
  exception when others then r := r || E'\nOK  state: a trip must be in progress to finish'; end;
  begin
    insert into public.trip_requests (trip_id, passenger_id, direccion, estado) values (tA, dA, 'Mía', 'pendiente');
    r := r || E'\nBAD state: a driver requested a seat on their own trip';
  exception when others then r := r || E'\nOK  state: no requests on one''s own trip'; end;
  execute 'reset role';

  -- Cupo lleno: el segundo pasajero no puede ser aceptado.
  insert into public.trip_requests (trip_id, passenger_id, direccion, estado) values (tOne, pF, 'Calle', 'pendiente') returning id into rq;
  insert into public.trip_requests (trip_id, passenger_id, direccion, estado) values (tOne, pG, 'Calle', 'pendiente') returning id into rq2;
  perform set_config('request.jwt.claims', json_build_object('sub', dX, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.respond_trip_request(rq, true);
  begin perform public.respond_trip_request(rq2, true); r := r || E'\nBAD state: accepted more passengers than seats';
  exception when others then r := r || E'\nOK  state: a full trip accepts no more passengers'; end;
  execute 'reset role';

  -- ================= ESCALAMIENTO DE PRIVILEGIOS =================
  perform set_config('request.jwt.claims', json_build_object('sub', pG, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin update public.profiles set verification_status = 'verificado' where id = pG; r := r || E'\nBAD privilege: user changed verification_status';
  exception when others then r := r || E'\nOK  privilege: identity verification cannot be self-assigned'; end;
  begin update public.profiles set institution_id = null where id = pG; r := r || E'\nBAD privilege: user changed their institution';
  exception when others then r := r || E'\nOK  privilege: users cannot change their organization'; end;
  begin insert into public.driver_profiles (user_id, status) values (pG, 'aprobado'); r := r || E'\nBAD privilege: user approved themself as driver';
  exception when others then r := r || E'\nOK  privilege: driver approval cannot be self-assigned'; end;
  begin perform public.set_verification_result(gen_random_uuid(), 'verificado', 1, null); r := r || E'\nBAD privilege: set_verification_result callable';
  exception when others then r := r || E'\nOK  privilege: verification results only from the server'; end;
  begin
    insert into public.face_verifications (user_id, status, provider, purpose, template_kind) values (pG, 'verificado', 'x', 'trip_request', 'selfie');
    r := r || E'\nBAD privilege: user inserted a verified face check';
  exception when others then r := r || E'\nOK  privilege: face checks start as "procesando" only'; end;
  update public.profiles set nombre = 'Hackeado' where id = pF;
  execute 'reset role';
  r := r || case when (select nombre from public.profiles where id = pF) = 'ZZ F'
                 then E'\nOK  privilege: users cannot edit other profiles' else E'\nBAD privilege: edited another profile' end;

  -- ================= STORAGE =================
  perform set_config('request.jwt.claims', json_build_object('sub', pG, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into storage.objects (bucket_id, name, owner) values ('avatars', pF::text || '/avatar.jpg', pG);
    r := r || E'\nBAD storage: uploaded into another user''s folder';
  exception when others then r := r || E'\nOK  storage: users only upload into their own folder'; end;
  execute 'reset role';
  r := r || case when (select file_size_limit from storage.buckets where id = 'avatars') <= 3145728
                      and (select file_size_limit from storage.buckets where id = 'vehicle-photos') <= 4194304
                      and (select allowed_mime_types from storage.buckets where id = 'avatars') <@ array['image/jpeg','image/png','image/webp']
                 then E'\nOK  storage: size and image-type limits on both buckets' else E'\nBAD storage: bucket limits' end;

  -- ================= REALTIME =================
  r := r || case when not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('trips', 'trip_locations'))
                      and exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages')
                 then E'\nOK  realtime: only tables the app listens to are published' else E'\nBAD realtime: publication' end;
  r := r || case when (select count(*) from cron.job where jobname in ('cleanup-logs', 'cleanup-alert-hits')) = 2
                 then E'\nOK  cleanup: scheduled cleanup of cron history and old alerts' else E'\nBAD cleanup: jobs missing' end;

  -- ================= EGRESS: RUTA PÚBLICA =================
  declare
    v_long jsonb := jsonb_build_object('km', 30, 'minutes', 45, 'via', '[]'::jsonb, 'coords',
      (select jsonb_agg(jsonb_build_array(-74.0 - g * 0.001234567, 4.86 - g * 0.000654321) order by g) from generate_series(0, 299) g));
    v_pub jsonb := private.public_route(v_long);
    v_first jsonb := v_pub -> 'coords' -> 0;
  begin
    r := r || case when jsonb_array_length(v_pub -> 'coords') <= 120
                        and private.km((v_first ->> 1)::double precision, (v_first ->> 0)::double precision, 4.86, -74.0) >= 0.5
                        and length(v_first ->> 0) <= length('-74.12345')
                        and (v_pub ->> 'km')::numeric = 30
                   then E'\nOK  egress: public route ≤ 120 points, 5 decimals, ends still trimmed by 500 m'
                   else E'\nBAD egress: public route → ' || jsonb_array_length(v_pub -> 'coords') || ' points, first ' || v_first::text end;
  end;

  raise exception 'RESULTADO (todo se deshizo):%', r;
end $$;
