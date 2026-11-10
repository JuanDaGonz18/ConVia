-- =====================================================================
-- ConVía — documentos legales 1.3
--
-- La Política de Tratamiento de Datos suma los datos de diagnóstico y uso
-- (client_errors, app_events) y los reportes de "Reportar un problema" con su
-- captura, con sus plazos (migración 045). LEGAL_VERSION en src/content/legal.ts
-- pasa a '1.3' en el mismo cambio (docs/OPERACION.md §8).
--
-- Efecto: accept_legal solo acepta '1.3'; quien aceptó 1.2 ve el modal de los
-- documentos nuevos al abrir la app. Los registros nuevos guardan 1.3. Las
-- funciones de IA siguen exigiendo 1.2 o posterior (MIN_LEGAL_VERSION en
-- supabase/functions/_shared/legal.ts): el cambio no toca esas funciones.
-- =====================================================================

create or replace function private.current_legal_version()
returns text language sql immutable set search_path = '' as $$ select '1.3' $$;
