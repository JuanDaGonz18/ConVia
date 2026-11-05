-- ConVía — Verificación del vehículo con IA (Edge Function verify-vehicle)
--
-- Cada intento queda registrado aquí. Solo la Edge Function (service_role)
-- escribe: el conductor puede editar su fila de `vehicles`, así que el
-- resultado no puede vivir allí sin que pueda marcarse "verificado" solo.
--
-- Una verificación vale mientras la placa del vehículo siga siendo
-- `plate_expected`: si el conductor cambia la placa, debe verificar de nuevo.
-- Las caras nunca pasan por aquí: la verificación facial sigue en el teléfono.

create table public.vehicle_verifications (
  id               uuid primary key default gen_random_uuid(),
  vehicle_id       uuid not null references public.vehicles(id) on delete cascade,
  driver_id        uuid not null references public.profiles(id) on delete cascade,
  status           text not null check (status in ('verified', 'failed', 'retry')),
  reason           text not null,
  message          text not null,
  plate_expected   text not null,
  plate_read       text,
  confidence       real check (confidence between 0 and 1),
  brand_read       text,
  line_read        text,
  color_read       text,
  image_quality    text check (image_quality in ('good', 'fair', 'poor')),
  brand_match      boolean,
  color_match      boolean,
  mock             boolean not null default false,
  created_at       timestamptz not null default now()
);
create index vehicle_verifications_vehicle_idx on public.vehicle_verifications(vehicle_id, created_at desc);
create index vehicle_verifications_driver_idx on public.vehicle_verifications(driver_id, created_at desc);

alter table public.vehicle_verifications enable row level security;

-- El conductor ve sus propios intentos; nadie más (ni él) puede escribir.
grant select on public.vehicle_verifications to authenticated;
grant all on public.vehicle_verifications to service_role;
create policy "vehicle_verifications_read_own" on public.vehicle_verifications
  for select to authenticated using (driver_id = (select auth.uid()));
