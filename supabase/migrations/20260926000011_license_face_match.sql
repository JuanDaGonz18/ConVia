-- =====================================================================
-- ConVía — identidad del conductor por foto de la licencia
--  * El conductor toma o sube una foto de su licencia. El teléfono extrae el
--    rostro del documento y calcula su embedding SFace (el mismo modelo de la
--    verificación facial). Solo ese embedding llega aquí; la foto se borra.
--  * face_templates guarda ahora dos plantillas por usuario:
--      'selfie'  → la del registro (pasajero)
--      'license' → la extraída de la licencia (conductor)
--  * El permiso de conductor se aprueba cuando una selfie en vivo coincide
--    con la foto de la licencia. Esto NO valida que la licencia sea auténtica
--    ni que esté registrada oficialmente (no hay RUNT ni fuente externa).
--  * Reemplaza la captura manual de número/categoría/vencimiento y la
--    verificación simulada de 10 segundos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Plantillas por tipo y propósito de cada verificación
-- ---------------------------------------------------------------------
alter table public.face_templates
  add column kind text not null default 'selfie' check (kind in ('selfie', 'license'));
alter table public.face_templates drop constraint face_templates_pkey;
alter table public.face_templates add primary key (user_id, kind);

alter table public.face_verifications
  add column purpose text,
  add column template_kind text check (template_kind is null or template_kind in ('selfie', 'license'));

-- Una selfie casi idéntica a la foto de la licencia suele ser una foto de la
-- propia licencia puesta frente a la cámara. Calibrado con SFace: fotos reales
-- distintas de la misma persona llegan a ~0.84; refotografiar la licencia da ≥ 0.88.
create or replace function private.face_recapture_threshold()
returns real language sql immutable set search_path = '' as $$ select 0.87::real $$;

create or replace function private.check_face_embedding(p_embedding real[])
returns void language plpgsql immutable set search_path = '' as $$
declare v_norm double precision;
begin
  if p_embedding is null or array_length(p_embedding, 1) <> 128 or array_position(p_embedding, null) is not null then
    raise exception 'Representación facial inválida';
  end if;
  select sqrt(sum(v * v)) into v_norm from unnest(p_embedding) as v;
  if v_norm is null or v_norm < 0.95 or v_norm > 1.05 then
    raise exception 'Representación facial inválida';
  end if;
end $$;

create or replace function private.check_face_rate_limit(p_user uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if (select count(*) from public.face_verifications
      where user_id = p_user and created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
  end if;
end $$;

-- Una verificación en vivo reciente contra la plantilla indicada. Subir la
-- foto de la licencia nunca cuenta como verificación.
drop function if exists private.has_recent_face_check(uuid);
create or replace function private.has_recent_face_check(p_user uuid, p_kind text default 'selfie')
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.face_verifications
    where user_id = p_user
      and status = 'verificado'
      and provider = 'on_device_sface'
      and purpose in ('register', 'trip_request', 'driver_activate', 'driver_identity')
      and coalesce(template_kind, 'selfie') = p_kind
      and created_at > now() - interval '10 minutes'
  )
$$;

-- ---------------------------------------------------------------------
-- 2. Licencia: fuera los datos manuales y la simulación
-- ---------------------------------------------------------------------
drop function if exists public.upsert_driver_profile(text, text, date);
drop function if exists public.complete_simulated_license_check();
drop function if exists private.license_simulation_enabled();

alter table public.driver_profiles
  drop column if exists license_number,
  drop column if exists license_category,
  drop column if exists license_expires_on,
  add column identity_verified_at timestamptz;

comment on column public.driver_profiles.submitted_at is 'Cuándo se registró la foto de la licencia (solo se guarda su embedding).';
comment on column public.driver_profiles.identity_verified_at is 'Cuándo una selfie en vivo coincidió con la foto de la licencia.';

-- Conductores aprobados sin plantilla de licencia deben subirla.
update public.driver_profiles d
   set status = 'pendiente',
       review_notes = 'Sube una foto de tu licencia para verificar tu identidad como conductor.',
       reviewed_at = null
 where d.status = 'aprobado'
   and not exists (select 1 from public.face_templates f where f.user_id = d.user_id and f.kind = 'license');

-- ---------------------------------------------------------------------
-- 3. RPC: guardar el rostro de la licencia
-- ---------------------------------------------------------------------
create or replace function public.submit_license_face(p_embedding real[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  d public.driver_profiles;
begin
  if v_user is null then raise exception 'No autenticado'; end if;
  perform private.check_face_embedding(p_embedding);
  perform private.check_face_rate_limit(v_user);

  select * into d from public.driver_profiles where user_id = v_user for update;
  if found and d.status = 'suspendido' then
    raise exception 'Tu permiso de conductor está suspendido';
  end if;

  insert into public.face_templates (user_id, kind, embedding, created_at)
  values (v_user, 'license', p_embedding, now())
  on conflict (user_id, kind) do update set embedding = excluded.embedding, created_at = now();

  -- Una licencia nueva exige volver a comprobar la identidad.
  insert into public.driver_profiles as dp (user_id, status, submitted_at)
  values (v_user, 'pendiente', now())
  on conflict (user_id) do update set
    status = 'pendiente',
    submitted_at = now(),
    identity_verified_at = null,
    reviewed_at = null,
    review_notes = null;

  -- Cuenta para el límite de intentos, pero no como verificación de identidad.
  insert into public.face_verifications (user_id, status, provider, purpose, template_kind)
  values (v_user, 'procesando', 'on_device_sface', 'license_upload', 'license');

  return jsonb_build_object('status', 'pendiente');
end $$;

revoke execute on function public.submit_license_face(real[]) from public, anon;
grant execute on function public.submit_license_face(real[]) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Verificar una selfie contra la plantilla que corresponda
-- ---------------------------------------------------------------------
create or replace function public.submit_face_embedding(p_embedding real[], p_purpose text default 'register')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_kind text;
  v_template real[];
  v_similarity double precision;
  v_verified boolean;
  v_enrolled boolean := false;
  v_reason text;
begin
  if v_user is null then raise exception 'No autenticado'; end if;
  if p_purpose not in ('register', 'trip_request', 'driver_activate', 'driver_identity') then
    raise exception 'Propósito de verificación inválido';
  end if;
  perform private.check_face_embedding(p_embedding);
  perform private.check_face_rate_limit(v_user);

  -- Pasajero → selfie del registro. Conductor → rostro de la licencia.
  v_kind := case when p_purpose in ('driver_activate', 'driver_identity') then 'license' else 'selfie' end;
  select embedding into v_template from public.face_templates
   where user_id = v_user and kind = v_kind for update;

  if v_template is null then
    if v_kind = 'license' then
      raise exception 'Primero sube una foto de tu licencia de conducción';
    end if;
    -- Primera selfie: se convierte en la referencia del usuario.
    insert into public.face_templates (user_id, kind, embedding) values (v_user, 'selfie', p_embedding);
    v_enrolled := true;
    v_verified := true;
  else
    select sum(a.v * b.v) / (sqrt(sum(a.v * a.v)) * sqrt(sum(b.v * b.v)))
      into v_similarity
      from unnest(p_embedding) with ordinality as a(v, i)
      join unnest(v_template) with ordinality as b(v, i) using (i);
    v_verified := v_similarity >= private.face_match_threshold();
    if not v_verified then
      v_reason := 'FACE_MISMATCH';
    elsif v_kind = 'license' and v_similarity >= private.face_recapture_threshold() then
      v_verified := false;
      v_reason := 'LICENSE_PHOTO_RECAPTURE';
    end if;
  end if;

  insert into public.face_verifications (user_id, status, provider, score, error, purpose, template_kind)
  values (
    v_user,
    case when v_verified then 'verificado'::public.verification_status else 'fallido'::public.verification_status end,
    'on_device_sface',
    case when v_similarity is null then null else round(v_similarity::numeric, 4) end,
    v_reason,
    p_purpose,
    v_kind
  );

  if v_verified and v_kind = 'selfie' then
    -- Un intento fallido antes de un viaje no revoca la identidad ya verificada.
    update public.profiles set verification_status = 'verificado', verified_at = now() where id = v_user;
  end if;

  if v_verified and p_purpose = 'driver_identity' then
    update public.driver_profiles
       set status = 'aprobado',
           identity_verified_at = now(),
           reviewed_at = now(),
           review_notes = 'Tu rostro coincide con la foto de tu licencia. Esto no valida la autenticidad del documento.'
     where user_id = v_user and status = 'pendiente';
  end if;

  return jsonb_build_object(
    'result', case when v_verified then 'verified' else 'not_verified' end,
    'enrolled', v_enrolled,
    'reason', v_reason,
    'similarity', v_similarity,
    'threshold', private.face_match_threshold()
  );
end $$;

revoke execute on function public.submit_face_embedding(real[], text) from public, anon;
grant execute on function public.submit_face_embedding(real[], text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Pedir cupo: selfie del pasajero. Aceptar pasajero: rostro de la licencia.
-- ---------------------------------------------------------------------
create or replace function public.trip_requests_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_salida timestamptz;
begin
  if not private.has_recent_face_check(new.passenger_id, 'selfie') then
    raise exception 'Verifica tu rostro antes de pedir un cupo';
  end if;
  select salida_at into v_salida from public.trips where id = new.trip_id;
  if v_salida is not null and private.has_schedule_conflict(new.passenger_id, v_salida, new.trip_id) then
    raise exception 'Ya tienes otro viaje a menos de 90 minutos de esa hora';
  end if;
  return new;
end $$;

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
  if p_accept and not private.has_recent_face_check(auth.uid(), 'license') then
    raise exception 'Verifica tu identidad de conductor antes de aceptar pasajeros';
  end if;
  if p_accept and private.seats_taken(t.id) >= t.cupos_totales then
    raise exception 'No hay cupos disponibles';
  end if;
  if p_accept and private.has_schedule_conflict(r.passenger_id, t.salida_at, t.id) then
    raise exception 'El pasajero ya tiene otro viaje a menos de 90 minutos de esa hora';
  end if;

  update public.trip_requests
     set estado = case when p_accept then 'aceptado'::public.request_status else 'negado'::public.request_status end,
         responded_at = now()
   where id = p_request_id
  returning * into r;
  return r;
end $$;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
