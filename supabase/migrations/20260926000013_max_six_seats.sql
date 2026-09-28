-- =====================================================================
-- WheelsApp — máximo 6 pasajeros por vehículo y por viaje
--  Antes se permitían hasta 8. Un viaje sigue limitado a los puestos
--  registrados de su vehículo (trips_before_insert).
-- =====================================================================

update public.vehicles set puestos = 6 where puestos > 6;
update public.trips set cupos_totales = 6 where cupos_totales > 6;

alter table public.vehicles drop constraint if exists vehicles_puestos_check;
alter table public.vehicles add constraint vehicles_puestos_check check (puestos between 1 and 6);

alter table public.trips drop constraint if exists trips_cupos_totales_check;
alter table public.trips add constraint trips_cupos_totales_check check (cupos_totales between 1 and 6);
