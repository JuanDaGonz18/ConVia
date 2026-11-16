-- =====================================================================
-- ConVía — documentos legales 1.4
--
-- La Política de Tratamiento de Datos suma el número de licencia de los
-- conductores, guardado solo como hash con clave para detectar cuentas
-- duplicadas (migraciones 047 y 048). LEGAL_VERSION en src/content/legal.ts
-- pasa a '1.4' en el mismo cambio (docs/OPERACION.md §8).
--
-- Efecto: accept_legal solo acepta '1.4'; quien aceptó 1.3 ve el modal de los
-- documentos nuevos al abrir la app. Los registros nuevos guardan 1.4. Las
-- funciones de IA siguen exigiendo 1.2 o posterior (MIN_LEGAL_VERSION en
-- supabase/functions/_shared/legal.ts): el cambio no toca esas funciones.
-- =====================================================================

create or replace function private.current_legal_version()
returns text language sql immutable set search_path = '' as $$ select '1.4' $$;
