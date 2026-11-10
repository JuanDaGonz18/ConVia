-- =====================================================================
-- ConVía — canal de retroalimentación (migración 044)
-- Uso local: npx supabase db query -f supabase/tests/feedback_reports_test.sql
-- Todo se deshace al final (RAISE EXCEPTION); el mensaje es el reporte: OK o BAD.
-- =====================================================================
do $$
declare
  uA uuid := gen_random_uuid();
  uB uuid := gen_random_uuid();
  r text := ''; n integer; v_id uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role) values
    (uA, 'zz.feedback.a@gmail.com', '{"nombre":"ZZ A","terms_accepted":true}', '{"provider":"email"}', 'authenticated', 'authenticated'),
    (uB, 'zz.feedback.b@gmail.com', '{"nombre":"ZZ B","terms_accepted":true}', '{"provider":"email"}', 'authenticated', 'authenticated');

  perform set_config('request.jwt.claims', json_build_object('sub', uA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_id := public.submit_feedback('bug', 'La pantalla del mapa se cierra sola.', '1.0.0', 'android');
  r := r || case when v_id is not null then E'\nOK  submit: valid report is stored' else E'\nBAD submit: no id' end;

  begin perform public.submit_feedback('spam', 'texto suficientemente largo');
    r := r || E'\nBAD category: accepted an unknown category';
  exception when others then r := r || case when sqlerrm = 'FEEDBACK_CATEGORY_INVALID' then E'\nOK  category: unknown is rejected' else E'\nBAD category: ' || sqlerrm end; end;

  begin perform public.submit_feedback('bug', 'corto');
    r := r || E'\nBAD length: accepted short text';
  exception when others then r := r || case when sqlerrm = 'FEEDBACK_TOO_SHORT' then E'\nOK  length: short text is rejected' else E'\nBAD length: ' || sqlerrm end; end;

  begin perform public.submit_feedback('bug', repeat('x', 1001));
    r := r || E'\nBAD length: accepted long text';
  exception when others then r := r || case when sqlerrm = 'FEEDBACK_TOO_LONG' then E'\nOK  length: long text is rejected' else E'\nBAD length: ' || sqlerrm end; end;

  -- Sin INSERT directo, sin UPDATE ni DELETE
  begin insert into public.feedback_reports (user_id, category, description) values (uA, 'bug', 'inserción directa sin RPC');
    r := r || E'\nBAD grants: direct insert worked';
  exception when others then r := r || E'\nOK  grants: direct insert is denied'; end;
  begin update public.feedback_reports set status = 'resuelto' where id = v_id;
    r := r || E'\nBAD grants: user changed status';
  exception when others then r := r || E'\nOK  grants: user cannot change status'; end;
  begin perform team_note from public.feedback_reports;
    r := r || E'\nBAD grants: user can read team_note';
  exception when others then r := r || E'\nOK  grants: team_note is not readable'; end;

  -- Límite: 5 por hora (ya hay 1)
  for i in 1..4 loop perform public.submit_feedback('other', 'Reporte de prueba número ' || i); end loop;
  begin perform public.submit_feedback('other', 'Sexto reporte dentro de la hora');
    r := r || E'\nBAD rate: sixth report accepted';
  exception when others then r := r || case when sqlerrm = 'FEEDBACK_RATE_LIMIT' then E'\nOK  rate: sixth report in an hour is rejected' else E'\nBAD rate: ' || sqlerrm end; end;

  -- Aislamiento
  select count(*) into n from public.feedback_reports;
  r := r || case when n = 5 then E'\nOK  read: A sees its own 5' else E'\nBAD read: A sees ' || n end;
  perform set_config('request.jwt.claims', json_build_object('sub', uB, 'role', 'authenticated')::text, true);
  select count(*) into n from public.feedback_reports;
  r := r || case when n = 0 then E'\nOK  read: B sees none of A''s reports' else E'\nBAD read: B sees ' || n end;

  -- Sin sesión
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  begin perform public.submit_feedback('bug', 'Intento sin iniciar sesión');
    r := r || E'\nBAD anon: anonymous can submit';
  exception when others then r := r || E'\nOK  anon: anonymous cannot submit'; end;
  execute 'reset role';

  raise exception E'feedback_reports report:%', r;
end $$;
