-- =====================================================================
-- ConVía — documentos legales 1.5
--
-- La Política de Tratamiento de Datos suma el inicio de sesión con Google:
-- qué datos comparte Google (nombre, correo e identificador de la cuenta) y
-- Google como encargado también para la autenticación. LEGAL_VERSION en
-- src/content/legal.ts pasa a '1.5' en el mismo cambio (docs/OPERACION.md §8).
--
-- Efecto: accept_legal solo acepta '1.5'; quien aceptó 1.4 ve el modal de los
-- documentos nuevos al abrir la app. Los registros nuevos guardan 1.5. Las
-- funciones de IA siguen exigiendo 1.2 o posterior.
--
-- APLICARLA SOLO CUANDO LA WEB Y EL APK CON LEGAL_VERSION '1.5' ESTÉN
-- PUBLICADOS: una app que todavía envía '1.4' no podría aceptar los términos.
-- =====================================================================

create or replace function private.current_legal_version()
returns text language sql immutable set search_path = '' as $$ select '1.5' $$;
