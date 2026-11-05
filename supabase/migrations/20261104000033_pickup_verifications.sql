-- =====================================================================
-- ConVía — Verificación del carro al recoger (Edge Function verify-pickup)
--
-- El pasajero graba un clip corto del carro que llega; la función lo
-- analiza con SAM 3.1 + Muse Spark 1.3 y responde si es el carro del viaje.
-- El clip y sus fotogramas se borran al terminar: aquí solo queda el
-- resultado. Solo la función (service_role) escribe; el pasajero y el
-- conductor del viaje pueden leer los intentos de ese viaje.
--
-- Plan: capacidad pickup_verification (FREE) con el límite mensual
-- pickup_verifications_month (migración 031), revisados en la función.
--
-- Borrado programado: si la función no alcanza a borrar un clip (se cae,
-- se agota el tiempo), el trabajo cleanup-pickup-clips le pide cada 30
-- minutos que borre los archivos de más de una hora. El borrado va por la
-- API de Storage: Supabase no permite DELETE directo en storage.objects.
-- =====================================================================

create table public.pickup_verifications (
  id                uuid primary key default gen_random_uuid(),
  trip_id           uuid not null references public.trips(id) on delete cascade,
  request_id        uuid not null references public.trip_requests(id) on delete cascade,
  passenger_id      uuid not null references public.profiles(id) on delete cascade,
  driver_id         uuid not null references public.profiles(id) on delete cascade,
  status            text not null check (status in ('verified', 'mismatch', 'retry')),
  -- Código estable que la app traduce (p. ej. 'plate_match', 'no_plate').
  reason            text not null,
  plate_read        text,
  brand_read        text,
  color_read        text,
  confidence        real check (confidence between 0 and 1),
  brand_match       boolean,
  color_match       boolean,
  -- Fotogramas que cobró SAM 3.1 (costo) y duración de cada paso en ms.
  frames_processed  integer,
  latency_ms        integer not null,
  timings           jsonb not null default '{}'::jsonb,
  mock              boolean not null default false,
  -- El pasajero reportó un carro que no coincide.
  reported_at       timestamptz,
  created_at        timestamptz not null default now()
);
create index pickup_verifications_request_idx on public.pickup_verifications(request_id, created_at desc);
create index pickup_verifications_trip_idx on public.pickup_verifications(trip_id, created_at desc);
-- El límite mensual cuenta los intentos de cada pasajero.
create index pickup_verifications_passenger_idx on public.pickup_verifications(passenger_id, created_at desc);

alter table public.pickup_verifications enable row level security;

revoke all on public.pickup_verifications from public, anon, authenticated;
grant select on public.pickup_verifications to authenticated;
grant all on public.pickup_verifications to service_role;
create policy "pickup_verifications_read_trip" on public.pickup_verifications
  for select to authenticated
  using (passenger_id = (select auth.uid()) or driver_id = (select auth.uid()));

-- Reportar un carro que no coincide: solo el pasajero, solo un resultado 'mismatch', una vez.
create or replace function public.report_pickup_mismatch(p_verification_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.pickup_verifications
     set reported_at = now()
   where id = p_verification_id
     and passenger_id = (select auth.uid())
     and status = 'mismatch'
     and reported_at is null;
  if not found then raise exception 'pickup_report_not_allowed'; end if;
end;
$$;
revoke execute on function public.report_pickup_mismatch(uuid) from public, anon;
grant execute on function public.report_pickup_mismatch(uuid) to authenticated;

-- Clips privados: cada pasajero solo toca su carpeta (borrar exige también leer); nadie más los ve.
-- Tope de archivos por usuario, como own_files_insert (migración 030).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('pickup-clips', 'pickup-clips', false, 15728640, array['video/mp4', 'video/quicktime', 'image/jpeg'])
on conflict (id) do nothing;

create policy "pickup_clips_read_own" on storage.objects for select to authenticated
  using (bucket_id = 'pickup-clips' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "pickup_clips_insert_own" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pickup-clips'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and private.my_object_count(bucket_id) < 60
  );
create policy "pickup_clips_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'pickup-clips' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------
-- Borrado programado de clips y fotogramas olvidados
-- ---------------------------------------------------------------------
-- Archivos de pickup-clips con más de p_older_than de antigüedad (solo la Edge Function).
create or replace function public.service_stale_pickup_clips(
  p_older_than interval default interval '1 hour', p_limit integer default 1000)
returns setof text language sql stable security definer set search_path = '' as $$
  select o.name from storage.objects o
   where o.bucket_id = 'pickup-clips'
     and o.created_at < now() - p_older_than
   order by o.created_at
   limit least(greatest(p_limit, 1), 1000)
$$;
revoke execute on function public.service_stale_pickup_clips(interval, integer) from public, anon, authenticated;
grant execute on function public.service_stale_pickup_clips(interval, integer) to service_role;

-- Le pide a verify-pickup que borre los archivos vencidos, solo si hay alguno.
-- Usa los mismos secretos del Vault que el barrido de notify (migración 025).
create or replace function private.dispatch_pickup_clips_cleanup()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_url text; v_anon text; v_secret text;
begin
  if not exists (select 1 from storage.objects
                  where bucket_id = 'pickup-clips' and created_at < now() - interval '1 hour') then
    return;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'convia_project_url';
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'convia_anon_key';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'convia_cron_secret';
  if v_url is null or v_anon is null or v_secret is null then return; end if;
  perform net.http_post(
    url := v_url || '/functions/v1/verify-pickup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon, 'x-convia-cron', v_secret),
    body := jsonb_build_object('event', 'cleanup'));
end $$;
revoke execute on function private.dispatch_pickup_clips_cleanup() from public, anon, authenticated;
grant execute on function private.dispatch_pickup_clips_cleanup() to service_role;

select cron.schedule('cleanup-pickup-clips', '*/30 * * * *', $$select private.dispatch_pickup_clips_cleanup()$$);
