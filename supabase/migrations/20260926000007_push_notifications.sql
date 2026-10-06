-- ConVía: push notification token and preference per profile.
-- The `notify` Edge Function reads these with the service role; the client
-- can only write its own row (profiles_update_own policy).

alter table public.profiles
  add column if not exists expo_push_token text,
  add column if not exists notifications_enabled boolean not null default true;

grant update (expo_push_token, notifications_enabled) on public.profiles to authenticated;
