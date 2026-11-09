-- Consultas con más tiempo total durante la prueba k6 (pg_stat_statements).
select round(total_exec_time)::bigint as total_ms, calls,
       round(mean_exec_time::numeric, 2) as mean_ms,
       round(max_exec_time::numeric, 1) as max_ms,
       left(regexp_replace(query, '\s+', ' ', 'g'), 160) as query
  from extensions.pg_stat_statements
 where calls > 10
 order by total_exec_time desc
 limit 20;
