-- =====================================================================
-- ConVía — publicar o pedir cupo exige una membresía VERIFICADA
-- (portado del repo del hackathon: sección 5 de la 040; el resto de esa
-- migración ya está en la 030 de la base)
--
-- Antes bastaba con profiles.institution_id. Ahora además debe existir la
-- membresía verificada en esa misma institución, así que un institution_id
-- que no salió de private.verify_membership no deja publicar ni pedir cupo.
-- =====================================================================

create or replace function private.require_verified_institution()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if tg_table_name = 'trips' then
    v_user := new.driver_id;
  else
    v_user := new.passenger_id;
  end if;
  if not exists (
    select 1 from public.profiles p
      join public.institution_memberships m
        on m.user_id = p.id and m.institution_id = p.institution_id and m.status = 'verified'
     where p.id = v_user
  ) then
    raise exception 'INSTITUTION_NOT_VERIFIED' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function private.require_verified_institution() from public, anon, authenticated;
