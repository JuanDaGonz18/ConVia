-- =====================================================================
-- ConVía — aviso a los administradores de revisión manual pendiente
--
-- private.admins: quién recibe el aviso (solo service_role y el SQL editor).
-- Dos veces al día (12:00 y 22:00 UTC = 07:00 y 17:00 en Bogotá), si hay
-- membresías en revisión o solicitudes de institución pendientes, se encola
-- UN aviso por administrador en private.admin_review_pushes. Como máximo uno
-- por administrador y día (de Bogotá): la corrida de las 22:00 solo avisa si
-- la de las 12:00 no lo hizo (p. ej. la cola estaba vacía por la mañana).
-- Si los dos conteos son 0 no se encola nada.
--
-- El envío es el de siempre: dispatch-pending-pushes (cada 5 min) ve el
-- aviso pendiente y llama a notify (sweep), que lo reclama con
-- claim_admin_review_pushes() y lo manda por Expo. Sin nombres ni imágenes:
-- solo los dos conteos. Costo: dos consultas al día; sin servicios nuevos.
-- =====================================================================

create table private.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
revoke all on private.admins from public, anon, authenticated;
grant select, insert, delete on private.admins to service_role;

create table private.admin_review_pushes (
  user_id      uuid not null references auth.users(id) on delete cascade,
  dia          date not null,
  carnes       integer not null check (carnes >= 0),
  instituciones integer not null check (instituciones >= 0),
  created_at   timestamptz not null default now(),
  pushed_at    timestamptz,
  primary key (user_id, dia)
);
revoke all on private.admin_review_pushes from public, anon, authenticated;
grant select on private.admin_review_pushes to service_role;

-- Encola un aviso por administrador si hay algo por revisar. Devuelve cuántos encoló.
create or replace function private.enqueue_admin_review_pushes()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_dia   date := (now() at time zone 'America/Bogota')::date;
  v_cards integer := (select count(*) from public.institution_memberships where status = 'review');
  v_inst  integer := (select count(*) from public.institution_requests where estado = 'pendiente');
  v_n     integer;
begin
  delete from private.admin_review_pushes where dia < v_dia - 30;
  if v_cards = 0 and v_inst = 0 then return 0; end if;
  insert into private.admin_review_pushes (user_id, dia, carnes, instituciones)
    select a.user_id, v_dia, v_cards, v_inst from private.admins a
  on conflict (user_id, dia) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function private.enqueue_admin_review_pushes() from public, anon, authenticated;

-- Para notify (sweep): devuelve los avisos de hoy aún no enviados y los marca.
create or replace function public.claim_admin_review_pushes()
returns table (user_id uuid, title text, body text)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with claimed as (
    update private.admin_review_pushes p set pushed_at = now()
     where p.pushed_at is null and p.dia = (now() at time zone 'America/Bogota')::date
    returning p.user_id, p.carnes, p.instituciones
  )
  select c.user_id, 'ConVía'::text,
         c.carnes || case when c.carnes = 1 then ' carné' else ' carnés' end || ' y '
         || c.instituciones || case when c.instituciones = 1 then ' institución' else ' instituciones' end
         || ' por revisar'
    from claimed c;
end $$;
revoke execute on function public.claim_admin_review_pushes() from public, anon, authenticated;
grant execute on function public.claim_admin_review_pushes() to service_role;

-- La misma función de la migración 025, con los avisos de administración como trabajo pendiente.
create or replace function private.dispatch_pending_pushes()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_url text; v_anon text; v_secret text;
begin
  if not exists (select 1 from public.trip_alert_hits where pushed_at is null and created_at > now() - interval '1 day')
     and not exists (select 1 from public.recurring_trips r join public.trips t on t.recurring_trip_id = r.id
                      where t.created_at > r.avisado_at and t.salida_at > now() and r.avisado_at < now() - interval '20 hours')
     and not exists (select 1 from private.admin_review_pushes
                      where pushed_at is null and dia = (now() at time zone 'America/Bogota')::date) then
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

select cron.unschedule(jobid) from cron.job where jobname = 'admin-review-alerts';
select cron.schedule('admin-review-alerts', '0 12,22 * * *', $$select private.enqueue_admin_review_pushes()$$);
