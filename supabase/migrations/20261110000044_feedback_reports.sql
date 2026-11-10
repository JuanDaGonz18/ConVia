-- =====================================================================
-- ConVía — canal de retroalimentación (reportes de errores y sugerencias)
--
--  * public.feedback_reports: un reporte por fila. Cada persona solo lee
--    los suyos (RLS). authenticated NO tiene INSERT, UPDATE ni DELETE: crea
--    reportes únicamente con public.submit_feedback, que valida la sesión,
--    la categoría, el largo del texto y un límite de envíos.
--  * Límite: 5 reportes por hora y 20 por día por persona
--    (FEEDBACK_RATE_LIMIT).
--  * El estado (nuevo, en_revision, resuelto, descartado) y la nota del
--    equipo solo los cambia el equipo con service_role (SQL o consola);
--    la app muestra el estado de cada reporte propio, pero no la nota.
--
-- Triage del equipo (SQL Editor, rol postgres):
--   select created_at, category, status, left(description, 80)
--     from public.feedback_reports where status = 'nuevo' order by created_at;
--   update public.feedback_reports set status = 'resuelto' where id = '...';
-- =====================================================================

create table if not exists public.feedback_reports (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  category     text not null check (category in ('bug', 'suggestion', 'safety', 'other')),
  description  text not null check (char_length(description) between 10 and 1000),
  app_version  text check (app_version is null or char_length(app_version) <= 40),
  platform     text check (platform is null or platform in ('ios', 'android', 'web')),
  status       text not null default 'nuevo' check (status in ('nuevo', 'en_revision', 'resuelto', 'descartado')),
  team_note    text check (team_note is null or char_length(team_note) <= 1000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists feedback_reports_user_created_idx on public.feedback_reports (user_id, created_at desc);
create index if not exists feedback_reports_status_idx on public.feedback_reports (status, created_at);

drop trigger if exists feedback_reports_updated_at on public.feedback_reports;
create trigger feedback_reports_updated_at
  before update on public.feedback_reports
  for each row execute function public.set_updated_at();

alter table public.feedback_reports enable row level security;

revoke all on public.feedback_reports from anon, authenticated;
-- Lectura solo de las columnas que la persona puede ver (sin team_note).
grant select (id, user_id, category, description, app_version, platform, status, created_at)
  on public.feedback_reports to authenticated;
grant all on public.feedback_reports to service_role;

drop policy if exists feedback_own_read on public.feedback_reports;
create policy feedback_own_read on public.feedback_reports
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- submit_feedback: única vía de creación
-- ---------------------------------------------------------------------
create or replace function public.submit_feedback(
  p_category text,
  p_description text,
  p_app_version text default null,
  p_platform text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_text text := btrim(coalesce(p_description, ''));
  v_id uuid;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_category is null or p_category not in ('bug', 'suggestion', 'safety', 'other') then
    raise exception 'FEEDBACK_CATEGORY_INVALID';
  end if;
  if char_length(v_text) < 10 then raise exception 'FEEDBACK_TOO_SHORT'; end if;
  if char_length(v_text) > 1000 then raise exception 'FEEDBACK_TOO_LONG'; end if;

  if (select count(*) from public.feedback_reports
       where user_id = v_user and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.feedback_reports
          where user_id = v_user and created_at > now() - interval '1 day') >= 20 then
    raise exception 'FEEDBACK_RATE_LIMIT';
  end if;

  insert into public.feedback_reports (user_id, category, description, app_version, platform)
  values (v_user, p_category, v_text, left(p_app_version, 40),
          case when p_platform in ('ios', 'android', 'web') then p_platform end)
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.submit_feedback(text, text, text, text) from public, anon;
grant execute on function public.submit_feedback(text, text, text, text) to authenticated;
