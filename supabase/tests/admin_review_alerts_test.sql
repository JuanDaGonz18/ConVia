-- =====================================================================
-- ConVía — aviso de revisión manual a los administradores (migración 041)
--
-- Uso local: npx supabase db query -f supabase/tests/admin_review_alerts_test.sql
-- Todo se deshace al final (el bloque termina con RAISE EXCEPTION); el
-- mensaje de error es el reporte. Cada línea dice OK o BAD.
-- =====================================================================
do $$
declare
  uA1 uuid := gen_random_uuid();  -- administrador
  uA2 uuid := gen_random_uuid();  -- administrador
  uU1 uuid := gen_random_uuid();  -- usuario con carné en revisión y solicitud de institución
  uU2 uuid := gen_random_uuid();  -- segundo carné en revisión
  inst uuid;
  r text := ''; n integer; bad integer; bodies text[];
begin
  select id into inst from public.institutions where dominio = 'unisabana.edu.co';

  -- Punto de partida limpio (todo se deshace al final).
  delete from public.institution_requests;
  update public.institution_memberships set status = 'pending' where status = 'review';
  delete from private.admin_review_pushes;
  delete from private.admins;

  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role) values
    (uA1, 'zz.admin.one@gmail.com', '{"nombre":"ZZ Admin Uno"}', '{"provider":"email"}', 'authenticated', 'authenticated'),
    (uA2, 'zz.admin.two@gmail.com', '{"nombre":"ZZ Admin Dos"}', '{"provider":"email"}', 'authenticated', 'authenticated'),
    (uU1, 'zz.review.one@gmail.com', '{"nombre":"ZZ Persona Secreta"}', '{"provider":"email"}', 'authenticated', 'authenticated'),
    (uU2, 'zz.review.two@gmail.com', '{"nombre":"ZZ Persona Dos"}', '{"provider":"email"}', 'authenticated', 'authenticated');
  insert into private.admins (user_id) values (uA1), (uA2);

  -- ================= Nada por revisar =================
  n := private.enqueue_admin_review_pushes();
  r := r || case when n = 0 and not exists (select 1 from private.admin_review_pushes)
                 then E'\nOK  enqueue: nothing pending → no push' else E'\nBAD enqueue: queued with 0 and 0' end;

  -- ================= Un carné y una institución =================
  insert into public.institution_memberships (user_id, institution_id, status) values (uU1, inst, 'review')
  on conflict (user_id) do update set status = 'review', method = null, verified_at = null;
  insert into public.institution_requests (user_id, nombre, ciudad, rol) values (uU1, 'ZZ Colegio Secreto', 'Bogotá', 'estudiante');

  n := private.enqueue_admin_review_pushes();
  r := r || case when n = 2 and (select count(*) from private.admin_review_pushes where pushed_at is null) = 2
                 then E'\nOK  enqueue: one push per admin' else E'\nBAD enqueue: ' || n || ' queued' end;
  n := private.enqueue_admin_review_pushes();
  r := r || case when n = 0 and (select count(*) from private.admin_review_pushes) = 2
                 then E'\nOK  enqueue: second run the same day queues nothing' else E'\nBAD enqueue: duplicated the same day' end;

  select array_agg(c.title || ': ' || c.body order by c.user_id) into bodies from public.claim_admin_review_pushes() c;
  r := r || case when cardinality(bodies) = 2 and bodies[1] = 'ConVía: 1 carné y 1 institución por revisar' and bodies[2] = bodies[1]
                 then E'\nOK  claim: "ConVía: 1 carné y 1 institución por revisar" for each admin'
                 else E'\nBAD claim: ' || coalesce(array_to_string(bodies, ' | '), 'nothing') end;
  r := r || case when array_to_string(bodies, ' ') !~ '(ZZ|Secret|@)'
                 then E'\nOK  claim: no names, institution names or e-mails in the text' else E'\nBAD claim: personal data in the text' end;
  r := r || case when not exists (select 1 from public.claim_admin_review_pushes())
                 then E'\nOK  claim: each push is claimed once' else E'\nBAD claim: claimed twice' end;
  n := private.enqueue_admin_review_pushes();
  r := r || case when n = 0 then E'\nOK  enqueue: already sent today → nothing new' else E'\nBAD enqueue: sent twice in a day' end;

  -- ================= Plural; otro día =================
  insert into public.institution_memberships (user_id, institution_id, status) values (uU2, inst, 'review')
  on conflict (user_id) do update set status = 'review', method = null, verified_at = null;
  update private.admin_review_pushes set dia = dia - 1;  -- lo de "ayer"
  delete from private.admins where user_id = uA2;
  n := private.enqueue_admin_review_pushes();
  select array_agg(c.body) into bodies from public.claim_admin_review_pushes() c;
  r := r || case when n = 1 and bodies = array['2 carnés y 1 institución por revisar']
                 then E'\nOK  next day: a new push, plural, only for current admins' else E'\nBAD next day: ' || n || ' / ' || coalesce(array_to_string(bodies, ' | '), 'nothing') end;

  -- Un aviso de un día anterior que nunca salió no se manda después.
  insert into private.admin_review_pushes (user_id, dia, carnes, instituciones) values (uA2, current_date - 5, 1, 0);
  r := r || case when not exists (select 1 from public.claim_admin_review_pushes())
                 then E'\nOK  claim: stale pushes from earlier days are not sent' else E'\nBAD claim: sent an old push' end;

  -- ================= Programación =================
  r := r || case when exists (select 1 from cron.job where jobname = 'admin-review-alerts' and schedule = '0 12,22 * * *' and active)
                 then E'\nOK  cron: admin-review-alerts at 12:00 and 22:00 UTC' else E'\nBAD cron: job missing or wrong schedule' end;

  -- ================= Permisos =================
  r := r || case when not has_table_privilege('authenticated', 'private.admins', 'select')
                  and not has_table_privilege('anon', 'private.admins', 'select')
                  and not has_table_privilege('authenticated', 'private.admins', 'insert')
                  and not has_table_privilege('authenticated', 'private.admin_review_pushes', 'select')
                  and has_table_privilege('service_role', 'private.admins', 'insert')
                 then E'\nOK  grants: admins and the queue are service_role only' else E'\nBAD grants: tables reachable by the app' end;
  r := r || case when not has_function_privilege('authenticated', 'public.claim_admin_review_pushes()', 'execute')
                  and not has_function_privilege('anon', 'public.claim_admin_review_pushes()', 'execute')
                  and not has_function_privilege('authenticated', 'private.enqueue_admin_review_pushes()', 'execute')
                  and has_function_privilege('service_role', 'public.claim_admin_review_pushes()', 'execute')
                 then E'\nOK  grants: claim and enqueue not callable by the app' else E'\nBAD grants: functions callable by the app' end;

  perform set_config('request.jwt.claims', json_build_object('sub', uA1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform 1 from private.admins;
    r := r || E'\nBAD rls: an admin read private.admins from the app';
  exception when insufficient_privilege then r := r || E'\nOK  rls: private.admins not readable even by an admin'; end;
  begin
    perform public.claim_admin_review_pushes();
    r := r || E'\nBAD rls: claimed from the app';
  exception when insufficient_privilege then r := r || E'\nOK  rls: claim refused from the app'; end;
  execute 'reset role';

  bad := (length(r) - length(replace(r, E'\nBAD', ''))) / 4;
  raise exception 'ADMIN REVIEW ALERTS (rolled back) — % failing:%', bad, r;
end $$;
