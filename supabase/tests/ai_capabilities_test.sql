-- =====================================================================
-- ConVía — capacidades de IA y límite mensual de verificación del carro
--
-- Uso local: npx supabase db query --local -f supabase/tests/ai_capabilities_test.sql
-- Todo se deshace al final (el bloque termina con RAISE EXCEPTION); el
-- mensaje de error es el reporte. Cada línea dice OK o BAD.
-- =====================================================================
do $$
declare
  uF uuid := gen_random_uuid();  -- FREE
  uP uuid := gen_random_uuid();  -- ConVía+
  r text := ''; t text; caps text[]; lim jsonb; bad integer;
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role) values
    (uF, 'zz.aifree@unisabana.edu.co', '{"nombre":"ZZ AI Free"}', 'authenticated', 'authenticated'),
    (uP, 'zz.aiplus@unisabana.edu.co', '{"nombre":"ZZ AI Plus"}', 'authenticated', 'authenticated');
  insert into public.subscriptions (user_id, tier, status, provider, current_period_end) values
    (uP, 'plus', 'active', 'manual', null);

  -- ================= BETA ACTIVA =================
  update public.app_config set beta_mode = true;
  perform set_config('request.jwt.claims', json_build_object('sub', uF, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select p.capabilities, p.limits into caps, lim from public.get_my_plan() p;
  r := r || case when 'pickup_verification' = any(caps) then E'\nOK  beta: FREE has pickup_verification'
                 else E'\nBAD beta: pickup_verification missing ' || caps::text end;
  r := r || case when not ('trip_assistant' = any(caps)) and not ('vehicle_autofill' = any(caps))
                 then E'\nOK  beta: beta does not unlock trip_assistant or vehicle_autofill'
                 else E'\nBAD beta: AI ConVía+ capabilities leaked ' || caps::text end;
  r := r || case when lim ->> 'pickup_verifications_month' = '10' and lim ->> 'vehicles' = '10'
                 then E'\nOK  beta: pickup limit follows the real plan (10) while other limits are relaxed'
                 else E'\nBAD beta: effective limits ' || lim::text end;
  begin perform public.service_check_plan(uF, 'pickup_verification'); r := r || E'\nBAD security: app can call service_check_plan';
  exception when insufficient_privilege then r := r || E'\nOK  security: service_check_plan not callable from the app'; end;
  begin perform private.effective_limits(uF); r := r || E'\nBAD security: effective_limits callable';
  exception when insufficient_privilege then r := r || E'\nOK  security: effective_limits not callable from the app'; end;
  execute 'reset role';

  execute 'set local role service_role';
  begin perform public.service_check_plan(uF, 'pickup_verification', 'pickup_verifications_month', 9);
    r := r || E'\nOK  beta: FREE 10th pickup verification allowed';
  exception when others then r := r || E'\nBAD beta: 10th verification refused: ' || sqlerrm; end;
  begin perform public.service_check_plan(uF, 'pickup_verification', 'pickup_verifications_month', 10);
    r := r || E'\nBAD beta: FREE 11th pickup verification allowed (beta relaxed the real-plan limit)';
  exception when others then
    r := r || case when sqlerrm = 'LIMITE_PLAN:pickup_verifications_month:10' then E'\nOK  beta: FREE monthly pickup limit enforced (LIMITE_PLAN)' else E'\nBAD beta: ' || sqlerrm end; end;
  begin perform public.service_check_plan(uF, 'trip_assistant');
    r := r || E'\nBAD beta: FREE can use trip_assistant';
  exception when others then
    r := r || case when sqlerrm = 'CAPACIDAD_PLAN:trip_assistant' then E'\nOK  beta: trip_assistant refused for FREE (CAPACIDAD_PLAN)' else E'\nBAD beta: ' || sqlerrm end; end;
  begin perform public.service_check_plan(uF, 'vehicle_autofill');
    r := r || E'\nBAD beta: FREE can use vehicle_autofill';
  exception when others then
    r := r || case when sqlerrm = 'CAPACIDAD_PLAN:vehicle_autofill' then E'\nOK  beta: vehicle_autofill refused for FREE (CAPACIDAD_PLAN)' else E'\nBAD beta: ' || sqlerrm end; end;
  begin perform public.service_check_plan(uP, 'pickup_verification', 'pickup_verifications_month', 500);
    perform public.service_check_plan(uP, 'trip_assistant');
    perform public.service_check_plan(uP, 'vehicle_autofill');
    r := r || E'\nOK  plus: ConVía+ has the AI features and no monthly pickup limit';
  exception when others then r := r || E'\nBAD plus: ' || sqlerrm; end;
  begin perform public.service_check_plan(uP, 'not_a_capability');
    r := r || E'\nBAD check: unknown capability accepted';
  exception when others then
    r := r || case when sqlstate = '22023' then E'\nOK  check: unknown capability is an error, never a pass' else E'\nBAD check: ' || sqlerrm end; end;
  execute 'reset role';

  -- ================= BETA TERMINADA =================
  update public.app_config set beta_mode = false;
  perform set_config('request.jwt.claims', json_build_object('sub', uF, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select p.capabilities, p.limits into caps, lim from public.get_my_plan() p;
  r := r || case when 'pickup_verification' = any(caps) and lim ->> 'pickup_verifications_month' = '10' and lim ->> 'vehicles' = '1'
                 then E'\nOK  production: FREE keeps pickup_verification with 10 per month'
                 else E'\nBAD production: ' || caps::text || ' ' || lim::text end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', uP, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select p.capabilities, p.limits into caps, lim from public.get_my_plan() p;
  r := r || case when 'trip_assistant' = any(caps) and 'vehicle_autofill' = any(caps) and not (lim ? 'pickup_verifications_month')
                 then E'\nOK  production: ConVía+ has the AI features, unlimited pickup checks'
                 else E'\nBAD production plus: ' || caps::text || ' ' || lim::text end;
  execute 'reset role';
  execute 'set local role service_role';
  begin perform public.service_check_plan(uF, 'pickup_verification', 'pickup_verifications_month', 10);
    r := r || E'\nBAD production: FREE 11th pickup verification allowed';
  exception when others then
    r := r || case when sqlerrm = 'LIMITE_PLAN:pickup_verifications_month:10' then E'\nOK  production: FREE monthly pickup limit enforced' else E'\nBAD production: ' || sqlerrm end; end;
  execute 'reset role';

  -- ================= VERIFICAR EL CARRO: datos y borrado programado =================
  perform set_config('request.jwt.claims', json_build_object('sub', uF, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.pickup_verifications (trip_id, request_id, passenger_id, driver_id, status, reason, latency_ms)
      values (gen_random_uuid(), gen_random_uuid(), uF, uF, 'verified', 'plate_match', 1);
    r := r || E'\nBAD pickup: the app wrote a verification result';
  exception when insufficient_privilege then r := r || E'\nOK  pickup: only the Edge Function writes results'; end;
  begin perform public.service_stale_pickup_clips(); r := r || E'\nBAD pickup: app can list stale clips';
  exception when insufficient_privilege then r := r || E'\nOK  pickup: stale-clip listing not callable from the app'; end;
  begin perform private.dispatch_pickup_clips_cleanup(); r := r || E'\nBAD pickup: app can trigger the clean-up';
  exception when insufficient_privilege then r := r || E'\nOK  pickup: clean-up dispatch not callable from the app'; end;
  begin perform public.report_pickup_mismatch(gen_random_uuid()); r := r || E'\nBAD pickup: reported a result that is not theirs';
  exception when others then
    r := r || case when sqlerrm = 'pickup_report_not_allowed' then E'\nOK  pickup: only the passenger can report their own mismatch' else E'\nBAD pickup: ' || sqlerrm end; end;
  execute 'reset role';
  r := r || case when exists (select 1 from cron.job where jobname = 'cleanup-pickup-clips' and schedule = '*/30 * * * *')
                 then E'\nOK  pickup: clips older than an hour are deleted on a schedule'
                 else E'\nBAD pickup: cleanup-pickup-clips job missing' end;
  r := r || case when exists (select 1 from storage.buckets where id = 'pickup-clips' and not public)
                  and exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'pickup_clips_insert_own' and with_check like '%my_object_count%')
                 then E'\nOK  pickup: private clip bucket with a per-user file cap'
                 else E'\nBAD pickup: clip bucket or its insert policy' end;
  r := r || case when exists (select 1 from cron.job where jobname = 'cleanup-vehicle-suggestions')
                 then E'\nOK  autofill: suggestion counters cleaned daily' else E'\nBAD autofill: cleanup job missing' end;

  bad := (length(r) - length(replace(r, E'\nBAD', ''))) / 4;
  raise exception 'AI CAPABILITIES (rolled back) — % failing:%', bad, r;
end $$;
