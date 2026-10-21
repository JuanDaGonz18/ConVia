-- =====================================================================
-- ConVía — reporte de uso para la revisión mensual (solo lectura)
--
-- Uso (administrador, nunca desde la app):
--   npx supabase db query --linked -f supabase/admin/usage_report.sql
--
-- Lo que la base de datos puede medir. Egress, invocaciones de Edge
-- Functions, mensajes y conexiones de Realtime y MAU oficiales se leen en
-- el panel de Supabase (Organization → Usage); ver docs/OPERACION.md.
-- =====================================================================
select jsonb_build_object(
  'fecha', now(),
  -- Plan Free: 500 MB de base de datos.
  'base_de_datos_mb', round(pg_database_size(current_database()) / 1048576.0, 1),
  'tablas_mas_grandes', (select jsonb_agg(jsonb_build_object('tabla', schemaname || '.' || relname, 'filas', n_live_tup,
                                                             'mb', round(pg_total_relation_size(relid) / 1048576.0, 2)))
                           from (select * from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 12) t),
  -- Plan Free: 1 GB de archivos.
  'storage_mb', (select jsonb_object_agg(bucket_id, mb) from (
                   select bucket_id, round(sum(coalesce((metadata ->> 'size')::bigint, 0)) / 1048576.0, 2) mb
                     from storage.objects group by bucket_id) s),
  'storage_archivos', (select count(*) from storage.objects),
  -- Archivos huérfanos (candidatos a limpiar; revisar antes de borrar).
  'huerfanos_sin_usuario', (select count(*) from storage.objects o
                             where o.bucket_id in ('avatars', 'vehicle-photos')
                               and not exists (select 1 from auth.users u where u.id::text = (storage.foldername(o.name))[1])),
  'fotos_vehiculo_sin_vehiculo', (select count(*) from storage.objects o
                                   where o.bucket_id = 'vehicle-photos'
                                     and not exists (select 1 from public.vehicles v where v.foto_url like '%' || o.name || '%')),
  -- Usuarios (aproximación de MAU: entraron en los últimos 30 días).
  'usuarios_total', (select count(*) from auth.users),
  'usuarios_activos_30d', (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days'),
  'usuarios_por_proveedor', (select jsonb_object_agg(provider, n) from (select provider, count(*) n from auth.identities group by provider) p),
  -- Crecimiento de las tablas que más crecen.
  'viajes_30d', (select count(*) from public.trips where created_at > now() - interval '30 days'),
  'solicitudes_30d', (select count(*) from public.trip_requests where created_at > now() - interval '30 days'),
  'mensajes_30d', (select count(*) from public.messages where created_at > now() - interval '30 days'),
  'alertas_pendientes', (select count(*) from public.trip_alert_hits where pushed_at is null),
  'historial_cron_filas', (select count(*) from cron.job_run_details),
  'cron_fallidos_7d', (select count(*) from cron.job_run_details where status <> 'succeeded' and start_time > now() - interval '7 days'),
  -- Consultas más costosas desde el último reinicio de estadísticas.
  'consultas_costosas', (select jsonb_agg(jsonb_build_object('llamadas', calls, 'ms_total', round(total_exec_time::numeric),
                                                             'ms_promedio', round(mean_exec_time::numeric, 1),
                                                             'consulta', left(regexp_replace(query, '\s+', ' ', 'g'), 120)))
                           from (select * from pg_stat_statements order by total_exec_time desc limit 8) q),
  'realtime_tablas', (select jsonb_agg(tablename) from pg_publication_tables where pubname = 'supabase_realtime')
) as reporte;
