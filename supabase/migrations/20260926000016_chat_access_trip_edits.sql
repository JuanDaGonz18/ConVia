-- =====================================================================
-- WheelsApp — chat solo para pasajeros aceptados y edición de viajes
--  1. Un pasajero lee y escribe en el chat del viaje solo cuando el
--     conductor aceptó su solicitud (o ya abordó). Antes bastaba con tener
--     una solicitud pendiente.
--  2. El conductor edita un viaje publicado mediante update_trip(), que
--     valida los cambios y guarda un resumen legible en trip_updates. La
--     función notify usa ese resumen para avisar a los pasajeros aceptados.
--     La edición directa de la tabla trips queda cerrada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Chat
-- ---------------------------------------------------------------------
drop policy if exists "messages_participants_read" on public.messages;
drop policy if exists "messages_participants_insert" on public.messages;

create policy "messages_participants_read" on public.messages
  for select to authenticated using (
    exists (select 1 from public.trips t where t.id = messages.trip_id and t.driver_id = (select auth.uid()))
    or exists (
      select 1 from public.trip_requests r
      where r.trip_id = messages.trip_id
        and r.passenger_id = (select auth.uid())
        and r.estado in ('aceptado', 'abordado')
    )
  );

create policy "messages_participants_insert" on public.messages
  for insert to authenticated with check (
    sender_id = (select auth.uid())
    and (
      exists (select 1 from public.trips t where t.id = messages.trip_id and t.driver_id = (select auth.uid()))
      or exists (
        select 1 from public.trip_requests r
        where r.trip_id = messages.trip_id
          and r.passenger_id = (select auth.uid())
          and r.estado in ('aceptado', 'abordado')
      )
    )
  );

-- ---------------------------------------------------------------------
-- 2. Historial de cambios de un viaje
-- ---------------------------------------------------------------------
create table public.trip_updates (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  changed_by  uuid not null references public.profiles(id) on delete cascade,
  changes     text[] not null check (array_length(changes, 1) > 0),
  created_at  timestamptz not null default now()
);

create index trip_updates_trip_idx on public.trip_updates (trip_id, created_at desc);

alter table public.trip_updates enable row level security;
revoke all on public.trip_updates from anon, authenticated;
grant select on public.trip_updates to authenticated;
grant all on public.trip_updates to service_role;

-- La ven el conductor y los pasajeros con solicitud activa en el viaje.
create policy "trip_updates_participants_read" on public.trip_updates
  for select to authenticated using (
    exists (select 1 from public.trips t where t.id = trip_updates.trip_id and t.driver_id = (select auth.uid()))
    or exists (
      select 1 from public.trip_requests r
      where r.trip_id = trip_updates.trip_id
        and r.passenger_id = (select auth.uid())
        and r.estado in ('pendiente', 'aceptado', 'abordado')
    )
  );

-- Solo por update_trip(); el conductor ya no actualiza trips directamente.
drop policy if exists "trips_update_own_pending" on public.trips;

create or replace function private.format_cop(p_value numeric)
returns text language sql immutable set search_path = '' as $$
  select '$' || replace(to_char(p_value, 'FM999G999G999'), ',', '.')
$$;

create or replace function private.format_departure(p_at timestamptz)
returns text language sql immutable set search_path = '' as $$
  select to_char(p_at at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI')
$$;

-- ---------------------------------------------------------------------
-- 3. Editar un viaje publicado
-- ---------------------------------------------------------------------
create or replace function public.update_trip(
  p_trip_id uuid,
  p_vehicle_id uuid,
  p_origen_nombre text,
  p_origen_lat double precision,
  p_origen_lng double precision,
  p_destino_nombre text,
  p_destino_lat double precision,
  p_destino_lng double precision,
  p_salida_at timestamptz,
  p_precio numeric,
  p_cupos_totales smallint,
  p_descripcion text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.trips;
  v_old_plate text;
  v_new_plate text;
  v_puestos smallint;
  v_taken integer;
  v_changes text[] := '{}';
  v_update_id uuid;
  v_description text := nullif(trim(coalesce(p_descripcion, '')), '');
begin
  select * into t from public.trips where id = p_trip_id for update;
  if not found or t.driver_id <> auth.uid() then raise exception 'Viaje no encontrado'; end if;
  if t.estado <> 'por_empezar' then raise exception 'Solo puedes editar viajes que aún no han empezado'; end if;
  if p_salida_at <= now() then raise exception 'La salida debe ser en el futuro'; end if;
  if p_precio is null or p_precio < 0 then raise exception 'Precio inválido'; end if;
  if char_length(trim(coalesce(p_origen_nombre, ''))) = 0 or char_length(trim(coalesce(p_destino_nombre, ''))) = 0 then
    raise exception 'Indica la salida y el destino';
  end if;

  select puestos, placa into v_puestos, v_new_plate from public.vehicles
   where id = p_vehicle_id and driver_id = auth.uid() and activo;
  if v_puestos is null then raise exception 'Elige uno de tus vehículos'; end if;
  if p_cupos_totales is null or p_cupos_totales < 1 or p_cupos_totales > v_puestos then
    raise exception 'Los cupos deben estar entre 1 y % (los puestos del vehículo)', v_puestos;
  end if;
  v_taken := private.seats_taken(t.id);
  if p_cupos_totales < v_taken then
    raise exception 'Ya aceptaste % pasajeros; no puedes ofrecer menos cupos', v_taken;
  end if;

  -- Resumen legible de lo que cambió (se usa en la notificación).
  if t.origen_nombre is distinct from p_origen_nombre or t.origen_lat is distinct from p_origen_lat or t.origen_lng is distinct from p_origen_lng then
    v_changes := v_changes || ('Salida: ' || t.origen_nombre || ' → ' || p_origen_nombre);
  end if;
  if t.destino_nombre is distinct from p_destino_nombre or t.destino_lat is distinct from p_destino_lat or t.destino_lng is distinct from p_destino_lng then
    v_changes := v_changes || ('Destino: ' || t.destino_nombre || ' → ' || p_destino_nombre);
  end if;
  if t.salida_at is distinct from p_salida_at then
    v_changes := v_changes || ('Hora de salida: ' || private.format_departure(t.salida_at) || ' → ' || private.format_departure(p_salida_at));
  end if;
  if t.precio is distinct from p_precio then
    v_changes := v_changes || ('Precio: ' || private.format_cop(t.precio) || ' → ' || private.format_cop(p_precio));
  end if;
  if t.cupos_totales is distinct from p_cupos_totales then
    v_changes := v_changes || ('Cupos: ' || t.cupos_totales || ' → ' || p_cupos_totales);
  end if;
  if t.vehicle_id is distinct from p_vehicle_id then
    select placa into v_old_plate from public.vehicles where id = t.vehicle_id;
    v_changes := v_changes || ('Vehículo: ' || coalesce(v_old_plate, 'anterior') || ' → ' || v_new_plate);
  end if;
  if t.descripcion is distinct from v_description then
    v_changes := v_changes || 'Descripción actualizada'::text;
  end if;

  if coalesce(array_length(v_changes, 1), 0) = 0 then
    return jsonb_build_object('changes', '[]'::jsonb, 'update_id', null, 'accepted', v_taken);
  end if;

  -- trips_before_update_schedule_trg revisa choques de horario al cambiar la salida.
  update public.trips set
    vehicle_id = p_vehicle_id,
    origen_nombre = trim(p_origen_nombre),
    origen_lat = p_origen_lat,
    origen_lng = p_origen_lng,
    destino_nombre = trim(p_destino_nombre),
    destino_lat = p_destino_lat,
    destino_lng = p_destino_lng,
    salida_at = p_salida_at,
    precio = p_precio,
    cupos_totales = p_cupos_totales,
    descripcion = v_description
  where id = t.id;

  insert into public.trip_updates (trip_id, changed_by, changes)
  values (t.id, auth.uid(), v_changes)
  returning id into v_update_id;

  return jsonb_build_object('changes', to_jsonb(v_changes), 'update_id', v_update_id, 'accepted', v_taken);
end $$;

revoke execute on function public.update_trip(uuid, uuid, text, double precision, double precision, text, double precision, double precision, timestamptz, numeric, smallint, text) from public, anon;
grant execute on function public.update_trip(uuid, uuid, text, double precision, double precision, text, double precision, double precision, timestamptz, numeric, smallint, text) to authenticated, service_role;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
