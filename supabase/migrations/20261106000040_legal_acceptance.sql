-- =====================================================================
-- ConVía — versión de los documentos legales aceptada por cada usuario
--
-- profiles.accepted_legal_version: la versión de Términos + Política de
-- datos que la persona aceptó. Antes solo quedaba la fecha
-- (terms_accepted_at) y la versión en los metadatos del registro.
--
--  * Usuarios existentes con terms_accepted_at: '1.1' (lo vigente hasta hoy).
--  * Registro nuevo: la versión que manda la app en los metadatos
--    (terms_version), si es válida y no es mayor que la vigente.
--  * Después: solo con public.accept_legal(version), para el usuario actual
--    y solo con la versión vigente. authenticated no tiene SELECT ni UPDATE
--    sobre la columna; la lee con public.my_accepted_legal_version().
--  * Las Edge Functions de IA exigen al menos la 1.2 (403 LEGAL_OUTDATED);
--    la leen con public.service_accepted_legal_version (solo service_role).
--
-- Al publicar una versión nueva: cambiar private.current_legal_version(),
-- LEGAL_VERSION en src/content/legal.ts y, si aplica, MIN_LEGAL_VERSION en
-- supabase/functions/_shared/legal.ts.
-- =====================================================================

alter table public.profiles
  add column if not exists accepted_legal_version text
    check (accepted_legal_version is null or accepted_legal_version ~ '^[0-9]{1,4}(\.[0-9]{1,4}){0,3}$');

create or replace function private.current_legal_version()
returns text language sql immutable set search_path = '' as $$ select '1.2' $$;

-- '1.10' >= '1.2' (compara número por número, no como texto). Null nunca alcanza.
create or replace function private.legal_version_at_least(p_version text, p_min text)
returns boolean language sql immutable set search_path = '' as $$
  select p_version is not null
     and p_version ~ '^[0-9]{1,4}(\.[0-9]{1,4}){0,3}$'
     and string_to_array(p_version, '.')::int[] >= string_to_array(p_min, '.')::int[]
$$;

-- Usuarios que aceptaron antes de que existiera la columna: la 1.1.
create or replace function private.backfill_legal_version()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.profiles set accepted_legal_version = '1.1'
   where terms_accepted_at is not null and accepted_legal_version is null;
  get diagnostics n = row_count;
  return n;
end $$;

select private.backfill_legal_version();

-- Registro: la versión que aceptó en la pantalla de registro (metadatos de auth.users).
create or replace function private.set_signup_legal_version()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if new.terms_accepted_at is not null and new.accepted_legal_version is null then
    select u.raw_user_meta_data ->> 'terms_version' into v from auth.users u where u.id = new.id;
    if private.legal_version_at_least(v, '0')
       and private.legal_version_at_least(private.current_legal_version(), v) then
      new.accepted_legal_version := v;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_signup_legal_version on public.profiles;
create trigger profiles_signup_legal_version
  before insert on public.profiles
  for each row execute function private.set_signup_legal_version();

-- La persona acepta la versión vigente (modal de la app).
create or replace function public.accept_legal(p_version text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_version is distinct from private.current_legal_version() then
    raise exception 'LEGAL_VERSION_INVALID';
  end if;
  update public.profiles
     set accepted_legal_version = p_version,
         terms_accepted_at = coalesce(terms_accepted_at, now())
   where id = v_user;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  return p_version;
end $$;

create or replace function public.my_accepted_legal_version()
returns text language sql stable security definer set search_path = '' as $$
  select accepted_legal_version from public.profiles where id = auth.uid()
$$;

-- Para las Edge Functions (service_role): la versión aceptada de un usuario.
create or replace function public.service_accepted_legal_version(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select accepted_legal_version from public.profiles where id = p_user
$$;
revoke execute on function public.service_accepted_legal_version(uuid) from public, anon, authenticated;
grant execute on function public.service_accepted_legal_version(uuid) to service_role;

revoke execute on function private.current_legal_version(), private.legal_version_at_least(text, text),
  private.backfill_legal_version(), private.set_signup_legal_version() from public, anon, authenticated;
revoke execute on function public.accept_legal(text), public.my_accepted_legal_version() from public, anon;
grant execute on function public.accept_legal(text), public.my_accepted_legal_version() to authenticated;

-- La columna no se lee ni se escribe directo (030 dejó grants por columna; esta no está en la lista).
revoke select (accepted_legal_version), update (accepted_legal_version), insert (accepted_legal_version)
  on public.profiles from anon, authenticated;
