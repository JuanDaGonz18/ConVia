-- =====================================================================
-- ConVía — documentos legales 1.7
--
-- La Política de Tratamiento de Datos suma los correos de ConVía (bienvenida
-- con consejos y confirmación del primer pago de ConVía+) y a Brevo como
-- encargado del envío de correos. LEGAL_VERSION en src/content/legal.ts pasa
-- a '1.7' en el mismo cambio.
--
-- APLICARLA JUSTO DESPUÉS DE PUBLICAR LA WEB Y EL eas update CON LEGAL_VERSION
-- '1.7': una app que todavía envía '1.6' no podría aceptar los términos.
-- =====================================================================

create or replace function private.current_legal_version()
returns text language sql immutable set search_path = '' as $$ select '1.7' $$;
