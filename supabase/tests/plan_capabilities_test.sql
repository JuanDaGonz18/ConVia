-- =====================================================================
-- ConVía — pruebas de planes, capacidades y modo beta (base de datos real)
--
-- Uso: npx supabase db query --linked -f supabase/tests/plan_capabilities_test.sql
-- Todo se deshace al final (el bloque termina con RAISE EXCEPTION); el
-- mensaje de error es el reporte. Cada línea dice OK o BAD.
-- =====================================================================
do $$
declare
  dF uuid := gen_random_uuid();  -- conductor FREE
  pP uuid := gen_random_uuid();  -- ConVía+ activo
  pE uuid := gen_random_uuid();  -- ConVía+ vencido
  r text := ''; t text; n integer; ok boolean; caps text[]; v_beta boolean;
  bad integer;
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role) values
    (dF, 'zz.free@unisabana.edu.co',    '{"nombre":"ZZ Free","rol":"conductor"}', 'authenticated', 'authenticated'),
    (pP, 'zz.plus@unisabana.edu.co',    '{"nombre":"ZZ Plus"}',    'authenticated', 'authenticated'),
    (pE, 'zz.expired@unisabana.edu.co', '{"nombre":"ZZ Expired"}', 'authenticated', 'authenticated');
  insert into public.subscriptions (user_id, tier, status, provider, current_period_end) values
    (pP, 'plus', 'active', 'manual', null),
    (pE, 'plus', 'active', 'manual', now() - interval '1 day');
  update public.app_config set beta_mode = true;

  -- ================= BETA ACTIVA =================
  perform set_config('request.jwt.claims', json_build_object('sub', dF, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select p.tier, p.beta_mode, p.capabilities into t, v_beta, caps from public.get_my_plan() p;
  r := r || case when t = 'free' and v_beta then E'\nOK  beta: FREE user is still FREE, beta reported' else E'\nBAD beta: plan → ' || coalesce(t, 'null') end;
  r := r || case when 'multiple_vehicles' = any(caps) and 'repeat_trip' = any(caps) and 'unlimited_results' = any(caps)
                 then E'\nOK  beta: FREE gets beta-unlocked ConVía+ capabilities' else E'\nBAD beta: missing beta capabilities ' || caps::text end;
  r := r || case when not ('google_maps' = any(caps)) and not ('map_traffic' = any(caps)) and not ('smart_match_priority' = any(caps)) and not ('plus_badge' = any(caps))
                 then E'\nOK  beta: maps, priority and badge still follow the real plan' else E'\nBAD beta: real-plan capabilities leaked ' || caps::text end;
  select (p.limits ->> 'vehicles') || '/' || (p.plan_limits ->> 'vehicles') into t from public.get_my_plan() p;
  r := r || case when t = '10/1' then E'\nOK  beta: effective vehicle limit relaxed (10), plan limit kept (1)' else E'\nBAD beta: vehicle limits → ' || coalesce(t, 'null') end;
  begin
    insert into public.vehicles (driver_id, placa, marca, color, puestos) values (dF, 'ZZC961', 'Uno', 'Gris', 4), (dF, 'ZZC962', 'Dos', 'Rojo', 4);
    r := r || E'\nOK  beta: FREE can register a 2nd vehicle';
  exception when others then r := r || E'\nBAD beta: 2nd vehicle blocked: ' || sqlerrm; end;
  begin
    insert into public.saved_places (user_id, kind, label, address, lat, lng) values
      (dF, 'other', 'Uno', '', 4.8, -74.0), (dF, 'other', 'Dos', '', 4.8, -74.0), (dF, 'other', 'Tres', '', 4.8, -74.0), (dF, 'other', 'Cuatro', '', 4.8, -74.0);
    r := r || E'\nOK  beta: FREE can save more than 3 places';
  exception when others then r := r || E'\nBAD beta: saved places blocked: ' || sqlerrm; end;
  execute 'reset role';

  -- ================= BETA TERMINADA (mismo esquema, un interruptor) =================
  update public.app_config set beta_mode = false;
  perform set_config('request.jwt.claims', json_build_object('sub', dF, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select p.beta_mode, p.capabilities, p.limits ->> 'vehicles' into v_beta, caps, t from public.get_my_plan() p;
  r := r || case when not v_beta and not ('multiple_vehicles' = any(caps)) and 'trip_search' = any(caps) and t = '1'
                 then E'\nOK  production: FREE back to essential capabilities and 1 vehicle' else E'\nBAD production: ' || caps::text || ' limit ' || coalesce(t, 'null') end;
  begin
    insert into public.vehicles (driver_id, placa, marca, color, puestos) values (dF, 'ZZC963', 'Tres', 'Azul', 4);
    r := r || E'\nBAD production: FREE added another vehicle';
  exception when others then r := r || E'\nOK  production: FREE vehicle limit enforced by the server'; end;
  select count(*) into n from public.vehicles where driver_id = dF and activo;
  r := r || case when n = 2 then E'\nOK  production: vehicles added during beta are kept' else E'\nBAD production: vehicles → ' || n end;
  begin
    insert into public.saved_places (user_id, kind, label, address, lat, lng) values (dF, 'other', 'Cinco', '', 4.8, -74.0);
    r := r || E'\nBAD production: FREE saved a 5th place';
  exception when others then r := r || E'\nOK  production: FREE saved-place limit enforced (3)'; end;
  execute 'reset role';

  -- ConVía+ activo: todo, con o sin beta.
  perform set_config('request.jwt.claims', json_build_object('sub', pP, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select p.tier, p.capabilities into t, caps from public.get_my_plan() p;
  r := r || case when t = 'plus' and 'google_maps' = any(caps) and 'map_traffic' = any(caps) and 'multiple_vehicles' = any(caps)
                      and 'smart_match_priority' = any(caps) and 'plus_badge' = any(caps)
                 then E'\nOK  plus: ConVía+ has every capability' else E'\nBAD plus: ' || coalesce(t, 'null') || ' ' || caps::text end;
  select p.limits ->> 'vehicles' into t from public.get_my_plan() p;
  r := r || case when t = '10' then E'\nOK  plus: ConVía+ vehicle limit 10' else E'\nBAD plus: limit → ' || coalesce(t, 'null') end;
  execute 'reset role';

  -- ConVía+ vencido: vuelve a FREE.
  perform set_config('request.jwt.claims', json_build_object('sub', pE, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select p.tier, p.capabilities into t, caps from public.get_my_plan() p;
  r := r || case when t = 'free' and not ('google_maps' = any(caps))
                 then E'\nOK  expiry: expired ConVía+ falls back to FREE' else E'\nBAD expiry: ' || coalesce(t, 'null') end;

  -- Nadie se da ConVía+ ni cambia la configuración desde la app.
  begin insert into public.subscriptions (user_id, tier) values (pE, 'plus'); r := r || E'\nBAD security: self-grant ConVía+';
  exception when insufficient_privilege then r := r || E'\nOK  security: users cannot grant themselves ConVía+'; end;
  begin update public.subscriptions set current_period_end = null where user_id = pE; get diagnostics n = row_count;
    r := r || case when n = 0 then E'\nOK  security: users cannot extend their subscription' else E'\nBAD security: subscription extended' end;
  exception when insufficient_privilege then r := r || E'\nOK  security: users cannot extend their subscription'; end;
  begin update public.app_config set beta_mode = true; r := r || E'\nBAD security: user changed beta mode';
  exception when insufficient_privilege then r := r || E'\nOK  security: users cannot change beta mode'; end;
  begin insert into public.plan_capabilities (key, tier, description) values ('free_everything', 'free', 'x'); r := r || E'\nBAD security: user edited capabilities';
  exception when insufficient_privilege then r := r || E'\nOK  security: users cannot edit the capability catalog'; end;
  begin update public.plans set limits = '{}' where tier = 'free'; get diagnostics n = row_count;
    r := r || case when n = 0 then E'\nOK  security: users cannot edit plan limits' else E'\nBAD security: plan limits edited' end;
  exception when insufficient_privilege then r := r || E'\nOK  security: users cannot edit plan limits'; end;
  begin perform private.has_capability(pE, 'google_maps'); r := r || E'\nBAD security: private function callable';
  exception when insufficient_privilege then r := r || E'\nOK  security: capability check not callable from the app'; end;
  execute 'reset role';

  bad := (length(r) - length(replace(r, E'\nBAD', ''))) / 4;
  raise exception 'PLAN CAPABILITIES (rolled back) — % failing:%', bad, r;
end $$;
