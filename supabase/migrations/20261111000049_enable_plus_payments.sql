-- =====================================================================
-- ConVía — lanzamiento de ConVía+ por transferencia (migración 047)
--
-- Enciende el interruptor. La llave Bre-B y el titular NO están en el
-- repositorio: mientras sigan en NULL la app sigue mostrando "Muy pronto"
-- (get_plus_payment_info → enabled = false; start_plus_payment →
-- PAYMENTS_NOT_CONFIGURED). Se ponen en producción con el SQL de
-- docs/LANZAR_PLUS.md, paso 3.
--
-- Apagar de nuevo (sin perder solicitudes ni suscripciones):
--   update public.app_config set payments_enabled = false where id;
-- =====================================================================

update public.app_config set payments_enabled = true where id;
