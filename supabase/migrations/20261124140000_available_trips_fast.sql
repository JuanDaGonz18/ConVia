-- =====================================================================
-- ConVía — búsqueda de viajes rápida (docs/OPERACION.md §6, "Dónde se va el tiempo")
--
-- available_trips calculaba private.public_route(t.ruta) para CADA viaje
-- abierto en CADA búsqueda: un bucle plpgsql que recorre todos los puntos de
-- la ruta (2 distancias por punto) y concatena jsonb (costo cuadrático). Con
-- ~1 000 viajes eso era casi todo el ~1 s por búsqueda medido en la prueba de
-- carga.
--
-- Ahora la versión pública de la ruta se calcula UNA vez, al guardar el viaje
-- (trigger), y se guarda en trips.ruta_publica. La vista y lo que devuelve no
-- cambian: mismas columnas, mismo recorte de 500 m al inicio y al final, mismo
-- máximo de 120 puntos. Apps viejas siguen funcionando sin cambios.
--
-- Además: índice parcial para el filtro de la búsqueda (institución + viajes
-- por empezar, ordenados por salida).
-- =====================================================================

alter table public.trips add column if not exists ruta_publica jsonb;

comment on column public.trips.ruta_publica is
  'private.public_route(ruta), calculada por el trigger trips_public_route. No se escribe desde la app.';

-- SECURITY DEFINER: los conductores insertan viajes como `authenticated`, que no
-- puede ejecutar private.public_route directamente.
create or replace function private.trips_set_public_route()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.ruta_publica := private.public_route(new.ruta);
  return new;
end $$;

revoke execute on function private.trips_set_public_route() from public, anon, authenticated;

drop trigger if exists trips_public_route on public.trips;
create trigger trips_public_route
  before insert or update of ruta on public.trips
  for each row execute function private.trips_set_public_route();

-- Viajes existentes. No dispara trips_public_route ni las alertas (no toca la
-- columna ruta); se apaga trips_updated_at para no cambiar updated_at.
alter table public.trips disable trigger trips_updated_at;
update public.trips
   set ruta_publica = private.public_route(ruta)
 where ruta is not null;
alter table public.trips enable trigger trips_updated_at;

create index if not exists trips_open_by_institution
  on public.trips (institution_id, salida_at)
  where estado = 'por_empezar';

create or replace function private.available_trip_rows()
returns table(
  id uuid, driver_id uuid, vehicle_id uuid, institution_id uuid,
  origen_nombre text, origen_lat double precision, origen_lng double precision,
  destino_nombre text, destino_lat double precision, destino_lng double precision,
  sector text, salida_at timestamp with time zone, precio numeric, cupos_totales smallint, descripcion text,
  estado public.trip_status, started_at timestamp with time zone, finished_at timestamp with time zone,
  created_at timestamp with time zone, updated_at timestamp with time zone,
  cupos_disponibles integer, driver_nombre text, driver_avatar_url text, driver_rating numeric,
  vehicle_marca text, vehicle_color text, vehicle_placa text, vehicle_foto_url text,
  ruta jsonb, driver_is_plus boolean)
language sql
stable security definer
set search_path = ''
as $$
  select t.id, t.driver_id, t.vehicle_id, t.institution_id,
         private.public_label(t.origen_nombre), private.fuzz(t.origen_lat), private.fuzz(t.origen_lng),
         private.public_label(t.destino_nombre), private.fuzz(t.destino_lat), private.fuzz(t.destino_lng),
         t.sector, t.salida_at, t.precio, t.cupos_totales, t.descripcion,
         t.estado, t.started_at, t.finished_at, t.created_at, t.updated_at,
         t.cupos_totales - private.seats_taken(t.id), p.nombre, p.avatar_url, p.rating_driver_avg,
         v.marca, v.color, private.mask_plate(v.placa), v.foto_url, t.ruta_publica, private.is_plus(t.driver_id)
    from public.trips t
    join public.profiles p on p.id = t.driver_id
    join public.vehicles v on v.id = t.vehicle_id
   where t.estado = 'por_empezar'::public.trip_status
     and t.salida_at > (now() - '00:15:00'::interval)
     and t.institution_id = (select private.current_institution_id())
$$;
