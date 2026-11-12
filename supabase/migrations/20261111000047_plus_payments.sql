-- =====================================================================
-- ConVía — pago de ConVía+ por transferencia directa (Bre-B), sin pasarela
--
-- Todo queda APAGADO: con app_config.payments_enabled = false (el valor de
-- esta migración) la app y el servidor se comportan como antes. Las RPC de
-- pago responden PAYMENTS_DISABLED, la subida de comprobantes está cerrada y
-- get_plus_payment_info() solo dice enabled = false. La activación es la
-- migración de lanzamiento + docs/LANZAR_PLUS.md.
--
--  * app_config: payments_enabled, bre_b_key y payee_name (NULL aquí: la
--    llave y el titular reales se ponen con SQL en producción, nunca en el
--    repositorio). La app ya no lee app_config entera: solo beta_mode y
--    payments_enabled; la llave sale por get_plus_payment_info().
--  * plus_prices: precio en COP de cada periodo (mensual 12 000, anual
--    108 000), editable con un UPDATE.
--  * payment_requests: una fila por intento de pago, con referencia única
--    (CV-XXXX). 'draft' = referencia mostrada; 'pending' = la persona tocó
--    "Ya pagué" (máx. 3 pendientes); 'granted' / 'rejected' los decide el
--    equipo (npm run plus). Los registros se guardan 5 años; las referencias
--    nunca enviadas, 30 días. La app solo lee las suyas (RLS) y escribe
--    únicamente con start_plus_payment / confirm_plus_payment.
--  * Comprobante opcional en el bucket privado payment-receipts
--    (<user_id>/<uuid>.jpg). Se borra 30 días después de la decisión
--    (card-review-cleanup) y con la cuenta (delete-account).
--  * Avisos: a los administradores, solo el número de pagos pendientes; a la
--    persona, "ConVía+ activo hasta …", el rechazo con su motivo y el aviso
--    3 días antes de vencer. Los envía notify (sweep), como los demás.
--  * plus-payments-daily (cron): baja a gratis las suscripciones pagadas por
--    transferencia que vencieron, encola el aviso de vencimiento y limpia.
--    Sin renovación automática.
--
-- Reversión: select cron.unschedule('plus-payments-daily'); drop de las
-- funciones y tablas de esta migración; restaurar dispatch_pending_pushes y
-- dispatch_card_review_cleanup de la 045; grant select on public.app_config
-- to authenticated; alter table public.app_config drop column ... (3).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Configuración y precios
-- ---------------------------------------------------------------------
alter table public.app_config
  add column if not exists payments_enabled boolean not null default false,
  add column if not exists bre_b_key  text check (bre_b_key is null or char_length(btrim(bre_b_key)) between 3 and 80),
  add column if not exists payee_name text check (payee_name is null or char_length(btrim(payee_name)) between 2 and 80);

update public.app_config set payments_enabled = false, bre_b_key = null, payee_name = null where id;

revoke select on public.app_config from authenticated;
grant select (id, beta_mode, payments_enabled, updated_at) on public.app_config to authenticated;

create table public.plus_prices (
  period      text primary key check (period in ('monthly', 'yearly')),
  months      integer not null,
  -- Pesos colombianos, impuestos incluidos.
  amount_cop  integer not null check (amount_cop between 1000 and 10000000),
  updated_at  timestamptz not null default now(),
  check ((period = 'monthly' and months = 1) or (period = 'yearly' and months = 12))
);
insert into public.plus_prices (period, months, amount_cop) values ('monthly', 1, 12000), ('yearly', 12, 108000);

create trigger plus_prices_updated_at
  before update on public.plus_prices
  for each row execute function public.set_updated_at();

alter table public.plus_prices enable row level security;
revoke all on public.plus_prices from anon, authenticated;
grant select on public.plus_prices to authenticated;
grant all on public.plus_prices to service_role;
create policy "plus_prices_read" on public.plus_prices for select to authenticated using (true);

-- Interruptor. authenticated lo necesita para la política de Storage (private no está expuesto por la API).
create or replace function private.payments_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select c.payments_enabled from public.app_config c where c.id), false)
$$;
revoke execute on function private.payments_enabled() from public, anon;
grant execute on function private.payments_enabled() to authenticated, service_role;

-- Encendido y con llave y titular: lo único que habilita cobrar.
create or replace function private.payments_ready()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select c.payments_enabled and nullif(btrim(c.bre_b_key), '') is not null
                          and nullif(btrim(c.payee_name), '') is not null
                     from public.app_config c where c.id), false)
$$;
revoke execute on function private.payments_ready() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Solicitudes de pago
-- ---------------------------------------------------------------------
create table public.payment_requests (
  id               uuid primary key default gen_random_uuid(),
  -- CV- y 4 caracteres sin 0/O, 1/I/L para dictarla sin errores.
  reference        text not null unique check (reference ~ '^CV-[2-9A-HJKMNP-Z]{4}$'),
  -- Con la cuenta eliminada el registro contable se conserva sin la persona.
  user_id          uuid references auth.users(id) on delete set null,
  period           text not null check (period in ('monthly', 'yearly')),
  months           integer not null check (months in (1, 12)),
  amount_cop       integer not null check (amount_cop > 0),
  status           text not null default 'draft' check (status in ('draft', 'pending', 'granted', 'rejected')),
  receipt_path     text check (receipt_path is null or char_length(receipt_path) <= 200),
  reject_reason    text check (reject_reason is null or char_length(reject_reason) between 3 and 300),
  -- Lo que se recibió y cuándo (registro de 5 años).
  paid_amount_cop  integer check (paid_amount_cop is null or paid_amount_cop > 0),
  paid_on          date,
  period_start     timestamptz,
  period_end       timestamptz,
  created_at       timestamptz not null default now(),
  submitted_at     timestamptz,
  decided_at       timestamptz,
  updated_at       timestamptz not null default now()
);
create index payment_requests_user_status_idx on public.payment_requests (user_id, status);
create index payment_requests_pending_idx on public.payment_requests (submitted_at) where status = 'pending';

create trigger payment_requests_updated_at
  before update on public.payment_requests
  for each row execute function public.set_updated_at();

alter table public.payment_requests enable row level security;
revoke all on public.payment_requests from anon, authenticated;
grant select on public.payment_requests to authenticated;
grant all on public.payment_requests to service_role;
create policy "payment_requests_read_own" on public.payment_requests for select to authenticated
  using (user_id = (select auth.uid()));

-- Comprobantes (opcionales): bucket privado, la persona sube a su carpeta solo con los pagos encendidos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('payment-receipts', 'payment-receipts', false, 3145728, array['image/jpeg'])
on conflict (id) do nothing;

create policy "payment_receipts_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-receipts' and (storage.foldername(name))[1] = (select auth.uid())::text
              and (select private.payments_enabled()));
create policy "payment_receipts_read_own" on storage.objects for select to authenticated
  using (bucket_id = 'payment-receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "payment_receipts_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'payment-receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------
-- 3. Avisos
-- ---------------------------------------------------------------------
-- A los administradores: una fila por administrador con el número de pagos pendientes.
create table private.admin_payment_pushes (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  pendientes integer not null check (pendientes >= 0),
  created_at timestamptz not null default now(),
  pushed_at  timestamptz
);
revoke all on private.admin_payment_pushes from public, anon, authenticated;
grant select on private.admin_payment_pushes to service_role;

-- A la persona: activación, rechazo y vencimiento. (kind, dedupe) evita repetir un aviso.
create table private.plus_pushes (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('granted', 'rejected', 'expiring')),
  dedupe     text not null,
  title      text not null,
  body       text not null,
  created_at timestamptz not null default now(),
  pushed_at  timestamptz,
  unique (user_id, kind, dedupe)
);
revoke all on private.plus_pushes from public, anon, authenticated;
grant select on private.plus_pushes to service_role;

-- "11 de diciembre de 2026" en hora de Bogotá, sin depender del locale del servidor.
create or replace function private.fecha_es(p_at timestamptz)
returns text language sql immutable set search_path = '' as $$
  select extract(day from (p_at at time zone 'America/Bogota'))::integer || ' de '
         || (array['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
                   'septiembre', 'octubre', 'noviembre', 'diciembre'])[extract(month from (p_at at time zone 'America/Bogota'))::integer]
         || ' de ' || extract(year from (p_at at time zone 'America/Bogota'))::integer
$$;
revoke execute on function private.fecha_es(timestamptz) from public, anon, authenticated;

create or replace function private.enqueue_admin_payment_pushes()
returns void language plpgsql security definer set search_path = '' as $$
declare v_pending integer := (select count(*) from public.payment_requests where status = 'pending');
begin
  if v_pending = 0 then return; end if;
  insert into private.admin_payment_pushes (user_id, pendientes)
    select a.user_id, v_pending from private.admins a
  on conflict (user_id) do update set pendientes = excluded.pendientes, created_at = now(), pushed_at = null;
end $$;
revoke execute on function private.enqueue_admin_payment_pushes() from public, anon, authenticated;

-- Para notify (sweep): solo el número, nunca quién pagó ni cuánto.
create or replace function public.claim_admin_payment_pushes()
returns table (user_id uuid, title text, body text)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with claimed as (
    update private.admin_payment_pushes p set pushed_at = now()
     where p.pushed_at is null and p.created_at > now() - interval '1 day'
    returning p.user_id, p.pendientes
  )
  select c.user_id, 'ConVía+'::text,
         greatest(c.pendientes, 1) || case when greatest(c.pendientes, 1) = 1
           then ' pago por revisar' else ' pagos por revisar' end
    from claimed c;
end $$;

create or replace function public.claim_plus_pushes()
returns table (user_id uuid, title text, body text, kind text)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  update private.plus_pushes p set pushed_at = now()
   where p.pushed_at is null and p.created_at > now() - interval '2 days'
  returning p.user_id, p.title, p.body, p.kind;
end $$;

revoke execute on function public.claim_admin_payment_pushes(), public.claim_plus_pushes() from public, anon, authenticated;
grant execute on function public.claim_admin_payment_pushes(), public.claim_plus_pushes() to service_role;

-- La de la 045, con los avisos de pagos como trabajo pendiente.
create or replace function private.dispatch_pending_pushes()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_url text; v_anon text; v_secret text;
begin
  if not exists (select 1 from public.trip_alert_hits where pushed_at is null and created_at > now() - interval '1 day')
     and not exists (select 1 from public.recurring_trips r join public.trips t on t.recurring_trip_id = r.id
                      where t.created_at > r.avisado_at and t.salida_at > now() and r.avisado_at < now() - interval '20 hours')
     and not exists (select 1 from private.admin_review_pushes
                      where pushed_at is null and dia = (now() at time zone 'America/Bogota')::date)
     and not exists (select 1 from private.admin_safety_pushes
                      where pushed_at is null and created_at > now() - interval '1 day')
     and not exists (select 1 from private.admin_payment_pushes
                      where pushed_at is null and created_at > now() - interval '1 day')
     and not exists (select 1 from private.plus_pushes
                      where pushed_at is null and created_at > now() - interval '2 days') then
    return;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'convia_project_url';
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'convia_anon_key';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'convia_cron_secret';
  if v_url is null or v_anon is null or v_secret is null then return; end if;
  perform net.http_post(
    url := v_url || '/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon, 'x-convia-cron', v_secret),
    body := jsonb_build_object('event', 'sweep'));
end $$;
revoke execute on function private.dispatch_pending_pushes() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Lo que usa la app
-- ---------------------------------------------------------------------
-- Con los pagos apagados (o sin llave/titular) solo {"enabled": false}.
create or replace function public.get_plus_payment_info()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not private.payments_ready() then jsonb_build_object('enabled', false)
    else jsonb_build_object(
      'enabled', true,
      'bre_b_key', btrim(c.bre_b_key),
      'payee_name', btrim(c.payee_name),
      'max_pending', 3,
      'prices', coalesce((select jsonb_agg(jsonb_build_object('period', p.period, 'months', p.months, 'amount_cop', p.amount_cop)
                                           order by p.months) from public.plus_prices p), '[]'::jsonb))
    end
    from public.app_config c where c.id
$$;

create or replace function private.new_payment_reference()
returns text language plpgsql volatile set search_path = '' as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_ref text;
begin
  for attempt in 1..20 loop
    v_ref := 'CV-';
    for i in 1..4 loop
      v_ref := v_ref || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1);
    end loop;
    if not exists (select 1 from public.payment_requests where reference = v_ref) then return v_ref; end if;
  end loop;
  raise exception 'PAYMENT_REFERENCE_EXHAUSTED';
end $$;
revoke execute on function private.new_payment_reference() from public, anon, authenticated;

-- Paso 1: la referencia que la persona escribe en la descripción de la transferencia.
-- Reutiliza la referencia aún no enviada del mismo periodo (con el precio de hoy).
create or replace function public.start_plus_payment(p_period text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user  uuid := auth.uid();
  v_price public.plus_prices;
  v_row   public.payment_requests;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if not private.payments_enabled() then raise exception 'PAYMENTS_DISABLED'; end if;
  if not private.payments_ready() then raise exception 'PAYMENTS_NOT_CONFIGURED'; end if;
  select * into v_price from public.plus_prices where period = p_period;
  if not found then raise exception 'PAYMENT_PERIOD_INVALID'; end if;

  perform pg_advisory_xact_lock(hashtextextended('plus-payment:' || v_user::text, 0));
  if (select count(*) from public.payment_requests where user_id = v_user and status = 'pending') >= 3 then
    raise exception 'PAYMENT_PENDING_LIMIT';
  end if;

  update public.payment_requests set amount_cop = v_price.amount_cop, months = v_price.months
   where user_id = v_user and status = 'draft' and period = p_period
  returning * into v_row;
  if not found then
    insert into public.payment_requests (reference, user_id, period, months, amount_cop)
    values (private.new_payment_reference(), v_user, p_period, v_price.months, v_price.amount_cop)
    returning * into v_row;
  end if;

  return (select jsonb_build_object(
    'reference', v_row.reference, 'period', v_row.period, 'months', v_row.months, 'amount_cop', v_row.amount_cop,
    'bre_b_key', btrim(c.bre_b_key), 'payee_name', btrim(c.payee_name))
    from public.app_config c where c.id);
end $$;

-- Paso 2: "Ya pagué". p_receipt: una ruta ya subida a payment-receipts/<user_id>/<uuid>.jpg, o null.
create or replace function public.confirm_plus_payment(p_reference text, p_receipt text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_row  public.payment_requests;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if not private.payments_enabled() then raise exception 'PAYMENTS_DISABLED'; end if;

  perform pg_advisory_xact_lock(hashtextextended('plus-payment:' || v_user::text, 0));
  select * into v_row from public.payment_requests
   where reference = upper(btrim(coalesce(p_reference, ''))) and user_id = v_user
   for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v_row.status = 'pending' then
    return jsonb_build_object('reference', v_row.reference, 'status', v_row.status);
  end if;
  if v_row.status <> 'draft' then raise exception 'PAYMENT_ALREADY_DECIDED'; end if;
  if (select count(*) from public.payment_requests where user_id = v_user and status = 'pending') >= 3 then
    raise exception 'PAYMENT_PENDING_LIMIT';
  end if;
  if p_receipt is not null and (
       p_receipt !~ ('^' || v_user::text || '/[0-9a-f-]{36}\.jpg$')
       or not exists (select 1 from storage.objects o where o.bucket_id = 'payment-receipts' and o.name = p_receipt)) then
    raise exception 'PAYMENT_RECEIPT_INVALID';
  end if;

  update public.payment_requests
     set status = 'pending', submitted_at = now(), receipt_path = p_receipt
   where id = v_row.id;

  perform private.enqueue_admin_payment_pushes();
  -- pg_net envía la llamada a notify al confirmar la transacción.
  perform private.dispatch_pending_pushes();
  return jsonb_build_object('reference', v_row.reference, 'status', 'pending');
end $$;

revoke execute on function public.get_plus_payment_info(), public.start_plus_payment(text),
  public.confirm_plus_payment(text, text) from public, anon;
grant execute on function public.get_plus_payment_info(), public.start_plus_payment(text),
  public.confirm_plus_payment(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Decisiones del equipo (solo service_role: npm run plus)
-- ---------------------------------------------------------------------
-- Activa o extiende ConVía+ 1 o 12 meses desde el fin del periodo vigente (o desde hoy).
-- p_amount: lo que llegó (por defecto, el precio de la referencia); p_paid_on: fecha del pago.
create or replace function public.service_grant_plus_payment(
  p_reference text,
  p_amount    integer default null,
  p_paid_on   date default null
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_row   public.payment_requests;
  v_sub   public.subscriptions;
  v_start timestamptz;
  v_end   timestamptz;
begin
  if not private.payments_enabled() then raise exception 'PAYMENTS_DISABLED'; end if;
  select * into v_row from public.payment_requests where reference = upper(btrim(coalesce(p_reference, ''))) for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v_row.status not in ('draft', 'pending') then raise exception 'PAYMENT_ALREADY_DECIDED'; end if;
  if v_row.user_id is null then raise exception 'PAYMENT_USER_DELETED'; end if;
  if p_amount is not null and p_amount <= 0 then raise exception 'PAYMENT_AMOUNT_INVALID'; end if;

  select * into v_sub from public.subscriptions where user_id = v_row.user_id for update;
  if found and v_sub.tier = 'plus' and v_sub.status in ('active', 'trialing') and v_sub.current_period_end is null then
    raise exception 'PLUS_NO_EXPIRY';
  end if;
  v_start := case when found and v_sub.tier = 'plus' and v_sub.status in ('active', 'trialing') and v_sub.current_period_end > now()
                  then v_sub.current_period_end else now() end;
  v_end := v_start + make_interval(months => v_row.months);

  insert into public.subscriptions (user_id, tier, status, current_period_end, provider)
  values (v_row.user_id, 'plus', 'active', v_end, 'transferencia')
  on conflict (user_id) do update
    set tier = 'plus', status = 'active', current_period_end = excluded.current_period_end, provider = 'transferencia';

  update public.payment_requests
     set status = 'granted', decided_at = now(), reject_reason = null,
         paid_amount_cop = coalesce(p_amount, v_row.amount_cop),
         paid_on = coalesce(p_paid_on, (now() at time zone 'America/Bogota')::date),
         period_start = v_start, period_end = v_end,
         submitted_at = coalesce(submitted_at, now())
   where id = v_row.id;

  insert into private.plus_pushes (user_id, kind, dedupe, title, body)
  values (v_row.user_id, 'granted', v_row.reference, 'ConVía+',
          'ConVía+ activo hasta el ' || private.fecha_es(v_end) || '. ¡Gracias por tu pago!')
  on conflict (user_id, kind, dedupe) do nothing;
  perform private.dispatch_pending_pushes();

  return jsonb_build_object('reference', v_row.reference, 'user_id', v_row.user_id,
                            'period_start', v_start, 'period_end', v_end);
end $$;

create or replace function public.service_reject_plus_payment(p_reference text, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_row    public.payment_requests;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not private.payments_enabled() then raise exception 'PAYMENTS_DISABLED'; end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 300 then raise exception 'PAYMENT_REASON_REQUIRED'; end if;
  select * into v_row from public.payment_requests where reference = upper(btrim(coalesce(p_reference, ''))) for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v_row.status not in ('draft', 'pending') then raise exception 'PAYMENT_ALREADY_DECIDED'; end if;

  update public.payment_requests set status = 'rejected', decided_at = now(), reject_reason = v_reason
   where id = v_row.id;

  if v_row.user_id is not null then
    insert into private.plus_pushes (user_id, kind, dedupe, title, body)
    values (v_row.user_id, 'rejected', v_row.reference, 'ConVía+',
            left('No pudimos confirmar tu pago ' || v_row.reference || ': ' || v_reason, 300))
    on conflict (user_id, kind, dedupe) do nothing;
    perform private.dispatch_pending_pushes();
  end if;
  return jsonb_build_object('reference', v_row.reference, 'status', 'rejected');
end $$;

revoke execute on function public.service_grant_plus_payment(text, integer, date),
  public.service_reject_plus_payment(text, text) from public, anon, authenticated;
grant execute on function public.service_grant_plus_payment(text, integer, date),
  public.service_reject_plus_payment(text, text) to service_role;

-- ---------------------------------------------------------------------
-- 6. Trabajo diario: vencimientos, aviso previo y limpieza
-- ---------------------------------------------------------------------
-- Solo toca suscripciones pagadas por transferencia: las activadas a mano no cambian.
create or replace function private.plus_payments_daily()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_expired integer;
  v_warned  integer;
begin
  update public.subscriptions set status = 'expired'
   where provider = 'transferencia' and tier = 'plus' and status in ('active', 'trialing')
     and current_period_end is not null and current_period_end <= now();
  get diagnostics v_expired = row_count;

  insert into private.plus_pushes (user_id, kind, dedupe, title, body)
    select s.user_id, 'expiring', s.current_period_end::text, 'ConVía+',
           'Tu ConVía+ vence el ' || private.fecha_es(s.current_period_end)
           || '. No se renueva solo: si quieres seguir, renuévalo desde la app.'
      from public.subscriptions s
     where s.provider = 'transferencia' and s.tier = 'plus' and s.status in ('active', 'trialing')
       and s.current_period_end > now() and s.current_period_end <= now() + interval '3 days'
  on conflict (user_id, kind, dedupe) do nothing;
  get diagnostics v_warned = row_count;

  -- Referencias nunca enviadas: 30 días. Registros decididos: 5 años. Comprobante: 30 días tras la decisión.
  delete from public.payment_requests where status = 'draft' and created_at < now() - interval '30 days';
  delete from public.payment_requests where status in ('granted', 'rejected') and decided_at < now() - interval '5 years';
  update public.payment_requests set receipt_path = null
   where receipt_path is not null and decided_at < now() - interval '30 days';
  delete from private.plus_pushes where created_at < now() - interval '30 days';

  if v_warned > 0 then perform private.dispatch_pending_pushes(); end if;
  return jsonb_build_object('expired', v_expired, 'warned', v_warned);
end $$;
revoke execute on function private.plus_payments_daily() from public, anon, authenticated;

-- Comprobantes que ya no se necesitan: no están en una solicitud abierta ni decidida hace menos de
-- 30 días (incluye subidas huérfanas de más de 1 día). Para card-review-cleanup (API de Storage).
create or replace function public.service_expired_payment_receipts()
returns setof text language sql stable security definer set search_path = '' as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'payment-receipts'
     and o.created_at < now() - interval '1 day'
     and not exists (select 1 from public.payment_requests r
                      where r.receipt_path = o.name
                        and (r.status in ('draft', 'pending') or r.decided_at > now() - interval '30 days'))
   order by o.created_at
   limit 1000
$$;
revoke execute on function public.service_expired_payment_receipts() from public, anon, authenticated;
grant execute on function public.service_expired_payment_receipts() to service_role;

-- La limpieza diaria de la 045, ahora también para los comprobantes.
create or replace function private.dispatch_card_review_cleanup()
returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_anon text; v_secret text;
begin
  if not exists (select 1 from public.service_expired_card_review_files())
     and not exists (select 1 from public.service_expired_feedback_files())
     and not exists (select 1 from public.service_expired_payment_receipts()) then
    return;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'convia_project_url';
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'convia_anon_key';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'convia_cron_secret';
  if v_url is null or v_anon is null or v_secret is null then return; end if;
  perform net.http_post(
    url := v_url || '/functions/v1/card-review-cleanup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon, 'x-convia-cron', v_secret),
    body := '{}'::jsonb);
end $$;
revoke execute on function private.dispatch_card_review_cleanup() from public, anon, authenticated;

-- 13:05 UTC = 08:05 en Bogotá.
select cron.unschedule(jobid) from cron.job where jobname = 'plus-payments-daily';
select cron.schedule('plus-payments-daily', '5 13 * * *', $$select private.plus_payments_daily()$$);
