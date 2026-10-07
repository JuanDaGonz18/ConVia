-- =====================================================================
-- ConVía — marcar automáticamente los viajes no iniciados
--  Cada 10 minutos (pg_cron): los viajes 'por_empezar' cuya salida fue
--  hace más de 2 horas pasan a 'no_iniciado', y sus solicitudes pendientes
--  o aceptadas se cancelan para que el pasajero no quede esperando.
--  Los viajes cancelados, en curso o finalizados no se tocan.
-- =====================================================================

create or replace function private.mark_unstarted_trips()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  with stale as (
    update public.trips
       set estado = 'no_iniciado'
     where estado = 'por_empezar'
       and salida_at < now() - interval '2 hours'
    returning id
  ), cancelled as (
    update public.trip_requests r
       set estado = 'cancelado'
      from stale
     where r.trip_id = stale.id
       and r.estado in ('pendiente', 'aceptado')
    returning r.id
  )
  select count(*) into v_count from stale;
  return v_count;
end $$;

revoke execute on function private.mark_unstarted_trips() from public, anon, authenticated;
grant execute on function private.mark_unstarted_trips() to service_role;

create extension if not exists pg_cron;

-- Reprogramable sin duplicar: se borra el trabajo anterior si existe.
select cron.unschedule(jobid) from cron.job where jobname = 'mark-unstarted-trips';
select cron.schedule('mark-unstarted-trips', '*/10 * * * *', $$select private.mark_unstarted_trips()$$);

-- Ponerse al día con los viajes que ya vencieron.
select private.mark_unstarted_trips();
