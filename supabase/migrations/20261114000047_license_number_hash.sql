-- =====================================================================
-- Número de licencia: solo un hash con clave (HMAC-SHA256), único por cuenta.
--
-- * El número nunca se guarda en claro (la migración 011 quitó license_number).
-- * La clave HMAC vive en Vault ('convia_license_hmac_key'). Se genera aquí
--   al azar si no existe, así que no aparece en este archivo ni llega al cliente.
-- * Una segunda cuenta con el mismo número recibe un error en español.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columna
-- ---------------------------------------------------------------------
alter table public.driver_profiles
  add column if not exists license_hash text;

comment on column public.driver_profiles.license_hash is
  'HMAC-SHA256 (hex) del número de licencia normalizado; la clave está en Vault. Nunca se guarda el número.';

-- ---------------------------------------------------------------------
-- 2. Clave en Vault (solo si aún no existe; nunca se sobrescribe)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'convia_license_hmac_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'convia_license_hmac_key',
      'Clave HMAC-SHA256 para license_hash en driver_profiles. Cambiarla invalida los hashes existentes.'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Hash: normaliza (sin espacios ni guiones, mayúsculas) y aplica HMAC
-- ---------------------------------------------------------------------
create or replace function private.license_number_hash(p_license_number text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_number text := upper(regexp_replace(coalesce(p_license_number, ''), '[[:space:]-]', '', 'g'));
  v_key text;
begin
  -- El mensaje nunca incluye el número.
  if v_number !~ '^[A-Z0-9]{4,30}$' then
    raise exception 'El número de licencia no es válido';
  end if;

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'convia_license_hmac_key';
  if v_key is null then
    raise exception 'No se pudo registrar la licencia. Intenta más tarde.';
  end if;

  return encode(extensions.hmac(v_number, v_key, 'sha256'), 'hex');
end $$;

revoke execute on function private.license_number_hash(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Duplicados antes del índice (solo se reportan; no se tocan filas)
-- ---------------------------------------------------------------------
do $$
declare
  v_duplicates integer;
begin
  select count(*) into v_duplicates
    from (select license_hash from public.driver_profiles
           where license_hash is not null
           group by license_hash having count(*) > 1) d;
  raise notice 'license_hash duplicados: %', v_duplicates;
  if v_duplicates > 0 then
    raise exception 'Hay % license_hash duplicados; revísalos a mano antes de crear el índice único.', v_duplicates;
  end if;
end $$;

create unique index if not exists driver_profiles_license_hash_key
  on public.driver_profiles (license_hash)
  where license_hash is not null;

-- ---------------------------------------------------------------------
-- 5. RPC: la foto de la licencia ahora exige el número
-- ---------------------------------------------------------------------
drop function if exists public.submit_license_face(real[]);

create or replace function public.submit_license_face(p_embedding real[], p_license_number text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  d public.driver_profiles;
  v_hash text;
  v_constraint text;
begin
  if v_user is null then raise exception 'No autenticado'; end if;
  v_hash := private.license_number_hash(p_license_number);
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
  begin
    insert into public.driver_profiles as dp (user_id, status, submitted_at, license_hash)
    values (v_user, 'pendiente', now(), v_hash)
    on conflict (user_id) do update set
      status = 'pendiente',
      submitted_at = now(),
      license_hash = excluded.license_hash,
      identity_verified_at = null,
      reviewed_at = null,
      review_notes = null;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'driver_profiles_license_hash_key' then
      raise exception 'Este número de licencia ya está registrado en otra cuenta.';
    end if;
    raise;
  end;

  -- Cuenta para el límite de intentos, pero no como verificación de identidad.
  insert into public.face_verifications (user_id, status, provider, purpose, template_kind)
  values (v_user, 'procesando', 'on_device_sface', 'license_upload', 'license');

  return jsonb_build_object('status', 'pendiente');
end $$;

revoke execute on function public.submit_license_face(real[], text) from public, anon;
grant execute on function public.submit_license_face(real[], text) to authenticated, service_role;
