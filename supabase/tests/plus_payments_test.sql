-- =====================================================================
-- ConVía — pago de ConVía+ por transferencia (migración 047)
-- Uso local: npx supabase db query -f supabase/tests/plus_payments_test.sql
-- Todo se deshace al final (RAISE EXCEPTION); el mensaje es el reporte: OK o BAD.
-- La llave y el titular son de prueba (zz-...), nunca datos reales.
-- =====================================================================
do $$
declare
  uA  uuid := gen_random_uuid();  -- paga
  uB  uuid := gen_random_uuid();  -- otra persona
  uM  uuid := gen_random_uuid();  -- ConVía+ manual sin vencimiento
  uAd uuid := gen_random_uuid();  -- administrador
  r text := ''; n integer; t text; j jsonb;
  refM text; refY text; ref3 text; refB text;
  v_end timestamptz; v_end2 timestamptz; shot text; bodies text[];
begin
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role) values
    (uA,  'zz.pay.a@gmail.com',  '{"nombre":"ZZ Pay A","terms_accepted":true}', '{"provider":"email"}', 'authenticated', 'authenticated'),
    (uB,  'zz.pay.b@gmail.com',  '{"nombre":"ZZ Pay B","terms_accepted":true}', '{"provider":"email"}', 'authenticated', 'authenticated'),
    (uM,  'zz.pay.m@gmail.com',  '{"nombre":"ZZ Pay M","terms_accepted":true}', '{"provider":"email"}', 'authenticated', 'authenticated'),
    (uAd, 'zz.pay.ad@gmail.com', '{"nombre":"ZZ Admin","terms_accepted":true}', '{"provider":"email"}', 'authenticated', 'authenticated');
  delete from private.admins;
  insert into private.admins (user_id) values (uAd);
  insert into public.subscriptions (user_id, tier, status, provider, current_period_end) values (uM, 'plus', 'active', 'manual', null);
  update public.app_config set beta_mode = false;

  -- ================= APAGADO (estado de la migración) =================
  r := r || case when (select payments_enabled from public.app_config) = false
                  and (select bre_b_key from public.app_config) is null and (select payee_name from public.app_config) is null
                 then E'\nOK  flag: migration leaves payments off with no key and no payee' else E'\nBAD flag: not off by default' end;
  r := r || case when (select amount_cop from public.plus_prices where period = 'monthly') = 12000
                  and (select amount_cop from public.plus_prices where period = 'yearly') = 108000
                 then E'\nOK  prices: monthly 12000 and yearly 108000 COP' else E'\nBAD prices' end;

  perform set_config('request.jwt.claims', json_build_object('sub', uA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.get_plus_payment_info();
  r := r || case when j = '{"enabled": false}'::jsonb then E'\nOK  off: info says only enabled=false' else E'\nBAD off: info ' || j::text end;
  begin perform public.start_plus_payment('monthly'); r := r || E'\nBAD off: start worked';
  exception when others then r := r || case when sqlerrm = 'PAYMENTS_DISABLED' then E'\nOK  off: start → PAYMENTS_DISABLED' else E'\nBAD off: start ' || sqlerrm end; end;
  begin perform public.confirm_plus_payment('CV-2345'); r := r || E'\nBAD off: confirm worked';
  exception when others then r := r || case when sqlerrm = 'PAYMENTS_DISABLED' then E'\nOK  off: confirm → PAYMENTS_DISABLED' else E'\nBAD off: confirm ' || sqlerrm end; end;
  begin insert into storage.objects (bucket_id, name) values ('payment-receipts', uA::text || '/' || gen_random_uuid() || '.jpg');
    r := r || E'\nBAD off: receipt upload allowed';
  exception when others then r := r || E'\nOK  off: receipt upload is closed'; end;
  begin perform bre_b_key from public.app_config; r := r || E'\nBAD config: user can read bre_b_key directly';
  exception when others then r := r || E'\nOK  config: bre_b_key is not readable from the table'; end;
  begin perform beta_mode, payments_enabled from public.app_config; r := r || E'\nOK  config: beta_mode and payments_enabled stay readable';
  exception when others then r := r || E'\nBAD config: ' || sqlerrm; end;
  begin update public.app_config set payments_enabled = true; r := r || E'\nBAD config: user turned payments on';
  exception when others then r := r || E'\nOK  config: user cannot turn payments on'; end;
  begin update public.plus_prices set amount_cop = 1000; r := r || E'\nBAD prices: user changed a price';
  exception when others then r := r || E'\nOK  prices: user cannot change prices'; end;
  select p.tier into t from public.get_my_plan() p;
  r := r || case when t = 'free' then E'\nOK  off: plan unchanged (free)' else E'\nBAD off: plan ' || t end;
  execute 'reset role';
  execute 'set local role service_role';
  begin perform public.service_grant_plus_payment('CV-2345'); r := r || E'\nBAD off: grant worked';
  exception when others then r := r || case when sqlerrm = 'PAYMENTS_DISABLED' then E'\nOK  off: grant → PAYMENTS_DISABLED' else E'\nBAD off: grant ' || sqlerrm end; end;
  execute 'reset role';
  select (private.plus_payments_daily() ->> 'expired')::integer into n;
  r := r || case when n = 0 and (select status from public.subscriptions where user_id = uM) = 'active'
                 then E'\nOK  off: daily job leaves manual subscriptions alone' else E'\nBAD off: daily job changed something' end;

  -- ================= ENCENDIDO SIN LLAVE =================
  update public.app_config set payments_enabled = true;
  perform set_config('request.jwt.claims', json_build_object('sub', uA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := r || case when (public.get_plus_payment_info() ->> 'enabled')::boolean = false
                 then E'\nOK  config: on without key still shows disabled' else E'\nBAD config: shown without key' end;
  begin perform public.start_plus_payment('monthly'); r := r || E'\nBAD config: start without key';
  exception when others then r := r || case when sqlerrm = 'PAYMENTS_NOT_CONFIGURED' then E'\nOK  config: start without key → PAYMENTS_NOT_CONFIGURED' else E'\nBAD config: ' || sqlerrm end; end;
  execute 'reset role';
  update public.app_config set bre_b_key = 'zz-llave-prueba', payee_name = 'ZZ Titular de Prueba';

  -- ================= REFERENCIAS =================
  perform set_config('request.jwt.claims', json_build_object('sub', uA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  j := public.get_plus_payment_info();
  r := r || case when (j ->> 'enabled')::boolean and j ->> 'bre_b_key' = 'zz-llave-prueba' and jsonb_array_length(j -> 'prices') = 2
                 then E'\nOK  info: key, payee and both prices once enabled' else E'\nBAD info: ' || j::text end;
  begin perform public.start_plus_payment('weekly'); r := r || E'\nBAD start: unknown period accepted';
  exception when others then r := r || case when sqlerrm = 'PAYMENT_PERIOD_INVALID' then E'\nOK  start: unknown period rejected' else E'\nBAD start: ' || sqlerrm end; end;
  j := public.start_plus_payment('monthly');
  refM := j ->> 'reference';
  r := r || case when refM ~ '^CV-[2-9A-HJKMNP-Z]{4}$' and (j ->> 'amount_cop')::integer = 12000 and j ->> 'payee_name' = 'ZZ Titular de Prueba'
                 then E'\nOK  start: CV-XXXX reference with amount and payee' else E'\nBAD start: ' || j::text end;
  r := r || case when public.start_plus_payment('monthly') ->> 'reference' = refM
                 then E'\nOK  start: the unsent monthly reference is reused' else E'\nBAD start: new reference each time' end;
  refY := public.start_plus_payment('yearly') ->> 'reference';
  r := r || case when refY <> refM and (select amount_cop from public.payment_requests where reference = refY) = 108000
                 then E'\nOK  start: yearly gets its own reference and price' else E'\nBAD start: yearly' end;
  begin insert into public.payment_requests (reference, user_id, period, months, amount_cop) values ('CV-ZZZZ', uA, 'monthly', 1, 1);
    r := r || E'\nBAD rls: direct insert worked';
  exception when others then r := r || E'\nOK  rls: direct insert is denied'; end;
  begin update public.payment_requests set status = 'granted'; r := r || E'\nBAD rls: user granted own payment';
  exception when others then r := r || E'\nOK  rls: user cannot change a payment'; end;
  begin insert into public.subscriptions (user_id, tier) values (uA, 'plus'); r := r || E'\nBAD rls: user self-granted ConVía+';
  exception when others then r := r || E'\nOK  rls: user cannot write subscriptions'; end;
  begin perform public.service_grant_plus_payment(refM); r := r || E'\nBAD rls: user called service_grant';
  exception when others then r := r || E'\nOK  rls: user cannot call service_grant_plus_payment'; end;
  begin perform * from public.claim_admin_payment_pushes(); r := r || E'\nBAD rls: user claimed admin pushes';
  exception when others then r := r || E'\nOK  rls: user cannot claim pushes'; end;

  -- Otra persona no ve ni confirma la referencia de A
  perform set_config('request.jwt.claims', json_build_object('sub', uB, 'role', 'authenticated')::text, true);
  select count(*) into n from public.payment_requests;
  r := r || case when n = 0 then E'\nOK  rls: B sees none of A''s payments' else E'\nBAD rls: B sees ' || n end;
  begin perform public.confirm_plus_payment(refM); r := r || E'\nBAD rls: B confirmed A''s reference';
  exception when others then r := r || case when sqlerrm = 'PAYMENT_NOT_FOUND' then E'\nOK  rls: B cannot confirm A''s reference' else E'\nBAD rls: ' || sqlerrm end; end;
  refB := public.start_plus_payment('monthly') ->> 'reference';
  execute 'reset role';

  -- Unicidad: 400 referencias seguidas sin repetir, y la restricción única en la tabla
  for i in 1..400 loop
    insert into public.payment_requests (reference, user_id, period, months, amount_cop, status, decided_at)
    values (private.new_payment_reference(), uB, 'monthly', 1, 12000, 'rejected', now());
  end loop;
  select count(*) - count(distinct reference) into n from public.payment_requests;
  r := r || case when n = 0 then E'\nOK  unique: 400 generated references are all distinct' else E'\nBAD unique: ' || n || ' repeated' end;
  begin insert into public.payment_requests (reference, user_id, period, months, amount_cop) values (refM, uB, 'monthly', 1, 12000);
    r := r || E'\nBAD unique: duplicate reference stored';
  exception when unique_violation then r := r || E'\nOK  unique: a duplicate reference is rejected by the table'; end;
  delete from public.payment_requests where user_id = uB and status = 'rejected';

  -- ================= "YA PAGUÉ" Y LÍMITE DE PENDIENTES =================
  perform set_config('request.jwt.claims', json_build_object('sub', uA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.confirm_plus_payment(refM, uB::text || '/' || gen_random_uuid() || '.jpg');
    r := r || E'\nBAD receipt: accepted a path in someone else''s folder';
  exception when others then r := r || case when sqlerrm = 'PAYMENT_RECEIPT_INVALID' then E'\nOK  receipt: another folder is refused' else E'\nBAD receipt: ' || sqlerrm end; end;
  begin perform public.confirm_plus_payment(refM, uA::text || '/' || gen_random_uuid() || '.jpg');
    r := r || E'\nBAD receipt: accepted a file that was not uploaded';
  exception when others then r := r || case when sqlerrm = 'PAYMENT_RECEIPT_INVALID' then E'\nOK  receipt: missing upload is refused' else E'\nBAD receipt: ' || sqlerrm end; end;
  j := public.confirm_plus_payment(lower(refM));
  r := r || case when j ->> 'status' = 'pending' then E'\nOK  confirm: "Ya pagué" leaves it pending (reference is case-insensitive)' else E'\nBAD confirm: ' || j::text end;
  r := r || case when public.confirm_plus_payment(refM) ->> 'status' = 'pending'
                 then E'\nOK  confirm: confirming twice is harmless' else E'\nBAD confirm: twice' end;
  perform public.confirm_plus_payment(refY);
  ref3 := public.start_plus_payment('monthly') ->> 'reference';
  r := r || case when ref3 <> refM then E'\nOK  start: a new monthly reference once the previous one is pending' else E'\nBAD start: reused a pending reference' end;
  execute 'reset role';
  shot := uA::text || '/' || gen_random_uuid()::text || '.jpg';
  insert into storage.objects (bucket_id, name) values ('payment-receipts', shot);
  execute 'set local role authenticated';
  perform public.confirm_plus_payment(ref3, shot);
  execute 'reset role';
  r := r || case when (select receipt_path from public.payment_requests where reference = ref3) = shot
                 then E'\nOK  receipt: own uploaded receipt attached' else E'\nBAD receipt: not attached' end;
  execute 'set local role authenticated';
  begin perform public.start_plus_payment('monthly'); r := r || E'\nBAD limit: a 4th pending payment was allowed';
  exception when others then r := r || case when sqlerrm = 'PAYMENT_PENDING_LIMIT' then E'\nOK  limit: max 3 pending payments per user' else E'\nBAD limit: ' || sqlerrm end; end;
  select count(*) into n from public.payment_requests where status = 'pending';
  r := r || case when n = 3 then E'\nOK  rls: A sees its 3 pending payments' else E'\nBAD rls: A sees ' || n end;
  execute 'reset role';

  -- Aviso a los administradores: solo el número
  execute 'set local role service_role';
  select array_agg(c.title || ': ' || c.body) into bodies from public.claim_admin_payment_pushes() c;
  execute 'reset role';
  r := r || case when bodies = array['ConVía+: 3 pagos por revisar']
                 then E'\nOK  admin push: one per admin with the pending count only' else E'\nBAD admin push: ' || coalesce(array_to_string(bodies, ' | '), 'nothing') end;
  r := r || case when array_to_string(bodies, ' ') !~ '(CV-|ZZ|12000|@)'
                 then E'\nOK  admin push: no reference, name or amount' else E'\nBAD admin push: leaks details' end;

  -- ================= DECISIONES =================
  execute 'set local role service_role';
  j := public.service_grant_plus_payment(refM);
  v_end := (j ->> 'period_end')::timestamptz;
  r := r || case when v_end between now() + interval '27 days' and now() + interval '32 days'
                  and (select tier || '/' || status || '/' || provider from public.subscriptions where user_id = uA) = 'plus/active/transferencia'
                 then E'\nOK  grant: monthly sets ConVía+ for one month' else E'\nBAD grant: ' || j::text end;
  r := r || case when (select paid_amount_cop = 12000 and paid_on is not null and decided_at is not null and status = 'granted'
                         from public.payment_requests where reference = refM)
                 then E'\nOK  grant: amount, date and reference are recorded' else E'\nBAD grant: record' end;
  j := public.service_grant_plus_payment(refY, 108000, current_date);
  v_end2 := (j ->> 'period_end')::timestamptz;
  r := r || case when v_end2 = v_end + interval '12 months' and (select current_period_end from public.subscriptions where user_id = uA) = v_end2
                 then E'\nOK  grant: a second payment extends from the current end (+12 months)' else E'\nBAD grant: extend ' || j::text end;
  begin perform public.service_grant_plus_payment(refM); r := r || E'\nBAD grant: granted twice';
  exception when others then r := r || case when sqlerrm = 'PAYMENT_ALREADY_DECIDED' then E'\nOK  grant: a decided payment cannot be granted again' else E'\nBAD grant: ' || sqlerrm end; end;
  begin perform public.service_reject_plus_payment(ref3, ''); r := r || E'\nBAD reject: no reason accepted';
  exception when others then r := r || case when sqlerrm = 'PAYMENT_REASON_REQUIRED' then E'\nOK  reject: a reason is required' else E'\nBAD reject: ' || sqlerrm end; end;
  perform public.service_reject_plus_payment(ref3, 'No encontramos la transferencia');
  r := r || case when (select status || ':' || reject_reason from public.payment_requests where reference = ref3) = 'rejected:No encontramos la transferencia'
                 then E'\nOK  reject: stored with its reason' else E'\nBAD reject' end;
  select array_agg(c.kind || ': ' || c.body order by c.kind) into bodies from public.claim_plus_pushes() c;
  r := r || case when array_length(bodies, 1) = 3 and bodies[1] like 'granted: ConVía+ activo hasta el %'
                  and bodies[3] = 'rejected: No pudimos confirmar tu pago ' || ref3 || ': No encontramos la transferencia'
                 then E'\nOK  user push: "ConVía+ activo hasta …" and the rejection reason' else E'\nBAD user push: ' || coalesce(array_to_string(bodies, ' | '), 'nothing') end;
  begin perform public.service_grant_plus_payment(refB); perform public.service_grant_plus_payment('CV-0000');
    r := r || E'\nBAD grant: unknown reference granted';
  exception when others then r := r || case when sqlerrm = 'PAYMENT_NOT_FOUND' then E'\nOK  grant: a draft can be granted; unknown reference → PAYMENT_NOT_FOUND' else E'\nBAD grant: ' || sqlerrm end; end;
  -- Manual sin vencimiento: no se pisa
  insert into public.payment_requests (reference, user_id, period, months, amount_cop, status, submitted_at)
  values ('CV-MMMM', uM, 'monthly', 1, 12000, 'pending', now());
  begin perform public.service_grant_plus_payment('CV-MMMM'); r := r || E'\nBAD grant: overwrote a subscription with no expiry';
  exception when others then r := r || case when sqlerrm = 'PLUS_NO_EXPIRY' then E'\nOK  grant: a ConVía+ without expiry is not overwritten' else E'\nBAD grant: ' || sqlerrm end; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', uA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select p.tier into t from public.get_my_plan() p;
  r := r || case when t = 'plus' then E'\nOK  grant: the app sees ConVía+' else E'\nBAD grant: plan ' || t end;
  execute 'reset role';

  -- ================= VENCIMIENTO =================
  update public.subscriptions set current_period_end = now() + interval '2 days' where user_id = uA;
  j := private.plus_payments_daily();
  r := r || case when (j ->> 'warned')::integer = 1 and exists (select 1 from private.plus_pushes where user_id = uA and kind = 'expiring' and body like 'Tu ConVía+ vence el %No se renueva solo%')
                 then E'\nOK  expiry: push 3 days before, saying it does not auto-renew' else E'\nBAD expiry: warn ' || j::text end;
  r := r || case when (private.plus_payments_daily() ->> 'warned')::integer = 0
                 then E'\nOK  expiry: the warning is sent once per period' else E'\nBAD expiry: warned twice' end;
  update public.subscriptions set current_period_end = now() - interval '1 minute' where user_id = uA;
  update public.subscriptions set current_period_end = now() - interval '1 day' where user_id = uM;
  j := private.plus_payments_daily();
  r := r || case when (j ->> 'expired')::integer = 1 and (select status from public.subscriptions where user_id = uA) = 'expired'
                  and (select status from public.subscriptions where user_id = uM) = 'active'
                 then E'\nOK  expiry: expired transfer subscriptions are downgraded; manual ones untouched' else E'\nBAD expiry: ' || j::text end;
  perform set_config('request.jwt.claims', json_build_object('sub', uA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select p.tier into t from public.get_my_plan() p;
  r := r || case when t = 'free' then E'\nOK  expiry: the app sees the free plan again' else E'\nBAD expiry: plan ' || t end;
  execute 'reset role';

  -- ================= COMPROBANTES Y RETENCIÓN =================
  update storage.objects set created_at = now() - interval '2 days' where bucket_id = 'payment-receipts' and name = shot;
  r := r || case when not exists (select 1 from public.service_expired_payment_receipts() f where f = shot)
                 then E'\nOK  receipts: kept for 30 days after the decision' else E'\nBAD receipts: listed too early' end;
  update public.payment_requests set decided_at = now() - interval '31 days' where reference = ref3;
  r := r || case when exists (select 1 from public.service_expired_payment_receipts() f where f = shot)
                 then E'\nOK  receipts: listed for deletion 30 days after the decision' else E'\nBAD receipts: not listed' end;
  update public.payment_requests set decided_at = now() - interval '4 years' where reference = refM;
  perform private.plus_payments_daily();
  r := r || case when exists (select 1 from public.payment_requests where reference = refM)
                  and (select receipt_path from public.payment_requests where reference = ref3) is null
                 then E'\nOK  retention: records kept (< 5 years), receipt path cleared' else E'\nBAD retention' end;
  update public.payment_requests set decided_at = now() - interval '5 years 1 day' where reference = refM;
  perform private.plus_payments_daily();
  r := r || case when not exists (select 1 from public.payment_requests where reference = refM)
                 then E'\nOK  retention: records older than 5 years are deleted' else E'\nBAD retention: 5 years' end;
  delete from auth.users where id = uA;
  r := r || case when (select user_id from public.payment_requests where reference = refY) is null
                 then E'\nOK  retention: deleting the account keeps the payment record without the person' else E'\nBAD retention: record lost or still linked' end;

  -- ================= APAGADO OTRA VEZ =================
  update public.app_config set payments_enabled = false;
  execute 'set local role service_role';
  begin perform public.service_reject_plus_payment(refB, 'motivo de prueba'); r := r || E'\nBAD off: reject worked when off';
  exception when others then r := r || case when sqlerrm = 'PAYMENTS_DISABLED' then E'\nOK  off: switching off closes the admin RPCs too' else E'\nBAD off: ' || sqlerrm end; end;
  execute 'reset role';

  raise exception E'plus_payments report:%', r;
end $$;
