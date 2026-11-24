-- =====================================================================
-- ConVía — promoción de lanzamiento: 2 meses de ConVía+ al registrarse
--
-- Quien cree su cuenta antes de app_config.plus_promo_until (14 de febrero
-- de 2027, hora Colombia, inclusive) recibe ConVía+ por plus_promo_months
-- meses desde su registro: subscriptions con status 'trialing' y
-- provider 'promo_lanzamiento'. Vence sola (current_period_end); si luego
-- paga, el pago se suma desde ese vencimiento (grant de plus_payments).
-- Para terminarla antes: update public.app_config set plus_promo_until = now() where id;
-- =====================================================================

alter table public.app_config
  add column if not exists plus_promo_until  timestamptz,
  add column if not exists plus_promo_months integer not null default 2
    check (plus_promo_months between 1 and 12);

update public.app_config
   set plus_promo_until = timestamptz '2027-02-15 00:00:00-05', plus_promo_months = 2
 where id;

grant select (plus_promo_until, plus_promo_months) on public.app_config to authenticated;

create or replace function private.grant_signup_plus_promo()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_until  timestamptz;
  v_months integer;
begin
  select plus_promo_until, plus_promo_months into v_until, v_months from public.app_config where id;
  if v_until is not null and now() < v_until then
    insert into public.subscriptions (user_id, tier, status, current_period_end, provider)
    values (new.id, 'plus', 'trialing', now() + make_interval(months => v_months), 'promo_lanzamiento')
    on conflict (user_id) do nothing;
  end if;
  return new;
end $$;
revoke execute on function private.grant_signup_plus_promo() from public, anon, authenticated;

drop trigger if exists profiles_signup_plus_promo on public.profiles;
create trigger profiles_signup_plus_promo
  after insert on public.profiles
  for each row execute function private.grant_signup_plus_promo();
