-- =====================================================================
-- WheelsApp — verificación facial gratuita en el dispositivo
--  * El teléfono detecta el rostro (ML Kit) y calcula un embedding de 128
--    valores con SFace (ONNX). No se suben fotos.
--  * face_templates guarda solo el embedding de registro. Nadie lo puede leer
--    por la API; la comparación ocurre aquí, en submit_face_embedding().
--  * Pedir cupo o aceptar un pasajero exige una verificación exitosa en los
--    últimos 10 minutos.
-- =====================================================================

create table public.face_templates (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  embedding   real[] not null check (array_length(embedding, 1) = 128),
  model       text not null default 'sface_2021dec_int8',
  created_at  timestamptz not null default now()
);

alter table public.face_templates enable row level security;
revoke all on public.face_templates from anon, authenticated;
grant all on public.face_templates to service_role;
-- Sin políticas: solo las funciones security definer y service_role la tocan.

create index if not exists face_verifications_recent_idx
  on public.face_verifications(user_id, status, created_at desc);

-- Umbral de similitud coseno validado con SFace (OpenCV recomienda 0.363).
create or replace function private.face_match_threshold()
returns real language sql immutable set search_path = '' as $$ select 0.40::real $$;

create or replace function private.has_recent_face_check(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.face_verifications
    where user_id = p_user
      and status = 'verificado'
      and provider = 'on_device_sface'
      and created_at > now() - interval '10 minutes'
  )
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Registrar (primera vez) o verificar un embedding facial
-- ---------------------------------------------------------------------
create or replace function public.submit_face_embedding(p_embedding real[], p_purpose text default 'register')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_template real[];
  v_norm double precision;
  v_similarity double precision;
  v_verified boolean;
  v_enrolled boolean := false;
begin
  if v_user is null then raise exception 'No autenticado'; end if;
  if p_purpose not in ('register', 'trip_request', 'driver_activate') then
    raise exception 'Propósito de verificación inválido';
  end if;
  if p_embedding is null or array_length(p_embedding, 1) <> 128 or array_position(p_embedding, null) is not null then
    raise exception 'Representación facial inválida';
  end if;
  select sqrt(sum(v * v)) into v_norm from unnest(p_embedding) as v;
  if v_norm is null or v_norm < 0.95 or v_norm > 1.05 then
    raise exception 'Representación facial inválida';
  end if;

  if (select count(*) from public.face_verifications
      where user_id = v_user and created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
  end if;

  select embedding into v_template from public.face_templates where user_id = v_user for update;

  if v_template is null then
    -- Primera captura: se convierte en la referencia del usuario.
    insert into public.face_templates (user_id, embedding) values (v_user, p_embedding);
    v_enrolled := true;
    v_verified := true;
  else
    select sum(a.v * b.v) / (sqrt(sum(a.v * a.v)) * sqrt(sum(b.v * b.v)))
      into v_similarity
      from unnest(p_embedding) with ordinality as a(v, i)
      join unnest(v_template) with ordinality as b(v, i) using (i);
    v_verified := v_similarity >= private.face_match_threshold();
  end if;

  insert into public.face_verifications (user_id, status, provider, score, error)
  values (
    v_user,
    case when v_verified then 'verificado'::public.verification_status else 'fallido'::public.verification_status end,
    'on_device_sface',
    case when v_similarity is null then null else round(v_similarity::numeric, 4) end,
    case when v_verified then null else 'FACE_MISMATCH' end
  );

  -- Un intento fallido antes de un viaje no revoca la identidad ya verificada.
  if v_verified then
    update public.profiles set verification_status = 'verificado', verified_at = now() where id = v_user;
  end if;

  return jsonb_build_object(
    'result', case when v_verified then 'verified' else 'not_verified' end,
    'enrolled', v_enrolled,
    'similarity', v_similarity,
    'threshold', private.face_match_threshold()
  );
end $$;

revoke execute on function public.submit_face_embedding(real[], text) from public, anon;
grant execute on function public.submit_face_embedding(real[], text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Verificación reciente para pedir cupo (pasajero) y aceptar (conductor)
-- ---------------------------------------------------------------------
create or replace function public.trip_requests_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_salida timestamptz;
begin
  if not private.has_recent_face_check(new.passenger_id) then
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
  if p_accept and not private.has_recent_face_check(auth.uid()) then
    raise exception 'Verifica tu rostro antes de aceptar pasajeros';
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

revoke execute on function public.respond_trip_request(uuid, boolean) from public, anon;
grant execute on function public.respond_trip_request(uuid, boolean) to authenticated, service_role;
revoke execute on function public.trip_requests_before_insert() from public, anon, authenticated;
