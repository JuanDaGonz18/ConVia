-- =====================================================================
-- ConVía — calificar solo si el pasajero abordó (QR escaneado)
--
-- Antes, un pasajero aceptado cuyo QR nunca se escaneó podía calificar al
-- conductor y ser calificado al finalizar el viaje. Ahora:
--  * rate_trip_driver y rate_trip_passenger exigen trip_requests.estado =
--    'abordado'. Sin QR el viaje no cuenta como realizado.
--  * finish_trip solo avisa "Toca para calificar" a quienes abordaron.
-- Marcar pago (set_passenger_payment) no cambia.
-- =====================================================================

create or replace function public.rate_trip_driver(p_trip_id uuid, p_score smallint, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.trips;
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
begin
  select * into t from public.trips where id = p_trip_id;
  if t.id is null
     or t.estado <> 'finalizado'
     or not exists (select 1 from public.trip_requests r
                     where r.trip_id = t.id and r.passenger_id = auth.uid()
                       and r.estado = 'abordado') then
    raise exception 'Solo puedes calificar al conductor de un viaje finalizado en el que se escaneó tu QR de abordaje';
  end if;
  if p_score is null or p_score < 1 or p_score > 5 then raise exception 'La calificación debe ser de 1 a 5'; end if;
  if char_length(coalesce(v_comment, '')) > 500 then raise exception 'El comentario es muy largo (máximo 500 caracteres)'; end if;
  if exists (select 1 from public.ratings
              where trip_id = t.id and rater_id = auth.uid() and rated_id = t.driver_id) then
    raise exception 'Ya calificaste al conductor de este viaje';
  end if;

  insert into public.ratings (trip_id, rater_id, rated_id, score, comentario)
  values (t.id, auth.uid(), t.driver_id, p_score, v_comment);
end $$;

create or replace function public.rate_trip_passenger(p_request_id uuid, p_score smallint, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.trip_requests;
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
begin
  r := private.finished_trip_request(p_request_id);
  if r.estado <> 'abordado' then
    raise exception 'Este pasajero no abordó (su QR no se escaneó): no se puede calificar';
  end if;
  if p_score is null or p_score < 1 or p_score > 5 then raise exception 'La calificación debe ser de 1 a 5'; end if;
  if char_length(coalesce(v_comment, '')) > 500 then raise exception 'El comentario es muy largo (máximo 500 caracteres)'; end if;
  insert into public.ratings (trip_id, rater_id, rated_id, score, comentario)
  values (r.trip_id, auth.uid(), r.passenger_id, p_score, v_comment)
  on conflict (trip_id, rater_id, rated_id)
  do update set score = excluded.score, comentario = excluded.comentario;
end $$;

create or replace function public.finish_trip(p_trip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  -- Solo quienes abordaron reciben el aviso para calificar.
  select coalesce(array_agg(passenger_id), '{}') into v_passengers
    from public.trip_requests
   where trip_id = t.id and estado = 'abordado';

  insert into public.trip_updates (trip_id, changed_by, changes, kind, recipients)
  values (t.id, auth.uid(), array['El viaje terminó'], 'finished', v_passengers)
  returning id into v_update_id;

  return jsonb_build_object('update_id', v_update_id, 'notified', coalesce(array_length(v_passengers, 1), 0));
end $$;
