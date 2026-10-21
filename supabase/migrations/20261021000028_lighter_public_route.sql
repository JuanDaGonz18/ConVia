-- =====================================================================
-- ConVía — ruta pública más liviana (menos egress)
--  La lista de viajes envía la ruta de cada viaje. Para quien no es el
--  conductor basta una ruta de hasta 120 puntos con 5 decimales (~1 m): la
--  compatibilidad trabaja en cientos de metros y el mapa se ve igual a escala
--  de ciudad. El conductor sigue leyendo su ruta completa en trips.ruta.
--  Se mantiene todo lo anterior: sin los 500 m de cada extremo y paradas sin
--  número de casa ni coordenadas exactas.
--
--  Reversión: volver a crear private.public_route() de la migración 22.
-- =====================================================================
create or replace function private.public_route(p_route jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_coords jsonb := p_route -> 'coords';
  v_kept jsonb := '[]'::jsonb;
  v_out jsonb := '[]'::jsonb;
  v_n integer;
  v_step double precision;
  v_first_lat double precision; v_first_lng double precision;
  v_last_lat double precision; v_last_lng double precision;
  v_lat double precision; v_lng double precision;
  v_max constant integer := 120;
begin
  if p_route is null or jsonb_typeof(v_coords) <> 'array' or jsonb_array_length(v_coords) < 2 then return null; end if;
  v_n := jsonb_array_length(v_coords);
  v_first_lng := (v_coords -> 0 ->> 0)::double precision; v_first_lat := (v_coords -> 0 ->> 1)::double precision;
  v_last_lng := (v_coords -> (v_n - 1) ->> 0)::double precision; v_last_lat := (v_coords -> (v_n - 1) ->> 1)::double precision;
  -- 1. Sin los 500 m del inicio y del final (no revela de qué casa sale ni a cuál llega).
  for i in 0 .. v_n - 1 loop
    v_lng := (v_coords -> i ->> 0)::double precision;
    v_lat := (v_coords -> i ->> 1)::double precision;
    if private.km(v_lat, v_lng, v_first_lat, v_first_lng) >= 0.5 and private.km(v_lat, v_lng, v_last_lat, v_last_lng) >= 0.5 then
      v_kept := v_kept || jsonb_build_array(jsonb_build_array(round(v_lng::numeric, 5), round(v_lat::numeric, 5)));
    end if;
  end loop;
  v_n := jsonb_array_length(v_kept);
  if v_n < 2 then return null; end if;
  -- 2. Como máximo v_max puntos, repartidos a lo largo de la ruta (siempre el primero y el último).
  if v_n > v_max then
    v_step := (v_n - 1)::double precision / (v_max - 1);
    for i in 0 .. v_max - 1 loop
      v_out := v_out || jsonb_build_array(v_kept -> least(v_n - 1, round(i * v_step)::integer));
    end loop;
    v_kept := v_out;
  end if;
  return jsonb_build_object(
    'coords', v_kept,
    'km', p_route -> 'km',
    'minutes', p_route -> 'minutes',
    'via', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', private.public_label(stop ->> 'label'),
        'lat', private.fuzz((stop ->> 'lat')::double precision),
        'lng', private.fuzz((stop ->> 'lng')::double precision)))
        from jsonb_array_elements(coalesce(p_route -> 'via', '[]'::jsonb)) stop), '[]'::jsonb));
end $$;

revoke execute on function private.public_route(jsonb) from public, anon;
grant execute on function private.public_route(jsonb) to authenticated;
