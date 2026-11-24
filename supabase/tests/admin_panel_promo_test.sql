-- =====================================================================
-- ConVía — panel de administración web y promoción de lanzamiento
--
-- Uso local: npx supabase db query -f supabase/tests/admin_panel_promo_test.sql
-- Todo se deshace al final (el bloque termina con RAISE EXCEPTION); el
-- mensaje de error es el reporte. Cada línea dice OK o BAD.
-- =====================================================================
do $$
declare
  uAdmin uuid := gen_random_uuid();
  uUser  uuid := gen_random_uuid();
  uCard  uuid := gen_random_uuid();
  uCard2 uuid := gen_random_uuid();
  uLate  uuid := gen_random_uuid();
  inst uuid; req uuid; req2 uuid;
  j jsonb; t text; ok boolean;
  r text := ''; bad integer;
begin
  select id into inst from public.institutions where dominio = 'unisabana.edu.co';
  delete from public.institution_requests;
  update public.institution_memberships set status = 'pending' where status = 'review';
  delete from private.admins;

  -- ================= Promoción =================
  update public.app_config set plus_promo_until = now() + interval '1 day', plus_promo_months = 2;
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role) values
    (uAdmin, 'zz.panel.admin@gmail.com', '{"nombre":"ZZ Admin"}', '{"provider":"email"}', 'authenticated', 'authenticated'),
    (uUser,  'zz.panel.user@gmail.com',  '{"nombre":"ZZ Usuario"}', '{"provider":"email"}', 'authenticated', 'authenticated'),
    (uCard,  'zz.panel.card@gmail.com',  '{"nombre":"ZZ Carne"}', '{"provider":"email"}', 'authenticated', 'authenticated'),
    (uCard2, 'zz.panel.card2@gmail.com', '{"nombre":"ZZ Carne Dos"}', '{"provider":"email"}', 'authenticated', 'authenticated');

  ok := exists (select 1 from public.subscriptions s where s.user_id = uUser and s.tier = 'plus' and s.status = 'trialing'
                  and s.provider = 'promo_lanzamiento'
                  and s.current_period_end between now() + interval '59 days' and now() + interval '62 days');
  r := r || case when ok then E'\nOK  promo: signup before the deadline gets 2 months of ConVía+'
                 else E'\nBAD promo: no trial subscription on signup' end;
  r := r || case when private.effective_tier(uUser) = 'plus' then E'\nOK  promo: the trial counts as ConVía+'
                 else E'\nBAD promo: effective tier is ' || coalesce(private.effective_tier(uUser), 'null') end;

  update public.subscriptions set current_period_end = now() - interval '1 minute' where user_id = uUser;
  r := r || case when private.effective_tier(uUser) = 'free' then E'\nOK  promo: after the end date it is the free plan'
                 else E'\nBAD promo: still plus after the end date' end;

  update public.app_config set plus_promo_until = now() - interval '1 second';
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role) values
    (uLate, 'zz.panel.late@gmail.com', '{"nombre":"ZZ Tarde"}', '{"provider":"email"}', 'authenticated', 'authenticated');
  r := r || case when not exists (select 1 from public.subscriptions where user_id = uLate)
                 then E'\nOK  promo: signup after the deadline gets nothing' else E'\nBAD promo: late signup got ConVía+' end;

  -- ================= Datos para el panel =================
  insert into private.admins (user_id) values (uAdmin);
  insert into public.institution_memberships (user_id, institution_id, status) values (uCard, inst, 'review'), (uCard2, inst, 'review')
  on conflict (user_id) do update set status = 'review', method = null, verified_at = null;
  insert into public.student_id_checks (user_id, institution_id, decision, kind, reasons)
  values (uCard, inst, 'review', 'card_photo', array['face_not_checked']),
         (uCard2, inst, 'review', 'document', array['manual']);
  insert into public.institution_requests (user_id, nombre, ciudad, rol) values (uUser, 'ZZ Universidad Nueva', 'Chía', 'estudiante')
  returning id into req;
  insert into public.institution_requests (user_id, nombre, ciudad, rol) values (uLate, 'ZZ Otra', 'Cota', 'estudiante')
  returning id into req2;

  -- ================= Usuario normal: nada =================
  perform set_config('request.jwt.claims', json_build_object('sub', uUser, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := r || case when not public.am_i_admin() then E'\nOK  am_i_admin: false for a normal user' else E'\nBAD am_i_admin: true for a normal user' end;
  begin
    perform public.admin_panel();
    r := r || E'\nBAD admin_panel: a normal user read it';
  exception when others then
    r := r || case when sqlerrm = 'NOT_ADMIN' then E'\nOK  admin_panel: NOT_ADMIN for a normal user' else E'\nBAD admin_panel: ' || sqlerrm end;
  end;
  begin
    perform public.admin_decide_membership(uCard, true);
    r := r || E'\nBAD decide: a normal user approved a card';
  exception when others then
    r := r || case when sqlerrm = 'NOT_ADMIN' then E'\nOK  decide: NOT_ADMIN for a normal user' else E'\nBAD decide: ' || sqlerrm end;
  end;
  begin
    perform public.admin_resolve_institution_request(req, 'reject', p_motivo => 'no');
    r := r || E'\nBAD resolve: a normal user resolved a request';
  exception when others then
    r := r || case when sqlerrm = 'NOT_ADMIN' then E'\nOK  resolve: NOT_ADMIN for a normal user' else E'\nBAD resolve: ' || sqlerrm end;
  end;
  execute 'reset role';

  -- ================= Administrador =================
  perform set_config('request.jwt.claims', json_build_object('sub', uAdmin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := r || case when public.am_i_admin() then E'\nOK  am_i_admin: true for the admin' else E'\nBAD am_i_admin: false for the admin' end;
  j := public.admin_panel();
  r := r || case when jsonb_array_length(j -> 'memberships') = 2 and jsonb_array_length(j -> 'requests') = 2
                      and (j -> 'memberships' -> 0 -> 'check' ->> 'kind') is not null
                      and jsonb_array_length(j -> 'institutions') > 0 and (j -> 'stats' ->> 'usuarios')::int > 0
                 then E'\nOK  admin_panel: cards in review, requests, institutions and stats'
                 else E'\nBAD admin_panel: ' || left(j::text, 300) end;

  t := public.admin_decide_membership(uCard, true);
  r := r || case when t = 'verified' then E'\nOK  decide: approve → verified' else E'\nBAD decide approve: ' || t end;
  begin
    perform public.admin_decide_membership(uCard, true);
    r := r || E'\nBAD decide: approved twice';
  exception when others then
    r := r || case when sqlerrm = 'NOT_IN_REVIEW' then E'\nOK  decide: a decided card cannot be decided again' else E'\nBAD decide twice: ' || sqlerrm end;
  end;
  begin
    perform public.admin_decide_membership(uCard2, false, 'whatever');
    r := r || E'\nBAD decide: rejected with an unknown reason';
  exception when others then
    r := r || case when sqlerrm = 'INVALID_REASON' then E'\nOK  decide: unknown reason refused' else E'\nBAD decide reason: ' || sqlerrm end;
  end;
  t := public.admin_decide_membership(uCard2, false, 'unclear');
  r := r || case when t = 'pending' then E'\nOK  decide: reject → pending' else E'\nBAD decide reject: ' || t end;

  begin
    perform public.admin_resolve_institution_request(req2, 'reject', p_motivo => 'x');
    r := r || E'\nBAD resolve: rejected without a reason';
  exception when others then
    r := r || case when sqlerrm = 'REASON_REQUIRED' then E'\nOK  resolve: reject needs a reason' else E'\nBAD resolve reason: ' || sqlerrm end;
  end;
  j := public.admin_resolve_institution_request(req2, 'reject', p_motivo => 'No es una institución');
  r := r || case when j ->> 'estado' = 'rechazada' then E'\nOK  resolve: reject' else E'\nBAD resolve reject: ' || j::text end;
  j := public.admin_resolve_institution_request(req, 'approve', p_nombre => 'ZZ Universidad Nueva', p_dominios => array['zz-nueva-prueba.edu.co']);
  execute 'reset role';
  r := r || case when j ->> 'estado' = 'aprobada' and exists (select 1 from public.institution_domains where dominio = 'zz-nueva-prueba.edu.co')
                 then E'\nOK  resolve: approve creates the institution and its domain' else E'\nBAD resolve approve: ' || j::text end;

  ok := (select count(*) from public.institution_memberships where user_id = uCard and status = 'verified' and method = 'student_card_photo') = 1
    and (select count(*) from public.institution_memberships where user_id = uCard2 and status = 'pending') = 1
    and exists (select 1 from public.student_id_checks where user_id = uCard2 and decision = 'retry'
                  and reasons = array['review_rejected', 'review_unclear'] and kind = 'document');
  r := r || case when ok then E'\nOK  decide: the app sees verified / retry with the reason'
                 else E'\nBAD decide: memberships or checks not as expected' end;

  -- ================= Permisos =================
  r := r || case when not has_function_privilege('anon', 'public.admin_panel()', 'execute')
                      and not has_function_privilege('anon', 'public.admin_decide_membership(uuid, boolean, text)', 'execute')
                 then E'\nOK  grants: anon cannot call the panel functions' else E'\nBAD grants: anon can call the panel functions' end;
  r := r || case when has_column_privilege('authenticated', 'public.app_config', 'plus_promo_until', 'select')
                      and not has_column_privilege('authenticated', 'public.app_config', 'bre_b_key', 'select')
                 then E'\nOK  grants: promo date readable, payment key still hidden' else E'\nBAD grants: app_config columns' end;

  bad := (length(r) - length(replace(r, E'\nBAD', ''))) / 4;
  raise exception 'ADMIN PANEL + PROMO — % failing:%', bad, r;
end $$;
