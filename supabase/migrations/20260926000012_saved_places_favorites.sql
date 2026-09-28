-- =====================================================================
-- WheelsApp — lugares guardados y conductores favoritos
--  * saved_places: lugares opcionales del usuario (casa, trabajo,
--    universidad u otros) con coordenadas reales. La app los usa para
--    priorizar los viajes cuyo destino queda cerca de ellos.
--  * favorite_drivers: conductores que el usuario marcó como favoritos,
--    para destacar y priorizar sus viajes.
--  Cada usuario solo ve y modifica sus propias filas.
-- =====================================================================

create table public.saved_places (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('home', 'work', 'university', 'other')),
  label       text not null check (char_length(trim(label)) between 1 and 40),
  address     text not null default '' check (char_length(address) <= 300),
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Una sola casa, un solo trabajo y una sola universidad por usuario.
create unique index saved_places_one_per_kind on public.saved_places (user_id, kind) where kind <> 'other';
create index saved_places_user_idx on public.saved_places (user_id);

create trigger saved_places_updated_at
  before update on public.saved_places
  for each row execute function public.set_updated_at();

-- Máximo 10 lugares por usuario.
create or replace function public.saved_places_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.saved_places where user_id = new.user_id) >= 10 then
    raise exception 'Puedes guardar hasta 10 lugares';
  end if;
  return new;
end $$;

create trigger saved_places_limit_trg
  before insert on public.saved_places
  for each row execute function public.saved_places_limit();

revoke execute on function public.saved_places_limit() from public, anon, authenticated;

alter table public.saved_places enable row level security;
revoke all on public.saved_places from anon;
grant select, insert, update, delete on public.saved_places to authenticated;
grant all on public.saved_places to service_role;

create policy "saved_places_own_select" on public.saved_places
  for select to authenticated using (user_id = (select auth.uid()));
create policy "saved_places_own_insert" on public.saved_places
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "saved_places_own_update" on public.saved_places
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "saved_places_own_delete" on public.saved_places
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------

create table public.favorite_drivers (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  driver_id   uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, driver_id),
  check (user_id <> driver_id)
);

create index favorite_drivers_driver_idx on public.favorite_drivers (driver_id);

alter table public.favorite_drivers enable row level security;
revoke all on public.favorite_drivers from anon;
grant select, insert, delete on public.favorite_drivers to authenticated;
grant all on public.favorite_drivers to service_role;

create policy "favorite_drivers_own_select" on public.favorite_drivers
  for select to authenticated using (user_id = (select auth.uid()));
-- Solo se puede marcar a alguien que el usuario puede ver (misma institución).
create policy "favorite_drivers_own_insert" on public.favorite_drivers
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = driver_id)
  );
create policy "favorite_drivers_own_delete" on public.favorite_drivers
  for delete to authenticated using (user_id = (select auth.uid()));
