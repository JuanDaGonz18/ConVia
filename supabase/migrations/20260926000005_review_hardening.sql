-- =====================================================================
-- ConVía — revisión: seguridad y rendimiento
--  1. Helpers de RLS fuera de la API (schema private)
--  2. Políticas con (select auth.uid()) → se evalúa una vez por consulta
--  3. Índices en llaves foráneas
--  4. Re-solicitar un viaje tras cancelar / ser negado
--  5. El usuario no puede escribir mensajes como "asistente"
--  6. Solo se califica a participantes reales del viaje
--  7. Registro solo con dominios permitidos
--  8. Buckets públicos sin listado global
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Schema private para helpers (no expuesto por la Data API)
-- ---------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

alter function public.current_institution_id() set schema private;
alter function public.is_trip_driver(uuid)     set schema private;
alter function public.is_trip_passenger(uuid)  set schema private;
alter function public.seats_taken(uuid)        set schema private;

create or replace function private.is_trip_participant(p_trip_id uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.trips where id = p_trip_id and driver_id = p_user)
      or exists (select 1 from public.trip_requests where trip_id = p_trip_id and passenger_id = p_user
                 and estado in ('aceptado', 'abordado'))
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- funciones cuyo cuerpo llamaba a public.seats_taken
create or replace function public.respond_trip_request(p_request_id uuid, p_accept boolean)
returns public.trip_requests language plpgsql security definer set search_path = '' as $$
declare
  r public.trip_requests;
  t public.trips;
begin
  select * into r from public.trip_requests where id = p_request_id for update;
  if not found then raise exception 'Solicitud no encontrada'; end if;
  select * into t from public.trips where id = r.trip_id for update;
  if t.driver_id <> auth.uid() then raise exception 'No autorizado'; end if;
  if r.estado <> 'pendiente' then raise exception 'La solicitud ya fue respondida'; end if;
  if t.estado not in ('por_empezar', 'en_curso') then raise exception 'El viaje ya no admite cambios'; end if;
  if p_accept and private.seats_taken(t.id) >= t.cupos_totales then
    raise exception 'No hay cupos disponibles';
  end if;

  update public.trip_requests
     set estado = case when p_accept then 'aceptado'::public.request_status else 'negado'::public.request_status end,
         responded_at = now()
   where id = p_request_id
  returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- 7. Registro solo con dominio permitido
-- ---------------------------------------------------------------------
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
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nombre', ''),
    coalesce((new.raw_user_meta_data->>'rol')::public.user_role, 'usuario'),
    v_inst,
    case when (new.raw_user_meta_data->>'terms_accepted')::boolean then now() end
  );
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3. Índices en llaves foráneas
-- ---------------------------------------------------------------------
create index if not exists trips_vehicle_idx            on public.trips(vehicle_id);
create index if not exists ratings_trip_idx             on public.ratings(trip_id);
create index if not exists ratings_rater_idx            on public.ratings(rater_id);
create index if not exists assistant_messages_trip_idx  on public.assistant_messages(trip_id);

-- ---------------------------------------------------------------------
-- 4. Una solicitud activa por pasajero y viaje (se puede volver a pedir)
-- ---------------------------------------------------------------------
alter table public.trip_requests drop constraint if exists trip_requests_trip_id_passenger_id_key;
create unique index if not exists trip_requests_one_active
  on public.trip_requests(trip_id, passenger_id)
  where estado in ('pendiente', 'aceptado', 'abordado');

-- ---------------------------------------------------------------------
-- 2/5/6. Políticas reescritas
-- ---------------------------------------------------------------------
drop policy if exists "profiles_read_same_institution" on public.profiles;
drop policy if exists "profiles_update_own"            on public.profiles;
drop policy if exists "vehicles_read"                  on public.vehicles;
drop policy if exists "vehicles_insert_own"            on public.vehicles;
drop policy if exists "vehicles_update_own"            on public.vehicles;
drop policy if exists "vehicles_delete_own"            on public.vehicles;
drop policy if exists "trips_read"                     on public.trips;
drop policy if exists "trips_insert_driver"            on public.trips;
drop policy if exists "trips_update_own_pending"       on public.trips;
drop policy if exists "trips_delete_own_pending"       on public.trips;
drop policy if exists "requests_read"                  on public.trip_requests;
drop policy if exists "requests_insert_passenger"      on public.trip_requests;
drop policy if exists "locations_read"                 on public.trip_locations;
drop policy if exists "locations_write_driver"         on public.trip_locations;
drop policy if exists "locations_update_driver"        on public.trip_locations;
drop policy if exists "locations_delete_driver"        on public.trip_locations;
drop policy if exists "ratings_read"                   on public.ratings;
drop policy if exists "ratings_insert_participant"     on public.ratings;
drop policy if exists "assistant_own_read"             on public.assistant_messages;
drop policy if exists "assistant_own_insert"           on public.assistant_messages;
drop policy if exists "assistant_own_delete"           on public.assistant_messages;
drop policy if exists "searches_own_read"              on public.recent_searches;
drop policy if exists "searches_own_insert"            on public.recent_searches;
drop policy if exists "searches_own_delete"            on public.recent_searches;
drop policy if exists "face_own_read"                  on public.face_verifications;
drop policy if exists "face_own_insert"                on public.face_verifications;

-- profiles
create policy "profiles_read_same_institution" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or institution_id = (select private.current_institution_id()));
create policy "profiles_update_own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- vehicles
create policy "vehicles_read" on public.vehicles for select to authenticated
  using (driver_id = (select auth.uid())
         or exists (select 1 from public.profiles p where p.id = vehicles.driver_id
                    and p.institution_id = (select private.current_institution_id())));
create policy "vehicles_insert_own" on public.vehicles for insert to authenticated
  with check (driver_id = (select auth.uid()));
create policy "vehicles_update_own" on public.vehicles for update to authenticated
  using (driver_id = (select auth.uid())) with check (driver_id = (select auth.uid()));
create policy "vehicles_delete_own" on public.vehicles for delete to authenticated
  using (driver_id = (select auth.uid()));

-- trips
create policy "trips_read" on public.trips for select to authenticated
  using (driver_id = (select auth.uid())
         or institution_id = (select private.current_institution_id())
         or private.is_trip_passenger(id));
create policy "trips_insert_driver" on public.trips for insert to authenticated
  with check (
    driver_id = (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid())
                and p.rol = 'conductor' and p.verification_status = 'verificado'));
create policy "trips_update_own_pending" on public.trips for update to authenticated
  using (driver_id = (select auth.uid()) and estado = 'por_empezar')
  with check (driver_id = (select auth.uid()) and estado = 'por_empezar');
create policy "trips_delete_own_pending" on public.trips for delete to authenticated
  using (driver_id = (select auth.uid()) and estado = 'por_empezar' and private.seats_taken(id) = 0);

-- trip_requests
create policy "requests_read" on public.trip_requests for select to authenticated
  using (passenger_id = (select auth.uid()) or private.is_trip_driver(trip_id));
create policy "requests_insert_passenger" on public.trip_requests for insert to authenticated
  with check (
    passenger_id = (select auth.uid())
    and estado = 'pendiente'
    and exists (select 1 from public.profiles p where p.id = (select auth.uid())
                and p.verification_status = 'verificado')
    and exists (select 1 from public.trips t where t.id = trip_id
                and t.estado = 'por_empezar'
                and t.driver_id <> (select auth.uid())
                and t.institution_id = (select private.current_institution_id())));

-- trip_locations
create policy "locations_read" on public.trip_locations for select to authenticated
  using (private.is_trip_driver(trip_id) or private.is_trip_passenger(trip_id));
create policy "locations_write_driver" on public.trip_locations for insert to authenticated
  with check (private.is_trip_driver(trip_id));
create policy "locations_update_driver" on public.trip_locations for update to authenticated
  using (private.is_trip_driver(trip_id)) with check (private.is_trip_driver(trip_id));
create policy "locations_delete_driver" on public.trip_locations for delete to authenticated
  using (private.is_trip_driver(trip_id));

-- ratings: dentro de la institución; ambos deben haber participado
create policy "ratings_read" on public.ratings for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = ratings.rated_id
                 and p.institution_id = (select private.current_institution_id())));
create policy "ratings_insert_participant" on public.ratings for insert to authenticated
  with check (
    rater_id = (select auth.uid())
    and exists (select 1 from public.trips t where t.id = trip_id and t.estado = 'finalizado')
    and private.is_trip_participant(trip_id, (select auth.uid()))
    and private.is_trip_participant(trip_id, rated_id));

-- assistant_messages: el usuario solo escribe como 'usuario'
create policy "assistant_own_read" on public.assistant_messages for select to authenticated
  using (user_id = (select auth.uid()));
create policy "assistant_own_insert" on public.assistant_messages for insert to authenticated
  with check (user_id = (select auth.uid()) and autor = 'usuario');
create policy "assistant_own_delete" on public.assistant_messages for delete to authenticated
  using (user_id = (select auth.uid()));

-- recent_searches
create policy "searches_own_read" on public.recent_searches for select to authenticated
  using (user_id = (select auth.uid()));
create policy "searches_own_insert" on public.recent_searches for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "searches_own_delete" on public.recent_searches for delete to authenticated
  using (user_id = (select auth.uid()));

-- face_verifications
create policy "face_own_read" on public.face_verifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "face_own_insert" on public.face_verifications for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'procesando');

-- ---------------------------------------------------------------------
-- 8. Storage: sin listado global de buckets públicos
--    (las URLs públicas siguen funcionando sin política SELECT)
-- ---------------------------------------------------------------------
drop policy if exists "public_images_read" on storage.objects;
drop policy if exists "own_images_insert"  on storage.objects;
drop policy if exists "own_images_update"  on storage.objects;
drop policy if exists "own_images_delete"  on storage.objects;
drop policy if exists "face_own_insert"    on storage.objects;
drop policy if exists "face_own_read"      on storage.objects;

create policy "own_files_read" on storage.objects for select to authenticated
  using (bucket_id in ('avatars', 'vehicle-photos', 'face-verifications')
         and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own_files_insert" on storage.objects for insert to authenticated
  with check (bucket_id in ('avatars', 'vehicle-photos', 'face-verifications')
              and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own_images_update" on storage.objects for update to authenticated
  using (bucket_id in ('avatars', 'vehicle-photos')
         and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own_images_delete" on storage.objects for delete to authenticated
  using (bucket_id in ('avatars', 'vehicle-photos')
         and (storage.foldername(name))[1] = (select auth.uid())::text);
