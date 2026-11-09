-- =====================================================================
-- ConVía — versión legal aceptada (migración 040)
--
-- Uso local: npx supabase db query -f supabase/tests/legal_acceptance_test.sql
-- Todo se deshace al final (el bloque termina con RAISE EXCEPTION); el
-- mensaje de error es el reporte. Cada línea dice OK o BAD.
-- =====================================================================
do $$
declare
  uNew uuid := gen_random_uuid();  -- se registra con la app nueva (1.2)
  uOld uuid := gen_random_uuid();  -- se registra con una app vieja (1.1)
  uBad uuid := gen_random_uuid();  -- metadatos con una versión inventada
  uMs  uuid := gen_random_uuid();  -- Microsoft: sin aceptación en el registro
  uPre uuid := gen_random_uuid();  -- "existente": aceptó antes de la columna
  r text := ''; n integer; bad integer; v text;
begin
  -- ================= Registro =================
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role) values
    (uNew, 'zz.legal.new@gmail.com', '{"nombre":"ZZ New","terms_accepted":true,"terms_version":"1.2"}', '{"provider":"email"}', 'authenticated', 'authenticated'),
    (uOld, 'zz.legal.old@gmail.com', '{"nombre":"ZZ Old","terms_accepted":true,"terms_version":"1.1"}', '{"provider":"email"}', 'authenticated', 'authenticated'),
    (uBad, 'zz.legal.bad@gmail.com', '{"nombre":"ZZ Bad","terms_accepted":true,"terms_version":"99.0"}', '{"provider":"email"}', 'authenticated', 'authenticated'),
    (uMs,  'zz.legal.ms@gmail.com',  '{"full_name":"ZZ Ms"}', '{"provider":"email"}', 'authenticated', 'authenticated'),
    (uPre, 'zz.legal.pre@gmail.com', '{"nombre":"ZZ Pre","terms_accepted":true}', '{"provider":"email"}', 'authenticated', 'authenticated');

  r := r || case when (select accepted_legal_version from public.profiles where id = uNew) = '1.2'
                 then E'\nOK  signup: stores the version the app sent (1.2)' else E'\nBAD signup: 1.2 not stored' end;
  r := r || case when (select accepted_legal_version from public.profiles where id = uOld) = '1.1'
                 then E'\nOK  signup: an older app stores 1.1' else E'\nBAD signup: 1.1 not stored' end;
  r := r || case when (select accepted_legal_version from public.profiles where id = uBad) is null
                 then E'\nOK  signup: a version above the current one is ignored' else E'\nBAD signup: accepted 99.0' end;
  r := r || case when (select accepted_legal_version from public.profiles where id = uMs) is null
                 then E'\nOK  signup: no acceptance, no version' else E'\nBAD signup: version without acceptance' end;

  -- ================= Backfill =================
  -- uPre aceptó sin versión (como los usuarios anteriores a la migración).
  update public.profiles set accepted_legal_version = null where id = uPre;
  n := private.backfill_legal_version();
  r := r || case when n >= 1 and (select accepted_legal_version from public.profiles where id = uPre) = '1.1'
                 then E'\nOK  backfill: accepted without a version → 1.1' else E'\nBAD backfill: uPre not set to 1.1' end;
  r := r || case when (select accepted_legal_version from public.profiles where id = uMs) is null
                  and (select accepted_legal_version from public.profiles where id = uNew) = '1.2'
                 then E'\nOK  backfill: leaves users without acceptance and newer versions alone' else E'\nBAD backfill: touched other rows' end;
  r := r || case when not exists (select 1 from public.profiles where terms_accepted_at is not null and accepted_legal_version is null)
                 then E'\nOK  backfill: nobody who accepted is left without a version' else E'\nBAD backfill: rows left' end;

  -- ================= Comparación =================
  r := r || case when private.legal_version_at_least('1.10', '1.2') and private.legal_version_at_least('1.2', '1.2')
                  and not private.legal_version_at_least('1.1', '1.2') and not private.legal_version_at_least(null, '1.2')
                  and not private.legal_version_at_least('abc', '1.2')
                 then E'\nOK  compare: numeric, null and garbage never reach' else E'\nBAD compare' end;

  -- ================= accept_legal =================
  perform set_config('request.jwt.claims', json_build_object('sub', uMs, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    perform public.accept_legal('1.1');
    r := r || E'\nBAD accept: accepted an old version';
  exception when others then
    r := r || case when sqlerrm = 'LEGAL_VERSION_INVALID' then E'\nOK  accept: only the current version' else E'\nBAD accept: ' || sqlerrm end;
  end;
  begin
    perform public.accept_legal('99.0');
    r := r || E'\nBAD accept: accepted a future version';
  exception when others then
    r := r || case when sqlerrm = 'LEGAL_VERSION_INVALID' then E'\nOK  accept: not a future version' else E'\nBAD accept: ' || sqlerrm end;
  end;

  v := public.accept_legal('1.2');
  r := r || case when v = '1.2' and public.my_accepted_legal_version() = '1.2'
                 then E'\nOK  accept: current user accepts 1.2 and reads it back' else E'\nBAD accept: not stored' end;

  begin
    update public.profiles set accepted_legal_version = '1.2' where id = uOld;
    r := r || E'\nBAD grants: updated the column directly';
  exception when insufficient_privilege then r := r || E'\nOK  grants: the column cannot be updated directly'; end;
  begin
    perform accepted_legal_version from public.profiles where id = uMs;
    r := r || E'\nBAD grants: read the column directly';
  exception when insufficient_privilege then r := r || E'\nOK  grants: the column cannot be read directly'; end;
  begin
    perform private.backfill_legal_version();
    r := r || E'\nBAD grants: backfill callable from the app';
  exception when insufficient_privilege then r := r || E'\nOK  grants: private functions not callable from the app'; end;
  begin
    perform public.service_accepted_legal_version(uOld);
    r := r || E'\nBAD grants: service_accepted_legal_version callable from the app';
  exception when insufficient_privilege then r := r || E'\nOK  grants: service_accepted_legal_version is service_role only'; end;
  execute 'reset role';

  execute 'set local role service_role';
  r := r || case when public.service_accepted_legal_version(uOld) = '1.1' and public.service_accepted_legal_version(uMs) = '1.2'
                 then E'\nOK  service: Edge Functions read any user''s version' else E'\nBAD service: wrong version read' end;
  execute 'reset role';

  r := r || case when (select accepted_legal_version from public.profiles where id = uMs) = '1.2'
                  and (select terms_accepted_at from public.profiles where id = uMs) is not null
                  and (select accepted_legal_version from public.profiles where id = uOld) = '1.1'
                 then E'\nOK  accept: only the caller''s row changed, with terms_accepted_at set' else E'\nBAD accept: wrong rows' end;

  -- Sin sesión.
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  begin
    perform public.accept_legal('1.2');
    r := r || E'\nBAD anon: accept_legal callable without a session';
  exception when insufficient_privilege then r := r || E'\nOK  anon: accept_legal not callable'; end;
  execute 'reset role';

  bad := (length(r) - length(replace(r, E'\nBAD', ''))) / 4;
  raise exception 'LEGAL ACCEPTANCE (rolled back) — % failing:%', bad, r;
end $$;
