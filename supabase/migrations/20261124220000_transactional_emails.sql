-- =====================================================================
-- ConVía — correos de bienvenida y de primer pago de ConVía+
--
-- private.email_outbox guarda un correo por persona y tipo:
--   welcome     cuando la persona confirma su correo (o entra con Google,
--               que ya llega confirmado). Una sola vez por cuenta.
--   plus_first  cuando se aprueba su PRIMER pago de ConVía+ (no la promo ni
--               las activaciones a mano). Una sola vez por cuenta.
-- La Edge Function send-emails los envía con Brevo (secreto BREVO_API_KEY):
-- se la llama al encolar y un cron cada 10 minutos reintenta (hasta 5
-- intentos, durante 3 días). Las filas enviadas se borran a los 30 días.
-- =====================================================================

create table if not exists private.email_outbox (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('welcome', 'plus_first')),
  months      integer,
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  sent_at     timestamptz,
  attempts    integer not null default 0,
  last_error  text,
  unique (user_id, kind)
);
create index if not exists email_outbox_pending_idx on private.email_outbox (created_at) where sent_at is null;
revoke all on private.email_outbox from public, anon, authenticated;

-- Llama a send-emails si hay algo pendiente (mismos secretos del Vault que notify).
create or replace function private.dispatch_emails()
returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_anon text; v_secret text;
begin
  if not exists (select 1 from private.email_outbox
                  where sent_at is null and attempts < 5 and created_at > now() - interval '3 days') then
    return;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'convia_project_url';
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'convia_anon_key';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'convia_cron_secret';
  if v_url is null or v_anon is null or v_secret is null then return; end if;
  perform net.http_post(
    url := v_url || '/functions/v1/send-emails',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon, 'x-convia-cron', v_secret),
    body := '{}'::jsonb);
end $$;
revoke execute on function private.dispatch_emails() from public, anon, authenticated;

-- Bienvenida: al confirmar el correo.
create or replace function private.queue_welcome_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is not null
     and (tg_op = 'INSERT' or old.email_confirmed_at is null)
     and new.email is not null then
    insert into private.email_outbox (user_id, kind) values (new.id, 'welcome')
    on conflict (user_id, kind) do nothing;
    if found then perform private.dispatch_emails(); end if;
  end if;
  return new;
exception when others then
  -- Un correo nunca debe impedir crear o confirmar una cuenta.
  return new;
end $$;
revoke execute on function private.queue_welcome_email() from public, anon, authenticated;

drop trigger if exists on_auth_user_welcome_email on auth.users;
create trigger on_auth_user_welcome_email
  after insert or update of email_confirmed_at on auth.users
  for each row execute function private.queue_welcome_email();

-- Primer pago de ConVía+ aprobado.
create or replace function private.queue_plus_first_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'granted' and old.status is distinct from 'granted'
     and not exists (select 1 from public.payment_requests p
                      where p.user_id = new.user_id and p.status = 'granted' and p.id <> new.id) then
    insert into private.email_outbox (user_id, kind, months) values (new.user_id, 'plus_first', new.months)
    on conflict (user_id, kind) do nothing;
    if found then perform private.dispatch_emails(); end if;
  end if;
  return new;
exception when others then
  return new;
end $$;
revoke execute on function private.queue_plus_first_email() from public, anon, authenticated;

drop trigger if exists payment_requests_plus_first_email on public.payment_requests;
create trigger payment_requests_plus_first_email
  after update of status on public.payment_requests
  for each row execute function private.queue_plus_first_email();

-- Para send-emails (service_role): toma hasta p_limit pendientes con los datos del correo.
create or replace function public.service_claim_emails(p_limit integer default 20)
returns table (id bigint, kind text, email text, nombre text, plus_until timestamptz, promo boolean, months integer)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with picked as (
    select o.id from private.email_outbox o
     where o.sent_at is null and o.attempts < 5 and o.created_at > now() - interval '3 days'
       and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes')
     order by o.created_at
     limit greatest(1, least(coalesce(p_limit, 20), 50))
     for update skip locked
  ), upd as (
    update private.email_outbox o set claimed_at = now(), attempts = o.attempts + 1
      from picked where o.id = picked.id
    returning o.id, o.kind, o.user_id, o.months
  )
  select upd.id, upd.kind, u.email::text, p.nombre,
         s.current_period_end,
         coalesce(s.provider = 'promo_lanzamiento', false),
         upd.months
    from upd
    join auth.users u on u.id = upd.user_id
    left join public.profiles p on p.id = upd.user_id
    left join public.subscriptions s on s.user_id = upd.user_id and s.tier = 'plus'
         and s.status in ('active', 'trialing') and (s.current_period_end is null or s.current_period_end > now());
end $$;
revoke execute on function public.service_claim_emails(integer) from public, anon, authenticated;
grant execute on function public.service_claim_emails(integer) to service_role;

create or replace function public.service_mark_email(p_id bigint, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update private.email_outbox
     set sent_at = case when p_error is null then now() else sent_at end,
         last_error = left(p_error, 300),
         claimed_at = null
   where id = p_id;
$$;
revoke execute on function public.service_mark_email(bigint, text) from public, anon, authenticated;
grant execute on function public.service_mark_email(bigint, text) to service_role;

-- Reintentos y limpieza.
create or replace function private.emails_cron()
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from private.email_outbox where sent_at < now() - interval '30 days' or created_at < now() - interval '30 days';
  perform private.dispatch_emails();
end $$;
revoke execute on function private.emails_cron() from public, anon, authenticated;

select cron.unschedule('convia-emails') where exists (select 1 from cron.job where jobname = 'convia-emails');
select cron.schedule('convia-emails', '*/10 * * * *', $$select private.emails_cron()$$);
