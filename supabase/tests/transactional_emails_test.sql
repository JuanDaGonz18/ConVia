-- =====================================================================
-- ConVía — correos de bienvenida y de primer pago de ConVía+
--
-- Uso local: npx supabase db query -f supabase/tests/transactional_emails_test.sql
-- Todo se deshace al final (RAISE EXCEPTION); el mensaje es el reporte.
-- =====================================================================
do $$
declare
  uA uuid := gen_random_uuid();
  uB uuid := gen_random_uuid();
  n integer;
  r text := ''; bad integer;
begin
  -- Sin la promoción, para que el pago sea lo único que da ConVía+.
  update public.app_config set plus_promo_until = null;

  -- Correo sin confirmar: todavía nada.
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role) values
    (uA, 'zz.mail.a@gmail.com', '{"nombre":"Zeta Correo"}', '{"provider":"email"}', 'authenticated', 'authenticated');
  r := r || case when not exists (select 1 from private.email_outbox where user_id = uA)
                 then E'\nOK  welcome: nothing before the e-mail is confirmed' else E'\nBAD welcome: queued before confirming' end;

  update auth.users set email_confirmed_at = now() where id = uA;
  update auth.users set email_confirmed_at = now() where id = uA;
  select count(*) into n from private.email_outbox where user_id = uA and kind = 'welcome';
  r := r || case when n = 1 then E'\nOK  welcome: queued once when the e-mail is confirmed' else E'\nBAD welcome: ' || n || ' rows' end;

  -- Google: ya llega confirmado.
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role) values
    (uB, 'zz.mail.b@gmail.com', now(), '{"nombre":"Be Google"}', '{"provider":"google"}', 'authenticated', 'authenticated');
  r := r || case when exists (select 1 from private.email_outbox where user_id = uB and kind = 'welcome')
                 then E'\nOK  welcome: an account that arrives confirmed is queued' else E'\nBAD welcome: Google sign-up not queued' end;

  -- Primer pago aprobado: un agradecimiento; el segundo, nada.
  insert into public.payment_requests (reference, user_id, period, months, amount_cop, status, submitted_at)
  values ('CV-ZZ23', uA, 'monthly', 1, 12000, 'pending', now()), ('CV-ZZ24', uA, 'monthly', 1, 12000, 'pending', now());
  update public.payment_requests set status = 'granted', decided_at = now() where reference = 'CV-ZZ23';
  update public.payment_requests set status = 'granted', decided_at = now() where reference = 'CV-ZZ24';
  select count(*) into n from private.email_outbox where user_id = uA and kind = 'plus_first';
  r := r || case when n = 1 and (select months from private.email_outbox where user_id = uA and kind = 'plus_first') = 1
                 then E'\nOK  plus_first: one thank-you for the first approved payment' else E'\nBAD plus_first: ' || n || ' rows' end;
  update public.payment_requests set status = 'rejected' where reference = 'CV-ZZ24';
  r := r || case when (select count(*) from private.email_outbox where user_id = uA and kind = 'plus_first') = 1
                 then E'\nOK  plus_first: later decisions add nothing' else E'\nBAD plus_first: duplicated' end;

  -- send-emails: toma, marca y no repite.
  execute 'set local role service_role';
  select count(*) into n from public.service_claim_emails(50) c
   where c.email in ('zz.mail.a@gmail.com', 'zz.mail.b@gmail.com') and (c.kind <> 'welcome' or c.nombre is not null);
  r := r || case when n = 3 then E'\nOK  claim: welcome ×2 and plus_first with e-mail and name' else E'\nBAD claim: ' || n end;
  select count(*) into n from public.service_claim_emails(50) c where c.email like 'zz.mail.%';
  r := r || case when n = 0 then E'\nOK  claim: claimed rows are not handed out twice' else E'\nBAD claim: handed out again' end;
  execute 'reset role';
  perform public.service_mark_email(o.id, null) from private.email_outbox o where o.user_id = uA and o.kind = 'welcome';
  perform public.service_mark_email(o.id, 'brevo 500') from private.email_outbox o where o.user_id = uB;
  r := r || case when (select sent_at is not null from private.email_outbox where user_id = uA and kind = 'welcome')
                      and (select sent_at is null and claimed_at is null and attempts = 1 and last_error = 'brevo 500'
                             from private.email_outbox where user_id = uB)
                 then E'\nOK  mark: sent stays sent; a failure is retried later' else E'\nBAD mark' end;

  -- Permisos
  r := r || case when not has_function_privilege('authenticated', 'public.service_claim_emails(integer)', 'execute')
                      and not has_function_privilege('anon', 'public.service_mark_email(bigint, text)', 'execute')
                      and not has_table_privilege('authenticated', 'private.email_outbox', 'select')
                 then E'\nOK  grants: only the service role reads and marks the queue' else E'\nBAD grants' end;

  bad := (length(r) - length(replace(r, E'\nBAD', ''))) / 4;
  raise exception 'TRANSACTIONAL EMAILS — % failing:%', bad, r;
end $$;
