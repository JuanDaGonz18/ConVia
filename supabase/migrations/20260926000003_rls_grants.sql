-- =====================================================================
-- ConVía — permisos (Data API) y Row Level Security
-- "Automatically expose new tables" está desactivado: todo se concede aquí.
-- =====================================================================

-- ---------------------------------------------------------------------
-- RLS en todas las tablas
-- ---------------------------------------------------------------------
alter table public.institutions       enable row level security;
alter table public.profiles           enable row level security;
alter table public.vehicles           enable row level security;
alter table public.trips              enable row level security;
alter table public.trip_requests      enable row level security;
alter table public.trip_locations     enable row level security;
alter table public.ratings            enable row level security;
alter table public.assistant_messages enable row level security;
alter table public.recent_searches    enable row level security;
alter table public.face_verifications enable row level security;

-- ---------------------------------------------------------------------
-- GRANTS a nivel de tabla (RLS filtra las filas)
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant usage on all sequences in schema public to authenticated, service_role;

grant select on public.institutions to anon, authenticated;

grant select on public.profiles to authenticated;
grant update (nombre, avatar_url, telefono, terms_accepted_at, onboarding_completed)
  on public.profiles to authenticated;

grant select, insert, update, delete on public.vehicles           to authenticated;
grant select, insert, update, delete on public.trips              to authenticated;
grant select, insert                 on public.trip_requests      to authenticated;
grant select, insert, update, delete on public.trip_locations     to authenticated;
grant select, insert                 on public.ratings            to authenticated;
grant select, insert, delete         on public.assistant_messages to authenticated;
grant select, insert, delete         on public.recent_searches    to authenticated;
grant select, insert                 on public.face_verifications to authenticated;
grant select                         on public.available_trips    to authenticated;

grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------------------
-- POLÍTICAS
-- ---------------------------------------------------------------------

-- institutions: lectura pública (pantalla de dominio antes de registrarse)
create policy "institutions_read" on public.institutions
  for select to anon, authenticated using (activo);

-- profiles: el propio + los de la misma institución
create policy "profiles_read_same_institution" on public.profiles
  for select to authenticated
  using (id = auth.uid() or institution_id = public.current_institution_id());
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- vehicles: los ve la comunidad; solo el dueño los gestiona
create policy "vehicles_read" on public.vehicles
  for select to authenticated
  using (driver_id = auth.uid()
         or exists (select 1 from public.profiles p where p.id = vehicles.driver_id
                    and p.institution_id = public.current_institution_id()));
create policy "vehicles_insert_own" on public.vehicles
  for insert to authenticated with check (driver_id = auth.uid());
create policy "vehicles_update_own" on public.vehicles
  for update to authenticated using (driver_id = auth.uid()) with check (driver_id = auth.uid());
create policy "vehicles_delete_own" on public.vehicles
  for delete to authenticated using (driver_id = auth.uid());

-- trips: visibles dentro de la institución; los crea un conductor verificado
create policy "trips_read" on public.trips
  for select to authenticated
  using (driver_id = auth.uid()
         or institution_id = public.current_institution_id()
         or public.is_trip_passenger(id));
create policy "trips_insert_driver" on public.trips
  for insert to authenticated
  with check (
    driver_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid()
                and p.rol = 'conductor' and p.verification_status = 'verificado')
  );
create policy "trips_update_own_pending" on public.trips
  for update to authenticated
  using (driver_id = auth.uid() and estado = 'por_empezar')
  with check (driver_id = auth.uid() and estado = 'por_empezar');
create policy "trips_delete_own_pending" on public.trips
  for delete to authenticated
  using (driver_id = auth.uid() and estado = 'por_empezar'
         and public.seats_taken(id) = 0);

-- trip_requests: las ve el pasajero y el conductor del viaje.
-- Los cambios de estado van por RPC (respond / cancel / board).
create policy "requests_read" on public.trip_requests
  for select to authenticated
  using (passenger_id = auth.uid() or public.is_trip_driver(trip_id));
create policy "requests_insert_passenger" on public.trip_requests
  for insert to authenticated
  with check (
    passenger_id = auth.uid()
    and estado = 'pendiente'
    and exists (select 1 from public.profiles p where p.id = auth.uid()
                and p.verification_status = 'verificado')
    and exists (select 1 from public.trips t where t.id = trip_id
                and t.estado = 'por_empezar'
                and t.driver_id <> auth.uid()
                and t.institution_id = public.current_institution_id())
  );

-- trip_locations: escribe el conductor, leen conductor y pasajeros
create policy "locations_read" on public.trip_locations
  for select to authenticated
  using (public.is_trip_driver(trip_id) or public.is_trip_passenger(trip_id));
create policy "locations_write_driver" on public.trip_locations
  for insert to authenticated with check (public.is_trip_driver(trip_id));
create policy "locations_update_driver" on public.trip_locations
  for update to authenticated using (public.is_trip_driver(trip_id)) with check (public.is_trip_driver(trip_id));
create policy "locations_delete_driver" on public.trip_locations
  for delete to authenticated using (public.is_trip_driver(trip_id));

-- ratings: lectura en la comunidad; solo participantes de un viaje finalizado
create policy "ratings_read" on public.ratings
  for select to authenticated using (true);
create policy "ratings_insert_participant" on public.ratings
  for insert to authenticated
  with check (
    rater_id = auth.uid()
    and exists (select 1 from public.trips t where t.id = trip_id and t.estado = 'finalizado')
    and (public.is_trip_driver(trip_id) or public.is_trip_passenger(trip_id))
  );

-- assistant_messages / recent_searches: solo el dueño
create policy "assistant_own_read"   on public.assistant_messages for select to authenticated using (user_id = auth.uid());
create policy "assistant_own_insert" on public.assistant_messages for insert to authenticated with check (user_id = auth.uid());
create policy "assistant_own_delete" on public.assistant_messages for delete to authenticated using (user_id = auth.uid());

create policy "searches_own_read"   on public.recent_searches for select to authenticated using (user_id = auth.uid());
create policy "searches_own_insert" on public.recent_searches for insert to authenticated with check (user_id = auth.uid());
create policy "searches_own_delete" on public.recent_searches for delete to authenticated using (user_id = auth.uid());

-- face_verifications: el usuario crea el intento; el resultado lo pone el backend
create policy "face_own_read"   on public.face_verifications for select to authenticated using (user_id = auth.uid());
create policy "face_own_insert" on public.face_verifications for insert to authenticated
  with check (user_id = auth.uid() and status = 'procesando');

-- ---------------------------------------------------------------------
-- EXECUTE de funciones
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.check_email_domain(text)                 to anon, authenticated;
grant execute on function public.current_institution_id()                 to authenticated;
grant execute on function public.is_trip_driver(uuid)                     to authenticated;
grant execute on function public.is_trip_passenger(uuid)                  to authenticated;
grant execute on function public.seats_taken(uuid)                        to authenticated;
grant execute on function public.respond_trip_request(uuid, boolean)      to authenticated;
grant execute on function public.cancel_trip_request(uuid)                to authenticated;
grant execute on function public.board_passenger(uuid)                    to authenticated;
grant execute on function public.start_trip(uuid)                         to authenticated;
grant execute on function public.finish_trip(uuid)                        to authenticated;
grant execute on function public.cancel_trip(uuid)                        to authenticated;
grant execute on function public.switch_role(public.user_role)            to authenticated;
-- set_verification_result: solo service_role (Edge Function)
grant execute on all functions in schema public to service_role;

-- ---------------------------------------------------------------------
-- REALTIME: cambios de estado y ubicación en vivo
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.trips;
alter publication supabase_realtime add table public.trip_requests;
alter publication supabase_realtime add table public.trip_locations;
