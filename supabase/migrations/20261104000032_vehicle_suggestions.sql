-- =====================================================================
-- ConVía — límite de suggest-vehicle (autocompletar el vehículo con IA)
--
-- Una fila por llamada, para que el tope de 20 por hora se cumpla entre
-- instancias de la Edge Function. Solo la escribe la función con el
-- service role: RLS sin políticas y sin grants a anon ni authenticated.
-- La capacidad vehicle_autofill (ConVía+) se revisa en la función con
-- public.service_check_plan().
-- =====================================================================
create table public.vehicle_suggestions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index vehicle_suggestions_user_created_idx on public.vehicle_suggestions (user_id, created_at);

alter table public.vehicle_suggestions enable row level security;
revoke all on public.vehicle_suggestions from public, anon, authenticated;
grant select, insert, delete on public.vehicle_suggestions to service_role;

-- Solo se cuenta la última hora: lo anterior no se vuelve a leer.
select cron.schedule('cleanup-vehicle-suggestions', '31 3 * * *', $$
  delete from public.vehicle_suggestions where created_at < now() - interval '1 day';
$$);
