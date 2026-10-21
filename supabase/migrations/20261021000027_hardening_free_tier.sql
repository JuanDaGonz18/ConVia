-- =====================================================================
-- ConVía — seguridad y consumo del plan Free
--
--  A. Microsoft (Entra ID): el servidor solo acepta identidades de Azure
--     cuyo tenant esté en una lista explícita de instituciones, y cuyo
--     correo sea del dominio de esa misma institución. Así una cuenta de
--     otro tenant no puede entrar ni quedar enlazada a una cuenta existente
--     solo porque el correo coincide (Supabase enlaza por correo). Si el
--     tenant no viene en la identidad, se rechaza (falla cerrado).
--  B. Un viaje con solicitudes (aunque estén pendientes) ya no se puede
--     borrar por la API; se cancela con cancel_trip(), que avisa.
--  C. Menos consumo: realtime deja de publicar tablas que la app no escucha,
--     se limpian registros que crecen sin límite y los buckets aceptan
--     archivos más pequeños (la app ya los comprime).
--
--  Reversión (manual, si hiciera falta):
--    drop trigger if exists azure_identity_guard on auth.identities;
--    alter publication supabase_realtime add table public.trips, public.trip_locations;
--    select cron.unschedule('cleanup-logs'); select cron.unschedule('cleanup-alert-hits');
--    update storage.buckets set file_size_limit = 5242880 where id = 'avatars';
--    update storage.buckets set file_size_limit = 10485760 where id = 'vehicle-photos';
--    (la política de borrado anterior está en la migración 5).
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. Tenants de Microsoft autorizados por institución
-- ---------------------------------------------------------------------
create table public.institution_identity_providers (
  provider        text not null check (provider in ('azure')),
  -- Directory (tenant) ID de Microsoft Entra, en minúsculas.
  tenant_id       text not null check (tenant_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  institution_id  uuid not null references public.institutions(id) on delete cascade,
  activo          boolean not null default true,
  created_at      timestamptz not null default now(),
  primary key (provider, tenant_id)
);
-- Solo administradores (SQL / service role). La app no lo lee ni lo escribe.
alter table public.institution_identity_providers enable row level security;
revoke all on public.institution_identity_providers from anon, authenticated;
grant all on public.institution_identity_providers to service_role;

-- Tenant de una identidad de Azure: custom_claims.tid, o el emisor
-- https://login.microsoftonline.com/<tenant>/v2.0.
create or replace function private.azure_tenant(p_identity jsonb)
returns text language sql immutable set search_path = '' as $$
  select lower(coalesce(
    nullif(p_identity -> 'custom_claims' ->> 'tid', ''),
    substring(p_identity ->> 'iss' from '^https://login\.microsoftonline\.com/([0-9a-fA-F-]{36})/v2\.0/?$')))
$$;
revoke execute on function private.azure_tenant(jsonb) from public, anon, authenticated;

create or replace function private.azure_identity_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_tenant text := private.azure_tenant(new.identity_data);
  v_email text := lower(coalesce(new.identity_data ->> 'email', (select email from auth.users where id = new.user_id)));
  v_institution uuid;
begin
  if new.provider <> 'azure' then return new; end if;
  select p.institution_id into v_institution
    from public.institution_identity_providers p
    join public.institutions i on i.id = p.institution_id and i.activo
   where p.provider = 'azure' and p.activo and p.tenant_id = v_tenant;
  if v_tenant is null or v_institution is null then
    raise exception 'TENANT_NO_AUTORIZADO' using errcode = 'P0001';
  end if;
  -- El correo debe ser del dominio de la institución dueña del tenant.
  if v_email is null or not exists (
       select 1 from public.institutions i where i.id = v_institution and i.dominio = split_part(v_email, '@', 2)) then
    raise exception 'TENANT_NO_AUTORIZADO' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function private.azure_identity_guard() from public, anon, authenticated;

drop trigger if exists azure_identity_guard on auth.identities;
create trigger azure_identity_guard
  before insert or update of identity_data, provider on auth.identities
  for each row execute function private.azure_identity_guard();

-- Perfil nuevo: Microsoft envía el nombre como full_name / name.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_inst uuid;
begin
  select id into v_inst from public.institutions
  where activo and dominio = lower(split_part(new.email, '@', 2));
  if v_inst is null then
    raise exception 'DOMINIO_NO_PERMITIDO: % no pertenece a una institución registrada', split_part(new.email, '@', 2)
      using errcode = 'P0001';
  end if;
  insert into public.profiles (id, email, nombre, rol, institution_id, terms_accepted_at)
  values (
    new.id, new.email,
    left(coalesce(nullif(new.raw_user_meta_data->>'nombre', ''), new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), 120),
    coalesce((new.raw_user_meta_data->>'rol')::public.user_role, 'usuario'),
    v_inst,
    case when (new.raw_user_meta_data->>'terms_accepted')::boolean then now() end
  );
  return new;
end $$;

-- ---------------------------------------------------------------------
-- B. Borrar un viaje solo si nadie lo ha pedido
-- ---------------------------------------------------------------------
drop policy if exists "trips_delete_own_pending" on public.trips;
create policy "trips_delete_own_pending" on public.trips for delete to authenticated
  using (
    driver_id = (select auth.uid())
    and estado = 'por_empezar'
    and not exists (select 1 from public.trip_requests r where r.trip_id = trips.id
                     and r.estado in ('pendiente', 'aceptado', 'abordado'))
  );

-- ---------------------------------------------------------------------
-- C. Consumo
-- ---------------------------------------------------------------------
-- Realtime: la app escucha messages, trip_requests y driver_profiles.
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trips') then
    alter publication supabase_realtime drop table public.trips;
  end if;
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trip_locations') then
    alter publication supabase_realtime drop table public.trip_locations;
  end if;
end $$;

-- Historial de pg_cron (crece con cada ejecución): se guardan 7 días.
-- Alertas de viajes que salieron hace más de 30 días: ya no sirven.
select cron.unschedule(jobid) from cron.job where jobname in ('cleanup-logs', 'cleanup-alert-hits');
select cron.schedule('cleanup-logs', '17 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);
select cron.schedule('cleanup-alert-hits', '23 3 * * *',
  $$delete from public.trip_alert_hits h using public.trips t
     where t.id = h.trip_id and t.salida_at < now() - interval '30 days'$$);

-- Archivos: la app sube fotos redimensionadas (unos cientos de KB); el margen
-- es para las versiones instaladas que aún no comprimen (avatares de ~2 MB).
update storage.buckets set file_size_limit = 3145728 where id = 'avatars';
update storage.buckets set file_size_limit = 4194304 where id = 'vehicle-photos';
