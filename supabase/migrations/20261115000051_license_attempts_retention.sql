-- =====================================================================
-- Número de licencia: retención de intentos y mensaje del límite.
--
-- * Los registros de license_number_attempts se borran a los 90 días con un
--   job diario de pg_cron (la extensión ya se usa desde la migración 027).
--   Al eliminar la cuenta se borran antes por el on delete cascade.
-- * El 6.º intento en 24 horas responde "Demasiados intentos. Intenta de
--   nuevo en 24 horas.". El resto del RPC es idéntico a la migración 050.
--
--  Reversión (manual): select cron.unschedule('cleanup-license-number-attempts');
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Retención: 90 días
-- ---------------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'cleanup-license-number-attempts';
select cron.schedule('cleanup-license-number-attempts', '29 3 * * *',
  $$delete from public.license_number_attempts where created_at < now() - interval '90 days'$$);

-- ---------------------------------------------------------------------
-- 2. RPC: nuevo mensaje del límite de intentos
-- ---------------------------------------------------------------------
create or replace function public.submit_license_face(p_embedding real[], p_license_number text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  d public.driver_profiles;
  v_hash text;
  v_constraint text;
begin
  if v_user is null then raise exception 'No autenticado'; end if;

  -- Serializa los intentos de un mismo usuario para que el conteo sea exacto.
  perform pg_advisory_xact_lock(hashtextextended('license_number_attempts:' || v_user::text, 0));
  if (select count(*) from public.license_number_attempts a
       where a.user_id = v_user and a.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'Demasiados intentos. Intenta de nuevo en 24 horas.';
  end if;

  -- Valida el formato (sin revelar nada sobre otras cuentas) y calcula el HMAC.
  v_hash := private.license_number_hash(p_license_number);
  perform private.check_face_embedding(p_embedding);
  perform private.check_face_rate_limit(v_user);

  select * into d from public.driver_profiles where user_id = v_user for update;
  if found and d.status = 'suspendido' then
    raise exception 'Tu permiso de conductor está suspendido';
  end if;

  -- Una licencia nueva exige volver a comprobar la identidad. Se escribe antes
  -- que la plantilla para que un duplicado no deje nada guardado.
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
    if v_constraint <> 'driver_profiles_license_hash_key' then raise; end if;
    insert into public.license_number_attempts (user_id, result) values (v_user, 'duplicate');
    return jsonb_build_object(
      'status', 'duplicate',
      'message', 'No pudimos verificar tu licencia. Escríbenos a soporte si crees que es un error.'
    );
  end;

  insert into public.face_templates (user_id, kind, embedding, created_at)
  values (v_user, 'license', p_embedding, now())
  on conflict (user_id, kind) do update set embedding = excluded.embedding, created_at = now();

  insert into public.license_number_attempts (user_id, result) values (v_user, 'accepted');

  -- Cuenta para el límite de intentos faciales, pero no como verificación de identidad.
  insert into public.face_verifications (user_id, status, provider, purpose, template_kind)
  values (v_user, 'procesando', 'on_device_sface', 'license_upload', 'license');

  return jsonb_build_object('status', 'pendiente');
end $$;

revoke execute on function public.submit_license_face(real[], text) from public, anon;
grant execute on function public.submit_license_face(real[], text) to authenticated, service_role;
