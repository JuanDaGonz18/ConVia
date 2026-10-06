-- =====================================================================
-- ConVía — verificación de licencia SIMULADA (solo pruebas)
-- No existe integración con el RUNT ni con ninguna fuente oficial. Para
-- desarrollo, una licencia enviada con datos válidos se aprueba 10 segundos
-- después, y queda anotado que fue una simulación.
-- Para producción: cambia private.license_simulation_enabled() a false y
-- aprueba manualmente (driver_profiles.status = 'aprobado').
-- =====================================================================

create or replace function private.license_simulation_enabled()
returns boolean language sql immutable set search_path = '' as $$ select true $$;

create or replace function public.complete_simulated_license_check()
returns public.driver_profiles language plpgsql security definer set search_path = '' as $$
declare d public.driver_profiles;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not private.license_simulation_enabled() then
    raise exception 'La verificación automática está desactivada; un administrador revisará tu licencia';
  end if;

  select * into d from public.driver_profiles where user_id = auth.uid() for update;
  if not found or d.license_number is null or d.submitted_at is null then
    raise exception 'Primero envía los datos de tu licencia';
  end if;
  if d.status <> 'pendiente' then
    return d;  -- ya resuelta (aprobada, rechazada o suspendida)
  end if;
  if d.license_expires_on <= current_date then
    raise exception 'La licencia está vencida';
  end if;
  -- El servidor impone la espera; la app no puede saltársela.
  if d.submitted_at > now() - interval '10 seconds' then
    raise exception 'VERIFICACION_EN_CURSO';
  end if;

  update public.driver_profiles
     set status = 'aprobado',
         reviewed_at = now(),
         review_notes = 'Verificación simulada (entorno de pruebas): no se consultó el RUNT ni ninguna fuente oficial.'
   where user_id = auth.uid()
  returning * into d;
  return d;
end $$;

revoke execute on function public.complete_simulated_license_check() from public, anon;
grant execute on function public.complete_simulated_license_check() to authenticated, service_role;
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
