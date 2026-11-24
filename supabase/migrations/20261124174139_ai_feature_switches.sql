-- =====================================================================
-- ConVía — interruptor por función de IA
--
-- app_config.ai_features lista las funciones de IA encendidas. Las Edge
-- Functions responden 503 MODEL_UNAVAILABLE (sin llamar al modelo) a las que
-- no estén, y la app oculta sus botones. Valores:
--   student_card, vehicle_verify, vehicle_suggest, pickup_verify, assistant
-- Arranca solo con el carné. Para encender otra:
--   update public.app_config set ai_features = ai_features || '{vehicle_verify}' where id;
-- =====================================================================

alter table public.app_config
  add column if not exists ai_features text[] not null
    default '{student_card,vehicle_verify,vehicle_suggest,pickup_verify,assistant}';

update public.app_config set ai_features = '{student_card}' where id;

grant select (ai_features) on public.app_config to authenticated;
