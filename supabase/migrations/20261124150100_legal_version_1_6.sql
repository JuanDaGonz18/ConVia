-- =====================================================================
-- ConVía — documentos legales 1.6 (antes preparada como 1.4; renumerada
-- porque main ya publicó 1.4 (licencia) y 1.5 (Google))
--
-- Términos: ConVía+ de pago (precio en COP con impuestos, transferencia con
-- referencia, activación en máximo 24 horas hábiles, sin renovación
-- automática, cancelación en cualquier momento y retracto de 5 días hábiles
-- con reembolso total, Ley 1480 de 2011 art. 47), identificación del
-- vendedor y aviso de que ya no se entra con Microsoft. Se quita "sin ánimo de
-- lucro". Política de datos: datos de pago y comprobantes, finalidad y
-- plazos (registros 5 años, comprobantes 30 días). LEGAL_VERSION en
-- src/content/legal.ts pasa a '1.6' en el mismo cambio (docs/OPERACION.md §8).
--
-- Efecto: accept_legal solo acepta '1.6'; quien aceptó 1.5 o antes ve el modal de los
-- documentos nuevos al abrir la app. Las funciones de IA siguen exigiendo
-- 1.2 o posterior (MIN_LEGAL_VERSION): el cambio no las toca.
-- =====================================================================

create or replace function private.current_legal_version()
returns text language sql immutable set search_path = '' as $$ select '1.6' $$;
