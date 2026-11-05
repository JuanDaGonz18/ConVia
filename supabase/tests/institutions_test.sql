-- =====================================================================
-- ConVía — registro abierto e instituciones verificadas (migraciones 036–039)
--
-- Uso local: npx supabase db query --local -f supabase/tests/institutions_test.sql
-- Todo se deshace al final (el bloque termina con RAISE EXCEPTION); el
-- mensaje de error es el reporte. Cada línea dice OK o BAD.
-- =====================================================================
do $$
declare
  uI uuid := gen_random_uuid();  -- correo institucional
  uO uuid := gen_random_uuid();  -- correo cualquiera
  uM uuid := gen_random_uuid();  -- Microsoft (azure) con dominio institucional
  inst uuid; other uuid; v uuid; rq uuid; j jsonb;
  r text := ''; n integer; bad integer;
  v_ruta jsonb := '{"coords": [[-74.033, 4.8615], [-74.13, 4.765]], "km": 14, "minutes": 25, "via": []}';
begin
  select id into inst from public.institutions where dominio = 'unisabana.edu.co';

  -- ================= Registro =================
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role) values
    (uI, 'zz.inst@unisabana.edu.co', '{"nombre":"ZZ Inst","rol":"administrador"}', '{"provider":"email"}', 'authenticated', 'authenticated'),
    (uO, 'zz.open@gmail.com',        '{"nombre":"ZZ Open"}',                       '{"provider":"email"}', 'authenticated', 'authenticated'),
    (uM, 'zz.ms@unisabana.edu.co',   '{"full_name":"ZZ Microsoft"}',               '{"provider":"azure"}', 'authenticated', 'authenticated');

  r := r || case when (select institution_id from public.profiles where id = uI) = inst
                  and exists (select 1 from public.institution_memberships where user_id = uI and status = 'verified' and method = 'institutional_email')
                 then E'\nOK  signup: institutional e-mail is verified at once'
                 else E'\nBAD signup: institutional e-mail not verified' end;
  r := r || case when (select rol from public.profiles where id = uI) = 'usuario'
                 then E'\nOK  signup: role is always usuario (metadata ignored)'
                 else E'\nBAD signup: role taken from metadata' end;
  r := r || case when (select institution_id from public.profiles where id = uO) is null
                  and not exists (select 1 from public.institution_memberships where user_id = uO)
                 then E'\nOK  signup: any other e-mail can register, with no institution'
                 else E'\nBAD signup: open e-mail got an institution' end;
  r := r || case when exists (select 1 from public.institution_memberships where user_id = uM and status = 'verified' and method = 'microsoft')
                  and (select nombre from public.profiles where id = uM) = 'ZZ Microsoft'
                 then E'\nOK  signup: Microsoft sign-up verified as microsoft, name from full_name'
                 else E'\nBAD signup: Microsoft sign-up' end;

  -- Una institución creada como antes (solo institutions) reconoce su dominio.
  insert into public.institutions (nombre, tipo, dominio) values ('ZZ Org (prueba)', 'universidad', 'zzorg-prueba.edu.co') returning id into other;
  r := r || case when exists (select 1 from public.institution_domains where dominio = 'zzorg-prueba.edu.co' and institution_id = other)
                 then E'\nOK  domains: the main domain is added to institution_domains'
                 else E'\nBAD domains: main domain missing' end;

  -- ================= Usuario pendiente =================
  -- uO also drives (as the audit test sets up drivers), so only the institution can stop the trip.
  update public.profiles set rol = 'conductor', verification_status = 'verificado', telefono = '3000000000' where id = uO;
  insert into public.driver_profiles (user_id, status) values (uO, 'aprobado') on conflict (user_id) do update set status = 'aprobado';
  insert into public.face_verifications (user_id, status, provider, purpose, template_kind) values (uO, 'verificado', 'on_device_sface', 'driver_identity', 'license');
  insert into public.vehicles (driver_id, placa, marca, color, puestos) values (uO, 'ZZO123', 'Prueba', 'Gris', 4) returning id into v;
  begin
    insert into public.trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, salida_at, precio, cupos_totales, ruta)
      values (uO, v, 'A', 4.86, -74.03, 'B', 4.76, -74.13, now() + interval '1 day', 5000, 3, v_ruta);
    r := r || E'\nBAD pending: published a trip without a verified institution';
  exception when others then
    r := r || case when sqlerrm = 'INSTITUTION_NOT_VERIFIED' then E'\nOK  pending: cannot publish a trip (INSTITUTION_NOT_VERIFIED)'
                   else E'\nBAD pending: unexpected error ' || sqlerrm end;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', uO, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform 1 from public.institutions limit 1; r := r || E'\nBAD privacy: institutions list readable';
  exception when insufficient_privilege then r := r || E'\nOK  privacy: the institutions list is not readable directly'; end;
  select count(*) into n from public.search_institutions('sa');
  r := r || case when n = 0 then E'\nOK  search: fewer than 3 letters returns nothing' else E'\nBAD search: 2 letters returned ' || n end;
  select count(*) into n from public.search_institutions('%%%');
  r := r || case when n = 0 then E'\nOK  search: % is literal, not a wildcard' else E'\nBAD search: %%% matched ' || n end;
  select count(*) into n from public.search_institutions('SABANA');
  r := r || case when n >= 1 then E'\nOK  search: case and accents ignored' else E'\nBAD search: SABANA not found' end;
  perform public.choose_institution(inst);
  j := public.my_institution();
  r := r || case when j ->> 'status' = 'pending' and j -> 'institution' ->> 'id' = inst::text
                 then E'\nOK  choose: the chosen institution stays pending' else E'\nBAD choose: ' || j::text end;
  r := r || case when (select institution_id from public.profiles where id = uO) is null
                 then E'\nOK  choose: choosing does not fill profiles.institution_id' else E'\nBAD choose: institution_id set before verifying' end;
  begin update public.institution_memberships set status = 'verified' where user_id = uO; r := r || E'\nBAD membership: user updated their own status';
  exception when insufficient_privilege then r := r || E'\nOK  membership: users cannot change their status'; end;
  begin perform public.service_set_membership_status(uO, 'verified', 'student_card_photo'); r := r || E'\nBAD membership: app can verify itself';
  exception when insufficient_privilege then r := r || E'\nOK  membership: service_set_membership_status not callable from the app'; end;
  begin perform private.verify_membership(uO, 'document'); r := r || E'\nBAD membership: verify_membership callable';
  exception when insufficient_privilege then r := r || E'\nOK  membership: private.verify_membership not callable from the app'; end;
  perform public.request_institution('ZZ Universidad Nueva', 'Bogotá', null, 'estudiante');
  begin perform public.request_institution('ZZ Otra', 'Bogotá', null, 'estudiante'); r := r || E'\nBAD request: two pending requests';
  exception when others then r := r || case when sqlerrm = 'REQUEST_PENDING' then E'\nOK  request: one pending request per user' else E'\nBAD request: ' || sqlerrm end; end;
  execute 'reset role';

  -- ================= Verificación (Edge Function, service_role) =================
  execute 'set local role service_role';
  perform public.service_set_membership_status(uO, 'review');
  execute 'reset role';
  r := r || case when (select status from public.institution_memberships where user_id = uO) = 'review'
                 then E'\nOK  review: a card check can send the membership to manual review' else E'\nBAD review status' end;
  perform private.approve_membership(uO, 'document');
  r := r || case when (select institution_id from public.profiles where id = uO) = inst
                  and (select method from public.institution_memberships where user_id = uO) = 'document'
                 then E'\nOK  approve: a reviewer approval fills profiles.institution_id' else E'\nBAD approve' end;
  insert into public.trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, salida_at, precio, cupos_totales, ruta)
    values (uO, v, 'A', 4.86, -74.03, 'B', 4.76, -74.13, now() + interval '1 day', 5000, 3, v_ruta);
  r := r || E'\nOK  verified: can publish once the membership is verified';

  -- institution_id without a verified membership (e.g. set by hand) is not enough.
  update public.institution_memberships set status = 'pending', method = null, verified_at = null where user_id = uO;
  begin
    insert into public.trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, salida_at, precio, cupos_totales, ruta)
      values (uO, v, 'A', 4.86, -74.03, 'B', 4.76, -74.13, now() + interval '2 day', 5000, 3, v_ruta);
    r := r || E'\nBAD 039: institution_id alone let a trip through';
  exception when others then
    r := r || case when sqlerrm = 'INSTITUTION_NOT_VERIFIED' then E'\nOK  039: profiles.institution_id alone is not enough' else E'\nBAD 039: ' || sqlerrm end;
  end;

  -- ================= Solicitudes de institución =================
  select id into rq from public.institution_requests where user_id = uO and estado = 'pendiente';
  execute 'set local role service_role';
  begin perform public.service_resolve_institution_request(rq, 'approve', null, array['unisabana.edu.co']); r := r || E'\nBAD resolve: took a domain owned by another institution';
  exception when others then r := r || case when sqlerrm like 'DOMAIN_TAKEN%' then E'\nOK  resolve: a domain cannot be taken from another institution' else E'\nBAD resolve: ' || sqlerrm end; end;
  j := public.service_resolve_institution_request(rq, 'approve', null, array['zznueva-prueba.edu.co']);
  execute 'reset role';
  r := r || case when j ->> 'estado' = 'aprobada' and exists (select 1 from public.institution_domains where dominio = 'zznueva-prueba.edu.co')
                 then E'\nOK  resolve: approve creates the institution and its domain' else E'\nBAD resolve approve: ' || j::text end;

  -- ================= Limpieza de imágenes de revisión =================
  r := r || case when exists (select 1 from cron.job where jobname = 'cleanup-card-review-files')
                  and pg_get_functiondef('private.dispatch_card_review_cleanup()'::regprocedure) like '%x-convia-cron%'
                 then E'\nOK  cleanup: daily job, sends the cron secret' else E'\nBAD cleanup job or header' end;

  -- ================= Privilegios =================
  r := r || case when not has_table_privilege('anon', 'public.institution_memberships', 'select')
                  and not has_table_privilege('authenticated', 'public.institution_memberships', 'insert')
                  and not has_table_privilege('authenticated', 'public.student_id_checks', 'insert')
                  and not has_table_privilege('authenticated', 'public.institution_domains', 'select')
                 then E'\nOK  grants: new tables are read-own only' else E'\nBAD grants on new tables' end;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'private' and p.proname in ('verify_membership', 'approve_membership', 'recheck_institution_email',
         'dispatch_card_review_cleanup', 'require_verified_institution', 'add_main_institution_domain', 'azure_identity_guard')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'));
  r := r || case when n = 0 then E'\nOK  grants: new private functions not executable by the app' else E'\nBAD grants: ' || n || ' private functions executable' end;

  bad := (length(r) - length(replace(r, E'\nBAD', ''))) / 4;
  raise exception 'INSTITUTIONS (rolled back) — % failing:%', bad, r;
end $$;
