-- ConVía — Endurecimiento de seguridad (auditoría del 2026-11-04).
--
-- Portado del repositorio del hackathon: la parte de su 040 que no depende de
-- instituciones (032) ni de pickup (030), más su 042 y la tabla notified_events
-- de su 041.
--
-- Antes de esta migración, los privilegios por defecto de Supabase dejaban a
-- `authenticated` editar cualquier columna de su perfil (verification_status,
-- institution_id, rol, ratings), insertar viajes y solicitudes con cualquier
-- columna (estado, institution_id…) e insertar filas en face_verifications.
-- Se revisó que el app solo escribe las columnas que quedan permitidas.

-- 1. profiles: cada usuario edita solo sus columnas inofensivas.
revoke insert, update, delete, truncate, references, trigger on public.profiles from anon, authenticated;
revoke select on public.profiles from anon;
grant update (nombre, avatar_url, telefono, terms_accepted_at, onboarding_completed,
              expo_push_token, notifications_enabled)
  on public.profiles to authenticated;
-- El app filtra por terms_accepted_at al aceptar los términos (ingreso con Microsoft).
grant select (terms_accepted_at) on public.profiles to authenticated;

-- 2. trips / trip_requests: se insertan solo las columnas que manda el app.
--    Los cambios de estado van por funciones SECURITY DEFINER.
revoke insert, update, truncate, references, trigger on public.trips from anon, authenticated;
grant insert (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre,
              destino_lat, destino_lng, salida_at, precio, cupos_totales, descripcion, ruta)
  on public.trips to authenticated;

revoke insert, update, delete, truncate, references, trigger on public.trip_requests from anon, authenticated;
grant insert (trip_id, passenger_id, direccion, lat, lng, hora_aprox,
              destino_nombre, destino_lat, destino_lng)
  on public.trip_requests to authenticated;

-- 3. face_verifications: solo la escriben las funciones submit_* (SECURITY DEFINER).
drop policy if exists face_verifications_insert_own on public.face_verifications;
do $$ declare p record; begin
  for p in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'face_verifications' and cmd = 'INSERT' loop
    execute format('drop policy %I on public.face_verifications', p.policyname);
  end loop;
end $$;
revoke insert, update, delete, truncate, references, trigger on public.face_verifications from anon, authenticated;

-- 4. anon no lee ninguna tabla directamente (todas las políticas son para authenticated).
revoke all on all tables in schema public from anon;

-- 5. Límite de intentos faciales serializado por usuario: llamadas simultáneas no lo superan.
create or replace function private.check_face_rate_limit(p_user uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('face_rate:' || p_user::text, 0));
  if (select count(*) from public.face_verifications
      where user_id = p_user and created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
  end if;
end $$;

-- 6. Funciones de private: EXECUTE solo donde lo necesitan las políticas RLS, los
--    CHECK y la vista security_invoker available_trips. Todo lo demás se llama desde
--    funciones SECURITY DEFINER, que corren como el dueño.
--    REGLA para migraciones futuras: no volver a usar
--    `grant execute on all functions in schema private to authenticated`; otorgar
--    solo la función nueva, y solo si una política, un CHECK o una vista la llama.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.current_institution_id(),
  private.is_approved_driver(uuid),
  private.is_trip_active(uuid),
  private.is_trip_driver(uuid),
  private.is_trip_passenger(uuid),
  private.trip_accepts_requests(uuid),
  private.available_trip_rows(),
  private.is_valid_route(jsonb),
  private.km(double precision, double precision, double precision, double precision)
  to authenticated;
grant execute on all functions in schema private to service_role;

-- 7. Los usuarios nuevos siempre empiezan como 'usuario': el app no manda otro rol y
--    el modo conductor se activa con switch_role, que exige la licencia aprobada.
do $$ declare d text; begin
  d := pg_get_functiondef('public.handle_new_user()'::regprocedure);
  if position($r$coalesce((new.raw_user_meta_data->>'rol')::public.user_role, 'usuario')$r$ in d) = 0 then
    raise exception 'handle_new_user cambió: revisar el reemplazo del rol';
  end if;
  d := replace(d, $r$coalesce((new.raw_user_meta_data->>'rol')::public.user_role, 'usuario')$r$, $r$'usuario'::public.user_role$r$);
  execute d;
end $$;

-- 8. Storage: face-verifications solo lo escriben las Edge Functions (service role),
--    y hay un tope de archivos por usuario para que nadie suba sin límite.
create or replace function private.my_object_count(p_bucket text)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from storage.objects
   where bucket_id = p_bucket and name like (select auth.uid())::text || '/%'
$$;
revoke execute on function private.my_object_count(text) from public, anon;
grant execute on function private.my_object_count(text) to authenticated, service_role;

drop policy if exists own_files_insert on storage.objects;
create policy own_files_insert on storage.objects for insert to authenticated
with check (
  bucket_id = any (array['avatars', 'vehicle-photos'])
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and private.my_object_count(bucket_id) < case when bucket_id = 'avatars' then 5 else 20 end
);

-- 9. notify: cada (evento, id) se envía una sola vez; repetir la petición no manda nada.
--    Solo la escribe la Edge Function con el service role: RLS sin políticas.
create table public.notified_events (
  event text not null,
  ref_id text not null check (char_length(ref_id) <= 200),
  created_at timestamptz not null default now(),
  primary key (event, ref_id)
);
alter table public.notified_events enable row level security;
revoke all on public.notified_events from public, anon, authenticated;
grant select, insert, delete on public.notified_events to service_role;

-- Las repeticiones llegan en minutos: las filas viejas no se vuelven a leer.
select cron.schedule('cleanup-notified-events', '29 3 * * *', $$
  delete from public.notified_events where created_at < now() - interval '30 days';
$$);
