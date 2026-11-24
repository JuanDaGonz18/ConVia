-- =====================================================================
-- ConVía — índices para las llaves foráneas sin índice
--
-- El asesor de rendimiento de Supabase (unindexed_foreign_keys) marcó 14
-- llaves foráneas sin índice. Sin él, los JOIN y los borrados en cascada
-- recorren la tabla completa; con más usuarios eso se nota. Solo agrega
-- índices: no cambia datos ni permisos.
-- =====================================================================

create index if not exists agent_runs_confirmed_request_idx on public.agent_runs (confirmed_request_id);
create index if not exists institution_identity_providers_institution_idx on public.institution_identity_providers (institution_id);
create index if not exists institution_memberships_institution_idx on public.institution_memberships (institution_id);
create index if not exists institution_requests_institution_idx on public.institution_requests (institution_id);
create index if not exists messages_sender_idx on public.messages (sender_id);
create index if not exists pickup_verifications_driver_idx on public.pickup_verifications (driver_id);
create index if not exists recurring_trips_institution_idx on public.recurring_trips (institution_id);
create index if not exists recurring_trips_vehicle_idx on public.recurring_trips (vehicle_id);
create index if not exists student_id_checks_institution_idx on public.student_id_checks (institution_id);
create index if not exists subscriptions_tier_idx on public.subscriptions (tier);
create index if not exists trip_alert_hits_route_idx on public.trip_alert_hits (route_id);
create index if not exists trip_alert_hits_trip_idx on public.trip_alert_hits (trip_id);
create index if not exists trip_updates_changed_by_idx on public.trip_updates (changed_by);
create index if not exists user_preferences_recogida_place_idx on public.user_preferences (recogida_place_id);
