-- =====================================================================
-- ConVía — estado "no_iniciado"
--  Un viaje que nunca se inició y cuya hora de salida pasó hace más de
--  2 horas queda como no_iniciado (ver la migración siguiente).
--  Va en su propio archivo: Postgres no permite usar un valor nuevo de un
--  enum en la misma transacción que lo crea.
-- =====================================================================

alter type public.trip_status add value if not exists 'no_iniciado';
