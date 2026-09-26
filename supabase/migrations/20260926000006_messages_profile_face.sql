-- WheelsApp: persisted participant chat and server-owned face references

alter table public.profiles
  add column if not exists face_reference_path text;

grant update (face_reference_path) on public.profiles to service_role;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists messages_trip_created_idx
  on public.messages(trip_id, created_at);

alter table public.messages enable row level security;
grant select, insert on public.messages to authenticated;
grant all on public.messages to service_role;

create policy "messages_participants_read" on public.messages
  for select to authenticated
  using (
    exists (select 1 from public.trips t
            where t.id = messages.trip_id and t.driver_id = (select auth.uid()))
    or exists (select 1 from public.trip_requests r
               where r.trip_id = messages.trip_id
                 and r.passenger_id = (select auth.uid())
                 and r.estado in ('pendiente', 'aceptado', 'abordado'))
  );

create policy "messages_participants_insert" on public.messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (
      exists (select 1 from public.trips t
              where t.id = messages.trip_id and t.driver_id = (select auth.uid()))
      or exists (select 1 from public.trip_requests r
                 where r.trip_id = messages.trip_id
                   and r.passenger_id = (select auth.uid())
                   and r.estado in ('pendiente', 'aceptado', 'abordado'))
    )
  );

alter publication supabase_realtime add table public.messages;

-- This function is intentionally service-role-only. The Edge Function owns
-- the provider result and updates the verification row through this RPC.
revoke execute on function public.set_verification_result(uuid, public.verification_status, numeric, text)
  from anon, authenticated;
grant execute on function public.set_verification_result(uuid, public.verification_status, numeric, text)
  to service_role;
