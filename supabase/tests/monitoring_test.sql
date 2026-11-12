-- =====================================================================
-- ConVía — errores, eventos, captura en reportes y avisos (migración 045)
--
-- Uso local: npx supabase db query -f supabase/tests/monitoring_test.sql
-- Todo se deshace al final (el bloque termina con RAISE EXCEPTION); el
-- mensaje de error es el reporte. Cada línea dice OK o BAD.
-- =====================================================================
do $$
declare
  uA  uuid := gen_random_uuid();  -- administrador
  uU1 uuid := gen_random_uuid();  -- usuario
  uU2 uuid := gen_random_uuid();  -- otro usuario
  r text := ''; n integer; bad integer; ok boolean; v_id uuid; v_props jsonb; v_text text; bodies text[];
  shot text;
begin
  delete from public.institution_requests;
  update public.institution_memberships set status = 'pending' where status = 'review';
  delete from private.admin_review_pushes;
  delete from private.admins;
  delete from public.feedback_reports;
  delete from private.admin_safety_pushes;
  delete from public.client_errors;
  delete from public.app_events;

  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role) values
    (uA,  'zz.mon.admin@gmail.com', '{"nombre":"ZZ Admin"}', '{"provider":"email"}', 'authenticated', 'authenticated'),
    (uU1, 'zz.mon.one@gmail.com',   '{"nombre":"ZZ Uno"}',   '{"provider":"email"}', 'authenticated', 'authenticated'),
    (uU2, 'zz.mon.two@gmail.com',   '{"nombre":"ZZ Dos"}',   '{"provider":"email"}', 'authenticated', 'authenticated');
  insert into private.admins (user_id) values (uA);

  -- ================= Errores, como usuario =================
  perform set_config('request.jwt.claims', json_build_object('sub', uU1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ok := public.report_client_error('Falló con zz.mon.one@gmail.com adentro', 'at foo (bar.js:1:2)', '(tabs)/index', '1.4.0', 'android', true);
  begin
    perform 1 from public.client_errors;
    r := r || E'\nBAD rls: the app read client_errors';
  exception when insufficient_privilege then r := r || E'\nOK  rls: client_errors not readable from the app'; end;
  begin
    insert into public.client_errors (message, platform) values ('directo', 'web');
    r := r || E'\nBAD rls: the app inserted into client_errors directly';
  exception when insufficient_privilege then r := r || E'\nOK  rls: client_errors only through the RPC'; end;
  execute 'reset role';

  select message into v_text from public.client_errors where user_id = uU1;
  r := r || case when ok and v_text = 'Falló con [email] adentro'
                 then E'\nOK  report_client_error: stored for the caller, e-mail scrubbed' else E'\nBAD report_client_error: ' || coalesce(v_text, 'nothing') end;
  r := r || case when exists (select 1 from public.client_errors where user_id = uU1 and fatal and platform = 'android' and app_version = '1.4.0' and screen = '(tabs)/index')
                 then E'\nOK  report_client_error: screen, version, platform and fatal kept' else E'\nBAD report_client_error: metadata lost' end;

  -- Límite: 30 por hora por usuario.
  insert into public.client_errors (user_id, message, platform) select uU1, 'relleno', 'ios' from generate_series(1, 29);
  perform set_config('request.jwt.claims', json_build_object('sub', uU1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ok := public.report_client_error('uno más', null, null, 'no válida con espacios', 'symbian', false);
  execute 'reset role';
  r := r || case when not ok and (select count(*) from public.client_errors where user_id = uU1) = 30
                 then E'\nOK  report_client_error: 31st in an hour refused' else E'\nBAD report_client_error: rate limit not applied' end;

  -- Anónimo: sin usuario; otro usuario tiene su propio cupo.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  ok := public.report_client_error('antes de iniciar sesión', null, '(auth)/login', null, 'web', false);
  execute 'reset role';
  r := r || case when ok and exists (select 1 from public.client_errors where user_id is null and message = 'antes de iniciar sesión')
                 then E'\nOK  report_client_error: anonymous errors are stored without a user' else E'\nBAD report_client_error: anonymous refused' end;
  perform set_config('request.jwt.claims', json_build_object('sub', uU2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ok := public.report_client_error('uno más', null, null, 'mala versión', 'symbian', false);
  execute 'reset role';
  r := r || case when ok and exists (select 1 from public.client_errors where user_id = uU2 and platform = 'unknown' and app_version is null)
                 then E'\nOK  report_client_error: per-user limit; bad version/platform normalized' else E'\nBAD report_client_error: other user blocked or bad metadata stored' end;

  -- ================= Eventos =================
  perform set_config('request.jwt.claims', json_build_object('sub', uU1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ok := public.track_app_event('hack_event', '{}'::jsonb, '1.4.0', 'ios');
  r := r || case when not ok then E'\nOK  track_app_event: unknown names refused' else E'\nBAD track_app_event: stored an unknown name' end;
  ok := public.track_app_event('search', jsonb_build_object('results', 3, 'saved_route', true, 'nested', jsonb_build_object('a', 1),
         'texto', repeat('x', 41), 'Mayus', 1, 'origin', 'ok'), '1.4.0', 'ios');
  begin
    perform 1 from public.app_events;
    r := r || E'\nBAD rls: the app read app_events';
  exception when insufficient_privilege then r := r || E'\nOK  rls: app_events not readable from the app'; end;
  execute 'reset role';
  select props into v_props from public.app_events where user_id = uU1 and name = 'search';
  r := r || case when ok and v_props = '{"results": 3, "saved_route": true, "origin": "ok"}'::jsonb
                 then E'\nOK  track_app_event: only short scalar props kept' else E'\nBAD track_app_event: props ' || coalesce(v_props::text, 'nothing') end;
  insert into public.app_events (user_id, name, platform) select uU1, 'login', 'ios' from generate_series(1, 199);
  perform set_config('request.jwt.claims', json_build_object('sub', uU1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ok := public.track_app_event('login', '{}'::jsonb, null, 'ios');
  execute 'reset role';
  r := r || case when not ok then E'\nOK  track_app_event: 201st in an hour refused' else E'\nBAD track_app_event: rate limit not applied' end;

  -- ================= Top de errores =================
  select count(*) into n from public.service_top_client_errors(7, 20) t where t.message = 'relleno' and t.occurrences = 29 and t.users = 1;
  r := r || case when n = 1 and (select message from public.service_top_client_errors(7, 1)) = 'relleno'
                 then E'\nOK  service_top_client_errors: grouped by message, most frequent first' else E'\nBAD service_top_client_errors' end;

  -- ================= Captura en los reportes =================
  perform set_config('request.jwt.claims', json_build_object('sub', uU1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_id := public.submit_feedback('bug', 'El mapa no carga en el inicio', '1.4.0', 'android');
  r := r || case when v_id is not null then E'\nOK  submit_feedback: four-argument calls still work' else E'\nBAD submit_feedback: 4 args' end;
  begin
    perform public.submit_feedback('bug', 'Captura de otra persona', null, 'android', uU2::text || '/' || gen_random_uuid()::text || '.jpg');
    r := r || E'\nBAD submit_feedback: accepted a screenshot outside the caller folder';
  exception when raise_exception then
    r := r || case when sqlerrm = 'FEEDBACK_SCREENSHOT_INVALID' then E'\nOK  submit_feedback: screenshot outside own folder refused' else E'\nBAD submit_feedback: ' || sqlerrm end;
  end;
  begin
    perform public.submit_feedback('bug', 'Captura que no se subió', null, 'android', uU1::text || '/' || gen_random_uuid()::text || '.jpg');
    r := r || E'\nBAD submit_feedback: accepted a screenshot that was not uploaded';
  exception when raise_exception then
    r := r || case when sqlerrm = 'FEEDBACK_SCREENSHOT_INVALID' then E'\nOK  submit_feedback: missing screenshot refused' else E'\nBAD submit_feedback: ' || sqlerrm end;
  end;
  execute 'reset role';

  -- Con captura subida a su carpeta (si storage.objects acepta la fila de prueba).
  shot := uU1::text || '/' || gen_random_uuid()::text || '.jpg';
  begin
    insert into storage.objects (bucket_id, name) values ('feedback', shot);
    perform set_config('request.jwt.claims', json_build_object('sub', uU1, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_id := public.submit_feedback('bug', 'Con captura de pantalla', '1.4.0', 'ios', shot);
    execute 'reset role';
    r := r || case when (select screenshot_path from public.feedback_reports where id = v_id) = shot
                   then E'\nOK  submit_feedback: own uploaded screenshot attached' else E'\nBAD submit_feedback: screenshot not attached' end;
    update storage.objects set created_at = now() - interval '31 days' where bucket_id = 'feedback' and name = shot;
    r := r || case when exists (select 1 from public.service_expired_feedback_files() f where f = shot)
                   then E'\nOK  cleanup: screenshots older than 30 days are listed for deletion' else E'\nBAD cleanup: expired screenshot not listed' end;
  exception when others then
    execute 'reset role';
    r := r || E'\nOK  submit_feedback: (screenshot case skipped: ' || left(sqlerrm, 60) || ')';
  end;

  -- ================= Aviso de seguridad inmediato =================
  r := r || case when not exists (select 1 from private.admin_safety_pushes)
                 then E'\nOK  safety: a bug report queues no immediate push' else E'\nBAD safety: queued for a bug report' end;
  perform set_config('request.jwt.claims', json_build_object('sub', uU2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.submit_feedback('safety', 'El conductor ZZ manejaba muy rápido', null, 'android');
  execute 'reset role';
  select array_agg(c.title || ': ' || c.body) into bodies from public.claim_admin_safety_pushes() c;
  r := r || case when bodies = array['ConVía · seguridad: 1 reporte de seguridad por revisar']
                 then E'\nOK  safety: one immediate push per admin, count only' else E'\nBAD safety: ' || coalesce(array_to_string(bodies, ' | '), 'nothing') end;
  r := r || case when array_to_string(bodies, ' ') !~ '(ZZ|rápido|@)'
                 then E'\nOK  safety: no report text or names in the push' else E'\nBAD safety: report text in the push' end;
  r := r || case when not exists (select 1 from public.claim_admin_safety_pushes())
                 then E'\nOK  safety: each push is claimed once' else E'\nBAD safety: claimed twice' end;
  perform set_config('request.jwt.claims', json_build_object('sub', uU1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.submit_feedback('safety', 'Otro reporte de seguridad', null, 'ios');
  execute 'reset role';
  select array_agg(c.body) into bodies from public.claim_admin_safety_pushes() c;
  r := r || case when bodies = array['2 reportes de seguridad por revisar']
                 then E'\nOK  safety: next report pushes again with the open count' else E'\nBAD safety: ' || coalesce(array_to_string(bodies, ' | '), 'nothing') end;

  -- ================= Aviso diario a los administradores =================
  n := private.enqueue_admin_review_pushes();
  select array_agg(c.body) into bodies from public.claim_admin_review_pushes() c;
  v_text := (select count(*)::text from public.feedback_reports where status = 'nuevo');
  r := r || case when n = 1 and bodies = array[v_text || ' reportes nuevos']
                 then E'\nOK  admin push: "' || bodies[1] || '" when only reports are pending' else E'\nBAD admin push: ' || coalesce(array_to_string(bodies, ' | '), 'nothing') end;
  update private.admin_review_pushes set dia = dia - 1;
  update public.feedback_reports set status = 'resuelto' where id <> v_id;
  insert into public.institution_memberships (user_id, institution_id, status)
    select uU2, id, 'review' from public.institutions where dominio = 'unisabana.edu.co'
  on conflict (user_id) do update set status = 'review', method = null, verified_at = null;
  n := private.enqueue_admin_review_pushes();
  select array_agg(c.body) into bodies from public.claim_admin_review_pushes() c;
  r := r || case when bodies = array['1 carné y 0 instituciones por revisar · 1 reporte nuevo']
                 then E'\nOK  admin push: cards and reports in one line, singular' else E'\nBAD admin push: ' || coalesce(array_to_string(bodies, ' | '), 'nothing') end;
  update private.admin_review_pushes set dia = dia - 1;
  update public.feedback_reports set status = 'descartado';
  n := private.enqueue_admin_review_pushes();
  select array_agg(c.body) into bodies from public.claim_admin_review_pushes() c;
  r := r || case when bodies = array['1 carné y 0 instituciones por revisar']
                 then E'\nOK  admin push: handled reports are not counted (041 text unchanged)' else E'\nBAD admin push: ' || coalesce(array_to_string(bodies, ' | '), 'nothing') end;

  -- ================= Permisos y programación =================
  r := r || case when not has_function_privilege('authenticated', 'public.service_top_client_errors(integer, integer)', 'execute')
                  and not has_function_privilege('anon', 'public.service_top_client_errors(integer, integer)', 'execute')
                  and not has_function_privilege('authenticated', 'public.service_expired_feedback_files(interval)', 'execute')
                  and not has_function_privilege('authenticated', 'public.claim_admin_safety_pushes()', 'execute')
                  and not has_function_privilege('authenticated', 'private.monitoring_allowed(text, uuid)', 'execute')
                  and has_function_privilege('authenticated', 'public.report_client_error(text, text, text, text, text, boolean)', 'execute')
                  and has_function_privilege('anon', 'public.track_app_event(text, jsonb, text, text)', 'execute')
                  and has_function_privilege('service_role', 'public.service_top_client_errors(integer, integer)', 'execute')
                 then E'\nOK  grants: insert RPCs for the app, reading only for service_role' else E'\nBAD grants: wrong function privileges' end;
  r := r || case when exists (select 1 from storage.buckets where id = 'feedback' and not public and file_size_limit = 2097152)
                 then E'\nOK  storage: feedback bucket is private, 2 MB' else E'\nBAD storage: feedback bucket missing or public' end;
  r := r || case when exists (select 1 from cron.job where jobname = 'cleanup-monitoring' and active
                               and command like '%client_errors%90 days%' and command like '%app_events%90 days%')
                 then E'\nOK  cron: cleanup-monitoring deletes errors and events after 90 days' else E'\nBAD cron: cleanup-monitoring missing' end;

  bad := (length(r) - length(replace(r, E'\nBAD', ''))) / 4;
  raise exception 'MONITORING (rolled back) — % failing:%', bad, r;
end $$;
