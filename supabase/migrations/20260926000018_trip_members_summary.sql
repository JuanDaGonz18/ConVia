-- =====================================================================
-- ConVía — integrantes del viaje, cierre y resumen
--  * trip_members(): conductor, origen, destino y pasajeros aceptados de un
--    viaje. Solo lo pueden consultar el conductor y los pasajeros aceptados.
--  * Pago por pasajero (pagó / no pagó, sin monto) y calificación con
--    comentario opcional, desde el resumen de un viaje finalizado.
--  * cancel_trip() también cancela viajes en curso y finish_trip()/
--    cancel_trip() dejan en trip_updates a quién avisar (función notify).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Pago y registro de avisos
-- ---------------------------------------------------------------------
alter table public.trip_requests
  add column pago text check (pago in ('pagado', 'no_pagado')),
  add column pago_marcado_at timestamptz;

alter table public.trip_updates
  add column kind text not null default 'edited' check (kind in ('edited', 'cancelled', 'finished')),
  -- Pasajeros a notificar; null = los aceptados en ese momento (ediciones).
  add column recipients uuid[];

-- Las calificaciones se pueden corregir: el promedio se recalcula también al actualizar.
drop trigger if exists ratings_refresh on public.ratings;
create trigger ratings_refresh
  after insert or update of score on public.ratings
  for each row execute function public.refresh_rating();

-- ---------------------------------------------------------------------
-- 2. Cancelar y finalizar
-- ---------------------------------------------------------------------
drop function if exists public.cancel_trip(uuid);
create or replace function public.cancel_trip(p_trip_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.trips;
  v_affected uuid[];
  v_update_id uuid;
begin
  select * into t from public.trips where id = p_trip_id and driver_id = auth.uid() for update;
  if not found or t.estado not in ('por_empezar', 'en_curso') then
    raise exception 'No se puede cancelar este viaje';
  end if;

  -- Se puede cancelar aunque haya cupos reservados: se avisa a todos los afectados.
  select coalesce(array_agg(passenger_id), '{}') into v_affected
    from public.trip_requests
   where trip_id = t.id and estado in ('pendiente', 'aceptado', 'abordado');

  update public.trips set estado = 'cancelado' where id = t.id;
  update public.trip_requests set estado = 'cancelado'
   where trip_id = t.id and estado in ('pendiente', 'aceptado', 'abordado');
  delete from public.trip_locations where trip_id = t.id;

  insert into public.trip_updates (trip_id, changed_by, changes, kind, recipients)
  values (t.id, auth.uid(), array['El conductor canceló el viaje'], 'cancelled', v_affected)
  returning id into v_update_id;

  return jsonb_build_object('update_id', v_update_id, 'notified', coalesce(array_length(v_affected, 1), 0));
end $$;

drop function if exists public.finish_trip(uuid);
create or replace function public.finish_trip(p_trip_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.trips;
  v_passengers uuid[];
  v_update_id uuid;
begin
  update public.trips set estado = 'finalizado', finished_at = now()
   where id = p_trip_id and driver_id = auth.uid() and estado = 'en_curso'
  returning * into t;
  if t.id is null then raise exception 'No se puede terminar este viaje'; end if;
  delete from public.trip_locations where trip_id = p_trip_id;

  select coalesce(array_agg(passenger_id), '{}') into v_passengers
    from public.trip_requests
   where trip_id = t.id and estado in ('aceptado', 'abordado');

  insert into public.trip_updates (trip_id, changed_by, changes, kind, recipients)
  values (t.id, auth.uid(), array['El viaje terminó'], 'finished', v_passengers)
  returning id into v_update_id;

  return jsonb_build_object('update_id', v_update_id, 'notified', coalesce(array_length(v_passengers, 1), 0));
end $$;

-- ---------------------------------------------------------------------
-- 3. Integrantes del viaje
-- ---------------------------------------------------------------------
create or replace function public.trip_members(p_trip_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  t public.trips;
  v_is_driver boolean;
  v_cancel_recipients uuid[];
  v_result jsonb;
begin
  select * into t from public.trips where id = p_trip_id;
  if not found then raise exception 'Viaje no encontrado'; end if;
  v_is_driver := t.driver_id = v_user;
  -- Solo el conductor y los pasajeros aceptados (o que abordaron).
  if not v_is_driver and not private.is_trip_participant(t.id, v_user) then
    raise exception 'Solo los integrantes del viaje pueden ver esta información';
  end if;

  -- En un viaje cancelado, los pasajeros que tenía son los que se avisaron.
  if t.estado = 'cancelado' then
    select recipients into v_cancel_recipients from public.trip_updates
     where trip_id = t.id and kind = 'cancelled' order by created_at desc limit 1;
  end if;

  select jsonb_build_object(
    'viewer_is_driver', v_is_driver,
    'trip', jsonb_build_object(
      'id', t.id,
      'origen_nombre', t.origen_nombre, 'origen_lat', t.origen_lat, 'origen_lng', t.origen_lng,
      'destino_nombre', t.destino_nombre, 'destino_lat', t.destino_lat, 'destino_lng', t.destino_lng,
      'salida_at', t.salida_at, 'started_at', t.started_at, 'finished_at', t.finished_at,
      'estado', t.estado, 'precio', t.precio, 'cupos_totales', t.cupos_totales,
      'descripcion', t.descripcion, 'ruta', t.ruta,
      'vehicle', (select jsonb_build_object('marca', v.marca, 'color', v.color, 'placa', v.placa, 'foto_url', v.foto_url)
                    from public.vehicles v where v.id = t.vehicle_id)
    ),
    'driver', (select jsonb_build_object('id', p.id, 'nombre', p.nombre, 'avatar_url', p.avatar_url,
                                         'rating', p.rating_driver_avg, 'rating_count', p.rating_driver_count)
                 from public.profiles p where p.id = t.driver_id),
    'passengers', coalesce((
      select jsonb_agg(jsonb_build_object(
          'request_id', r.id,
          'id', p.id,
          'nombre', p.nombre,
          'avatar_url', p.avatar_url,
          'rating', p.rating_passenger_avg,
          'rating_count', p.rating_passenger_count,
          'estado', r.estado,
          'es_yo', p.id = v_user,
          -- Datos que solo necesita el conductor.
          'direccion', case when v_is_driver or p.id = v_user then r.direccion end,
          'pago', case when v_is_driver then r.pago end,
          'mi_calificacion', case when v_is_driver then (
            select jsonb_build_object('score', rt.score, 'comentario', rt.comentario)
              from public.ratings rt
             where rt.trip_id = t.id and rt.rater_id = v_user and rt.rated_id = p.id) end
        ) order by p.nombre)
        from public.trip_requests r
        join public.profiles p on p.id = r.passenger_id
       where r.trip_id = t.id
         and (r.estado in ('aceptado', 'abordado')
              or (t.estado = 'cancelado' and r.passenger_id = any(coalesce(v_cancel_recipients, '{}'))
                  and r.estado = 'cancelado'))
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

-- ---------------------------------------------------------------------
-- 4. Resumen de un viaje finalizado: pago y calificación de pasajeros
-- ---------------------------------------------------------------------
create or replace function private.finished_trip_request(p_request_id uuid)
returns public.trip_requests language plpgsql stable security definer set search_path = '' as $$
declare r public.trip_requests;
begin
  select req.* into r
    from public.trip_requests req
    join public.trips t on t.id = req.trip_id
   where req.id = p_request_id
     and t.driver_id = auth.uid()
     and t.estado = 'finalizado'
     and req.estado in ('aceptado', 'abordado');
  if r.id is null then raise exception 'Solo puedes revisar pasajeros de tus viajes finalizados'; end if;
  return r;
end $$;

create or replace function public.set_passenger_payment(p_request_id uuid, p_paid boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.finished_trip_request(p_request_id);
  update public.trip_requests
     set pago = case when p_paid then 'pagado' else 'no_pagado' end,
         pago_marcado_at = now()
   where id = p_request_id;
end $$;

create or replace function public.rate_trip_passenger(p_request_id uuid, p_score smallint, p_comment text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.trip_requests;
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
begin
  r := private.finished_trip_request(p_request_id);
  if p_score is null or p_score < 1 or p_score > 5 then raise exception 'La calificación debe ser de 1 a 5'; end if;
  if char_length(coalesce(v_comment, '')) > 500 then raise exception 'El comentario es muy largo (máximo 500 caracteres)'; end if;
  insert into public.ratings (trip_id, rater_id, rated_id, score, comentario)
  values (r.trip_id, auth.uid(), r.passenger_id, p_score, v_comment)
  on conflict (trip_id, rater_id, rated_id)
  do update set score = excluded.score, comentario = excluded.comentario;
end $$;

revoke execute on function public.cancel_trip(uuid) from public, anon;
revoke execute on function public.finish_trip(uuid) from public, anon;
revoke execute on function public.trip_members(uuid) from public, anon;
revoke execute on function public.set_passenger_payment(uuid, boolean) from public, anon;
revoke execute on function public.rate_trip_passenger(uuid, smallint, text) from public, anon;
grant execute on function public.cancel_trip(uuid) to authenticated, service_role;
grant execute on function public.finish_trip(uuid) to authenticated, service_role;
grant execute on function public.trip_members(uuid) to authenticated, service_role;
grant execute on function public.set_passenger_payment(uuid, boolean) to authenticated, service_role;
grant execute on function public.rate_trip_passenger(uuid, smallint, text) to authenticated, service_role;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
