-- =====================================================================
-- ConVía — estadísticas: tramo del pasajero en km de la ruta
--  El tramo (de la recogida a la bajada) se calculaba con la longitud de la
--  línea de la ruta, que puede diferir de los km de la ruta que se muestran.
--  Ahora es la fracción del recorrido × los km del viaje, así que un
--  pasajero que hace todo el viaje suma exactamente los km del viaje.
-- =====================================================================
create or replace function private.ride_km(t public.trips, r public.trip_requests)
returns double precision language plpgsql stable set search_path = '' as $$
declare
  v_coords jsonb;
  v_last integer;
  v_total record; v_pick record; v_drop record;
begin
  if r.lat is null or r.lng is null or t.origen_lat is null then return private.trip_km(t); end if;
  v_coords := private.trip_coords(t);
  v_last := jsonb_array_length(v_coords) - 1;
  select * into v_total from private.project_on_route(v_coords, (v_coords -> v_last ->> 1)::double precision, (v_coords -> v_last ->> 0)::double precision);
  select * into v_pick from private.project_on_route(v_coords, r.lat, r.lng);
  select * into v_drop from private.project_on_route(v_coords, coalesce(r.destino_lat, t.destino_lat), coalesce(r.destino_lng, t.destino_lng));
  if v_total.along_km <= 0 or v_drop.along_km <= v_pick.along_km then return private.trip_km(t); end if;
  return private.trip_km(t) * least(1, (v_drop.along_km - v_pick.along_km) / v_total.along_km);
end $$;
revoke execute on function private.ride_km(public.trips, public.trip_requests) from public, anon, authenticated;
