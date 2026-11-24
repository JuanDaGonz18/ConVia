-- =====================================================================
-- ConVía — documentos legales 1.6
--
-- Los Términos y la Política dejan de describir a ConVía como "proyecto
-- académico sin ánimo de lucro" y los Términos suman la promoción de
-- lanzamiento (2 meses de ConVía+ al registrarse hasta el 14 de febrero de
-- 2027). LEGAL_VERSION en src/content/legal.ts pasa a '1.6' en el mismo cambio.
--
-- Efecto: accept_legal solo acepta '1.6'; quien aceptó 1.5 ve el modal de los
-- documentos nuevos al abrir la app. Los registros nuevos guardan 1.6.
--
-- APLICARLA JUSTO DESPUÉS DE PUBLICAR LA WEB Y EL eas update CON LEGAL_VERSION
-- '1.6': una app que todavía envía '1.5' no podría aceptar los términos.
-- =====================================================================

create or replace function private.current_legal_version()
returns text language sql immutable set search_path = '' as $$ select '1.6' $$;
