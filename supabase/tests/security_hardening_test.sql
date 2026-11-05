-- =====================================================================
-- ConVía — pruebas del endurecimiento de seguridad (migración 030)
--
-- Uso local: docker exec -i supabase_db_convia psql -U postgres -d postgres < supabase/tests/security_hardening_test.sql
-- Todo corre en un bloque que termina con RAISE EXCEPTION, así que NADA queda
-- guardado: el mensaje de error es el reporte. Cada línea dice OK o BAD.
-- =====================================================================
do $$
declare
  u uuid := gen_random_uuid();
  v uuid; t uuid; rq uuid;
  r text := ''; n integer;
  bad integer := 0;
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role) values
    (u, 'zz.hardening@unisabana.edu.co', '{"nombre":"ZZ Hardening","rol":"conductor"}', 'authenticated', 'authenticated');
  insert into public.driver_profiles (user_id, status) values (u, 'aprobado')
    on conflict (user_id) do update set status = 'aprobado';
  update public.profiles set rol = 'conductor', verification_status = 'verificado', telefono = '3000000000' where id = u;
  insert into public.face_verifications (user_id, status, provider, purpose, template_kind)
    values (u, 'verificado', 'on_device_sface', 'driver_identity', 'license');
  insert into public.vehicles (driver_id, placa, marca, color, puestos) values (u, 'ZZH301', 'Prueba', 'Gris', 4) returning id into v;

  -- ---------------- como el usuario autenticado ----------------
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- Lo que hace el app sigue funcionando.
  begin
    update public.profiles set nombre = 'ZZ Nuevo', telefono = '3111111111', avatar_url = 'x', expo_push_token = null,
                               notifications_enabled = true, onboarding_completed = true where id = u;
    update public.profiles set terms_accepted_at = now() where id = u and terms_accepted_at is null;
    r := r || E'\nOK  app profile updates (incl. terms_accepted_at filter)';
  exception when others then r := r || E'\nBAD app profile update: ' || sqlerrm; end;

  begin
    insert into public.trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng,
                              salida_at, precio, cupos_totales, descripcion, ruta)
      values (u, v, 'Origen', 4.8615, -74.033, 'Destino', 4.765, -74.13, now() + interval '1 day', 5000, 3, null, null)
      returning id into t;
    r := r || E'\nOK  app trip insert (with returning)';
  exception when others then r := r || E'\nBAD app trip insert: ' || sqlerrm; end;

  -- Lo que el usuario no debe poder hacer.
  begin update public.profiles set verification_status = 'verificado' where id = u;
    r := r || E'\nBAD profiles.verification_status is writable';
  exception when insufficient_privilege then r := r || E'\nOK  profiles.verification_status not writable'; end;
  begin update public.profiles set rol = 'usuario' where id = u;
    r := r || E'\nBAD profiles.rol is writable';
  exception when insufficient_privilege then r := r || E'\nOK  profiles.rol not writable'; end;
  begin update public.profiles set rating_avg = 5 where id = u;
    r := r || E'\nBAD profiles.rating_avg is writable';
  exception when insufficient_privilege then r := r || E'\nOK  profiles.rating_avg not writable'; end;
  begin update public.profiles set institution_id = null where id = u;
    r := r || E'\nBAD profiles.institution_id is writable';
  exception when insufficient_privilege then r := r || E'\nOK  profiles.institution_id not writable'; end;

  begin
    insert into public.trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng,
                              salida_at, precio, cupos_totales, estado)
      values (u, v, 'O', 4.86, -74.03, 'D', 4.76, -74.13, now() + interval '2 day', 5000, 3, 'finalizado');
    r := r || E'\nBAD trips.estado insertable';
  exception when insufficient_privilege then r := r || E'\nOK  trips.estado not insertable'; end;
  begin update public.trips set precio = 1 where id = t;
    r := r || E'\nBAD trips directly updatable';
  exception when insufficient_privilege then r := r || E'\nOK  trips not directly updatable'; end;

  begin
    insert into public.trip_requests (trip_id, passenger_id, direccion, estado) values (t, u, 'x', 'aceptado');
    r := r || E'\nBAD trip_requests.estado insertable';
  exception when insufficient_privilege then r := r || E'\nOK  trip_requests.estado not insertable'; end;
  begin delete from public.trip_requests where passenger_id = u;
    r := r || E'\nBAD trip_requests deletable';
  exception when insufficient_privilege then r := r || E'\nOK  trip_requests not deletable'; end;

  begin
    insert into public.face_verifications (user_id, status, provider, purpose, template_kind)
      values (u, 'verificado', 'on_device_sface', 'trip_request', 'selfie');
    r := r || E'\nBAD face_verifications directly insertable';
  exception when insufficient_privilege then r := r || E'\nOK  face_verifications not directly insertable'; end;

  begin perform private.is_plus(u);
    r := r || E'\nBAD private.is_plus executable';
  exception when insufficient_privilege then r := r || E'\nOK  private.* outside the whitelist not executable'; end;
  begin perform private.is_trip_driver(t);
    r := r || E'\nOK  whitelisted private.is_trip_driver executable';
  exception when others then r := r || E'\nBAD whitelisted private function: ' || sqlerrm; end;
  begin select count(*) into n from public.available_trips;
    r := r || E'\nOK  available_trips view readable';
  exception when others then r := r || E'\nBAD available_trips: ' || sqlerrm; end;

  begin select count(*) into n from public.notified_events;
    r := r || E'\nBAD notified_events readable';
  exception when insufficient_privilege then r := r || E'\nOK  notified_events not readable'; end;

  -- Storage: tope de archivos por usuario y sin subida directa a face-verifications.
  begin
    for i in 1..5 loop
      insert into storage.objects (bucket_id, name, owner_id) values ('avatars', u::text || '/a' || i || '.jpg', u::text);
    end loop;
    r := r || E'\nOK  5 avatars allowed';
  exception when others then r := r || E'\nBAD avatars under cap: ' || sqlerrm; end;
  begin
    insert into storage.objects (bucket_id, name, owner_id) values ('avatars', u::text || '/a6.jpg', u::text);
    r := r || E'\nBAD 6th avatar allowed';
  exception when insufficient_privilege then r := r || E'\nOK  6th avatar refused'; end;
  begin
    insert into storage.objects (bucket_id, name, owner_id) values ('face-verifications', u::text || '/f.jpg', u::text);
    r := r || E'\nBAD face-verifications uploadable';
  exception when insufficient_privilege then r := r || E'\nOK  face-verifications not uploadable'; end;
  execute 'reset role';

  -- ---------------- como anon ----------------
  execute 'set local role anon';
  begin select count(*) into n from public.institutions;
    r := r || E'\nBAD anon reads institutions';
  exception when insufficient_privilege then r := r || E'\nOK  anon reads no tables'; end;
  begin select count(*) into n from public.profiles;
    r := r || E'\nBAD anon reads profiles';
  exception when insufficient_privilege then r := r || E'\nOK  anon reads no profiles'; end;
  execute 'reset role';

  bad := (length(r) - length(replace(r, E'\nBAD', ''))) / 4;
  raise exception 'SECURITY HARDENING (rolled back) — % failing:%', bad, r;
end $$;
