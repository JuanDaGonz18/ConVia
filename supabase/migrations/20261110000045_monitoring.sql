-- =====================================================================
-- ConVía — errores de la app, eventos de uso, captura en los reportes y
-- avisos de reportes a los administradores
--
-- Todo en el mismo Supabase, sin servicios nuevos ($0):
--
-- A. client_errors y app_events: la app solo INSERTA, y solo por las RPC
--    report_client_error / track_app_event (SECURITY DEFINER), con límite por
--    usuario (los no autenticados comparten un cupo global). Nadie las lee
--    desde la app: solo service_role (scripts/admin: npm run errors). Sin datos
--    personales: la app limpia el texto antes de enviarlo y el servidor vuelve
--    a quitar correos; los eventos son una lista cerrada de nombres con props
--    escalares y cortas. Se borran a los 90 días (cleanup-monitoring).
--
-- B. feedback_reports (migración 044) acepta una captura opcional en el bucket
--    privado feedback (<user_id>/<uuid>.jpg): submit_feedback gana
--    p_screenshot. Las capturas se borran a los 30 días (card-review-cleanup,
--    por la API de Storage) y con la cuenta (delete-account).
--
-- C. Administradores (private.admins, migración 041): el aviso diario suma
--    "N reportes nuevos" (estado 'nuevo'), y un reporte de categoría 'safety'
--    dispara al instante un aviso que solo dice cuántos de seguridad hay
--    abiertos (sin texto del reporte ni de quién es).
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. Errores y eventos
-- ---------------------------------------------------------------------
create table public.client_errors (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete cascade,
  message     text not null check (char_length(message) between 1 and 500),
  stack       text check (stack is null or char_length(stack) <= 4000),
  screen      text check (screen is null or char_length(screen) <= 120),
  app_version text check (app_version is null or app_version ~ '^[0-9A-Za-z.+-]{1,32}$'),
  platform    text not null check (platform in ('ios', 'android', 'web', 'unknown')),
  fatal       boolean not null default false,
  created_at  timestamptz not null default now()
);
create index client_errors_user_created_idx on public.client_errors (user_id, created_at);
create index client_errors_created_idx on public.client_errors (created_at);

-- La lista cerrada de eventos (la misma de src/services/monitoringCore.ts).
create table public.app_events (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete cascade,
  name        text not null check (name in ('signup', 'login', 'search', 'request_seat', 'publish_trip',
                                            'accept_request', 'boarding_qr', 'pickup_verify', 'chat_send', 'plan_view')),
  props       jsonb not null default '{}'::jsonb
                check (jsonb_typeof(props) = 'object' and pg_column_size(props) <= 512),
  app_version text check (app_version is null or app_version ~ '^[0-9A-Za-z.+-]{1,32}$'),
  platform    text not null check (platform in ('ios', 'android', 'web', 'unknown')),
  created_at  timestamptz not null default now()
);
create index app_events_user_created_idx on public.app_events (user_id, created_at);
create index app_events_created_idx on public.app_events (created_at);

alter table public.client_errors enable row level security;
alter table public.app_events enable row level security;
revoke all on public.client_errors, public.app_events from public, anon, authenticated;
grant select, delete on public.client_errors, public.app_events to service_role;

-- Correos fuera del texto (la app ya los quita; esto es la segunda capa).
create or replace function private.scrub_text(p_text text, p_max integer)
returns text language sql immutable set search_path = '' as $$
  select nullif(left(regexp_replace(coalesce(p_text, ''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', 'g'), p_max), '')
$$;

create or replace function private.clean_platform(p text)
returns text language sql immutable set search_path = '' as $$
  select case when p in ('ios', 'android', 'web') then p else 'unknown' end
$$;

create or replace function private.clean_version(p text)
returns text language sql immutable set search_path = '' as $$
  select case when p ~ '^[0-9A-Za-z.+-]{1,32}$' then p end
$$;

-- ¿Cabe uno más? Serializado por usuario (o por el cupo anónimo) para que llamadas
-- simultáneas no lo superen. p_kind: 'error' | 'event'.
create or replace function private.monitoring_allowed(p_kind text, p_user uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  v_limit integer := case
    when p_kind = 'error' then case when p_user is null then 300 else 30 end
    else case when p_user is null then 500 else 200 end end;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('monitoring:' || p_kind || ':' || coalesce(p_user::text, 'anon'), 0));
  if p_kind = 'error' then
    select count(*) into v_count from public.client_errors
     where user_id is not distinct from p_user and created_at > now() - interval '1 hour';
  else
    select count(*) into v_count from public.app_events
     where user_id is not distinct from p_user and created_at > now() - interval '1 hour';
  end if;
  return v_count < v_limit;
end $$;

-- Devuelve true si lo guardó; false si el límite está lleno (la app no reintenta).
create or replace function public.report_client_error(
  p_message     text,
  p_stack       text default null,
  p_screen      text default null,
  p_app_version text default null,
  p_platform    text default null,
  p_fatal       boolean default false
) returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_message text := private.scrub_text(p_message, 500);
begin
  if v_message is null then return false; end if;
  if not private.monitoring_allowed('error', v_user) then return false; end if;
  insert into public.client_errors (user_id, message, stack, screen, app_version, platform, fatal)
  values (v_user, v_message, private.scrub_text(p_stack, 4000), private.scrub_text(p_screen, 120),
          private.clean_version(p_app_version), private.clean_platform(p_platform), coalesce(p_fatal, false));
  return true;
end $$;

-- Props: solo claves cortas con valores escalares (texto de hasta 40, número o booleano), máx. 8.
create or replace function public.track_app_event(
  p_name        text,
  p_props       jsonb default '{}'::jsonb,
  p_app_version text default null,
  p_platform    text default null
) returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user  uuid := auth.uid();
  v_props jsonb;
begin
  if p_name is null or p_name not in ('signup', 'login', 'search', 'request_seat', 'publish_trip',
                                      'accept_request', 'boarding_qr', 'pickup_verify', 'chat_send', 'plan_view') then
    return false;
  end if;
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_props
    from (select key, value from jsonb_each(case when jsonb_typeof(p_props) = 'object' then p_props else '{}'::jsonb end)
           where key ~ '^[a-z_]{1,24}$'
             and (jsonb_typeof(value) in ('number', 'boolean')
                  or (jsonb_typeof(value) = 'string' and char_length(value #>> '{}') <= 40))
           order by key limit 8) e;
  if pg_column_size(v_props) > 512 then v_props := '{}'::jsonb; end if;
  if not private.monitoring_allowed('event', v_user) then return false; end if;
  insert into public.app_events (user_id, name, props, app_version, platform)
  values (v_user, p_name, v_props, private.clean_version(p_app_version), private.clean_platform(p_platform));
  return true;
end $$;

-- Errores más frecuentes de los últimos p_days días (scripts/admin: npm run errors).
create or replace function public.service_top_client_errors(p_days integer default 7, p_limit integer default 20)
returns table (
  message text, occurrences bigint, users bigint, fatal bigint, screens text[], platforms text[],
  versions text[], first_seen timestamptz, last_seen timestamptz, sample_stack text
) language sql stable security definer set search_path = '' as $$
  select e.message, count(*), count(distinct e.user_id), count(*) filter (where e.fatal),
         (array_agg(distinct e.screen) filter (where e.screen is not null))[1:5],
         array_agg(distinct e.platform),
         (array_agg(distinct e.app_version) filter (where e.app_version is not null))[1:5],
         min(e.created_at), max(e.created_at),
         (array_agg(e.stack order by e.created_at desc) filter (where e.stack is not null))[1]
    from public.client_errors e
   where e.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 90)))
   group by e.message
   order by count(*) desc, max(e.created_at) desc
   limit greatest(1, least(coalesce(p_limit, 20), 100))
$$;

-- ---------------------------------------------------------------------
-- B. Captura en los reportes
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('feedback', 'feedback', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

-- La persona sube su captura a su carpeta (y puede verla o quitarla si el envío falla).
create policy "feedback_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'feedback' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "feedback_read_own" on storage.objects for select to authenticated
  using (bucket_id = 'feedback' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "feedback_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'feedback' and (storage.foldername(name))[1] = (select auth.uid())::text);

alter table public.feedback_reports
  add column if not exists screenshot_path text check (screenshot_path is null or char_length(screenshot_path) <= 200);

-- La de la migración 044 (mismas reglas y límites) con p_screenshot: una ruta ya subida a
-- feedback/<user_id>/<uuid>.jpg, o null. Las llamadas con cuatro argumentos siguen igual.
drop function if exists public.submit_feedback(text, text, text, text);
create or replace function public.submit_feedback(
  p_category    text,
  p_description text,
  p_app_version text default null,
  p_platform    text default null,
  p_screenshot  text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_text text := btrim(coalesce(p_description, ''));
  v_id uuid;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_category is null or p_category not in ('bug', 'suggestion', 'safety', 'other') then
    raise exception 'FEEDBACK_CATEGORY_INVALID';
  end if;
  if char_length(v_text) < 10 then raise exception 'FEEDBACK_TOO_SHORT'; end if;
  if char_length(v_text) > 1000 then raise exception 'FEEDBACK_TOO_LONG'; end if;
  if p_screenshot is not null and (
       p_screenshot !~ ('^' || v_user::text || '/[0-9a-f-]{36}\.jpg$')
       or not exists (select 1 from storage.objects o where o.bucket_id = 'feedback' and o.name = p_screenshot)) then
    raise exception 'FEEDBACK_SCREENSHOT_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('feedback:' || v_user::text, 0));
  if (select count(*) from public.feedback_reports
       where user_id = v_user and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.feedback_reports
          where user_id = v_user and created_at > now() - interval '1 day') >= 20 then
    raise exception 'FEEDBACK_RATE_LIMIT';
  end if;

  insert into public.feedback_reports (user_id, category, description, app_version, platform, screenshot_path)
  values (v_user, p_category, v_text, left(p_app_version, 40),
          case when p_platform in ('ios', 'android', 'web') then p_platform end, p_screenshot)
  returning id into v_id;
  return v_id;
end $$;

-- Capturas de más de p_older_than (para card-review-cleanup, que las borra por la API de Storage).
create or replace function public.service_expired_feedback_files(p_older_than interval default interval '30 days')
returns setof text language sql stable security definer set search_path = '' as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'feedback'
     and o.created_at < now() - p_older_than
   order by o.created_at
   limit 1000
$$;

-- La limpieza diaria de la migración 038, ahora también para las capturas de los reportes.
create or replace function private.dispatch_card_review_cleanup()
returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_anon text; v_secret text;
begin
  if not exists (select 1 from public.service_expired_card_review_files())
     and not exists (select 1 from public.service_expired_feedback_files()) then
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

-- ---------------------------------------------------------------------
-- C. Avisos a los administradores
-- ---------------------------------------------------------------------
-- C.1 El aviso diario (041) suma los reportes en estado 'nuevo'.
alter table private.admin_review_pushes
  add column if not exists reportes integer not null default 0 check (reportes >= 0);

create or replace function private.enqueue_admin_review_pushes()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_dia   date := (now() at time zone 'America/Bogota')::date;
  v_cards integer := (select count(*) from public.institution_memberships where status = 'review');
  v_inst  integer := (select count(*) from public.institution_requests where estado = 'pendiente');
  v_rep   integer := (select count(*) from public.feedback_reports where status = 'nuevo');
  v_n     integer;
begin
  delete from private.admin_review_pushes where dia < v_dia - 30;
  if v_cards = 0 and v_inst = 0 and v_rep = 0 then return 0; end if;
  insert into private.admin_review_pushes (user_id, dia, carnes, instituciones, reportes)
    select a.user_id, v_dia, v_cards, v_inst, v_rep from private.admins a
  on conflict (user_id, dia) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- El texto de la 041 cuando hay carnés o instituciones; los reportes se suman al final.
create or replace function public.claim_admin_review_pushes()
returns table (user_id uuid, title text, body text)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with claimed as (
    update private.admin_review_pushes p set pushed_at = now()
     where p.pushed_at is null and p.dia = (now() at time zone 'America/Bogota')::date
    returning p.user_id, p.carnes, p.instituciones, p.reportes
  )
  select c.user_id, 'ConVía'::text,
         concat_ws(' · ',
           case when c.carnes + c.instituciones > 0 then
             c.carnes || case when c.carnes = 1 then ' carné' else ' carnés' end || ' y '
             || c.instituciones || case when c.instituciones = 1 then ' institución' else ' instituciones' end
             || ' por revisar' end,
           case when c.reportes > 0 then
             c.reportes || case when c.reportes = 1 then ' reporte nuevo' else ' reportes nuevos' end end)
    from claimed c;
end $$;

-- C.2 Un reporte 'safety' avisa enseguida: una fila por administrador con el número de
-- reportes de seguridad abiertos; si aún no salió el anterior, solo se actualiza el número.
create table private.admin_safety_pushes (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  reportes   integer not null check (reportes >= 0),
  created_at timestamptz not null default now(),
  pushed_at  timestamptz
);
revoke all on private.admin_safety_pushes from public, anon, authenticated;
grant select on private.admin_safety_pushes to service_role;

create or replace function private.on_safety_report()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_open integer := (select count(*) from public.feedback_reports where category = 'safety' and status = 'nuevo');
begin
  insert into private.admin_safety_pushes (user_id, reportes)
    select a.user_id, v_open from private.admins a
  on conflict (user_id) do update set reportes = excluded.reportes, created_at = now(), pushed_at = null;
  -- pg_net envía la llamada a notify al confirmar la transacción.
  perform private.dispatch_pending_pushes();
  return null;
end $$;

drop trigger if exists feedback_reports_safety_push on public.feedback_reports;
create trigger feedback_reports_safety_push
  after insert on public.feedback_reports
  for each row when (new.category = 'safety') execute function private.on_safety_report();

-- Para notify (sweep): los avisos de seguridad pendientes, ya marcados. Solo el número.
create or replace function public.claim_admin_safety_pushes()
returns table (user_id uuid, title text, body text)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with claimed as (
    update private.admin_safety_pushes p set pushed_at = now()
     where p.pushed_at is null and p.created_at > now() - interval '1 day'
    returning p.user_id, p.reportes
  )
  select c.user_id, 'ConVía · seguridad'::text,
         greatest(c.reportes, 1) || case when greatest(c.reportes, 1) = 1
           then ' reporte de seguridad por revisar' else ' reportes de seguridad por revisar' end
    from claimed c;
end $$;

-- La de la 041, con los avisos de seguridad como trabajo pendiente.
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
                      where pushed_at is null and created_at > now() - interval '1 day') then
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

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke execute on function private.scrub_text(text, integer), private.clean_platform(text), private.clean_version(text),
  private.monitoring_allowed(text, uuid), private.enqueue_admin_review_pushes(), private.dispatch_card_review_cleanup(),
  private.on_safety_report(), private.dispatch_pending_pushes()
  from public, anon, authenticated;
grant execute on function private.scrub_text(text, integer), private.clean_platform(text), private.clean_version(text),
  private.monitoring_allowed(text, uuid) to service_role;

revoke execute on function public.report_client_error(text, text, text, text, text, boolean),
  public.track_app_event(text, jsonb, text, text) from public;
grant execute on function public.report_client_error(text, text, text, text, text, boolean),
  public.track_app_event(text, jsonb, text, text) to anon, authenticated, service_role;

revoke execute on function public.submit_feedback(text, text, text, text, text) from public, anon;
grant execute on function public.submit_feedback(text, text, text, text, text) to authenticated, service_role;

revoke execute on function public.service_top_client_errors(integer, integer), public.service_expired_feedback_files(interval),
  public.claim_admin_review_pushes(), public.claim_admin_safety_pushes() from public, anon, authenticated;
grant execute on function public.service_top_client_errors(integer, integer), public.service_expired_feedback_files(interval),
  public.claim_admin_review_pushes(), public.claim_admin_safety_pushes() to service_role;

-- ---------------------------------------------------------------------
-- Limpieza diaria: errores y eventos a los 90 días, reportes al año. La ruta de una
-- captura vencida se quita del reporte (el archivo lo borra card-review-cleanup).
-- ---------------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'cleanup-monitoring';
select cron.schedule('cleanup-monitoring', '53 3 * * *', $$
  delete from public.client_errors where created_at < now() - interval '90 days';
  delete from public.app_events where created_at < now() - interval '90 days';
  delete from public.feedback_reports where created_at < now() - interval '365 days';
  update public.feedback_reports set screenshot_path = null
   where screenshot_path is not null and created_at < now() - interval '30 days';
$$);
