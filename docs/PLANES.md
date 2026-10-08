# Planes: FREE, ConVía+ y modo beta

Guía para desarrolladores. Todo lo que define qué puede hacer cada usuario está en
**dos lugares que deben coincidir** (un test falla si no coinciden):

| Qué | Base de datos (fuente de verdad) | App (espejo, textos y respaldo) |
| --- | --- | --- |
| Catálogo de capacidades | tabla `plan_capabilities` | `CAPABILITIES` en `src/subscription/plans.ts` |
| Límites por plan | `plans.limits` | `PLAN_LIMITS` en `src/subscription/plans.ts` |
| Modo beta | `app_config.beta_mode` | (lo lee del servidor; `FALLBACK_BETA_MODE` solo antes de cargar) |
| Plan de cada usuario | `subscriptions` (sin fila = FREE) | lo lee del servidor |

`get_my_plan()` resuelve todo para el usuario actual: plan real, capacidades
efectivas, límites efectivos, límites del plan y si hay beta. La app lo carga con
`SubscriptionSync` y lo expone con `usePlan()`.

## Cómo se decide

- **Capacidad** (`private.has_capability(user, key)`): la tiene si es `free`, si el
  usuario tiene ConVía+ vigente, o si hay beta y la capacidad está marcada
  `beta_unlocked`.
- **Límite** (`private.plan_limit(user, key)`): con beta se aplican a todos los
  límites de ConVía+ (relajados, no infinitos); sin beta, los del plan real.
  Clave ausente = sin límite.
- **Plan real** (`private.effective_tier`): ConVía+ solo si está `active`/`trialing`
  y no ha vencido. Si vence, el usuario vuelve a FREE automáticamente.

## Modo beta

Hoy `beta_mode = true`:

- FREE usa casi todo: varios vehículos, repetir viajes, viajes recurrentes,
  alertas de viajes, filtros y preferencias avanzadas, estadísticas, todos los
  resultados compatibles, más lugares, rutas guardadas y favoritos.
- **La beta no abre** lo que es una ventaja frente a otros usuarios o lo que
  queremos probar por plan: Google Maps, tráfico, prioridad en solicitudes,
  distintivo y perfil destacado. Eso sigue dependiendo del plan real, así que
  FREE sigue probando MapLibre y ConVía+ sigue probando Google.
- En la app, lo que un usuario FREE tiene solo por la beta lleva una marca
  discreta "ConVía+" (`usePlan().isBetaPerk(...)`), sin ventanas de venta.

### Terminar la beta

Una sola línea en el editor SQL de Supabase:

```sql
update public.app_config set beta_mode = false;
```

No hay que cambiar pantallas, servicios ni funciones: desde ese momento el
servidor aplica los límites FREE y la app los muestra. Lo que un usuario creó
durante la beta (por ejemplo, un segundo vehículo) se conserva; solo no puede
agregar más por encima del límite.

## Modelo comercial objetivo

| | FREE | ConVía+ |
| --- | --- | --- |
| Buscar, pedir y publicar viajes, chat, QR, verificación, calificaciones, historial | ✓ | ✓ |
| Mapa | MapLibre (OpenStreetMap) | Google Maps + tráfico |
| Vehículos | 1 | 10 |
| Lugares guardados | 3 | 20 |
| Conductores favoritos | 10 | sin límite |
| Rutas guardadas | 1 | 10 |
| Viajes compatibles visibles | 5 | todos |
| Repetir viaje | – | ✓ |
| Viajes recurrentes (horario semanal) | – | ✓ |
| Alertas de viajes compatibles | – | ✓ |
| Filtros avanzados | – (solo horario: pronto, hoy, mañana) | ✓ |
| Preferencias avanzadas | – | ✓ |
| Estadísticas de pasajero y de conductor | – | ✓ |
| Prioridad entre solicitudes igual de compatibles | – | ✓ |
| Distintivo y perfil destacado (aro azul en la foto) | – | ✓ |

Todas las capacidades del catálogo están construidas (`implemented: true`; un test
lo verifica).

La prioridad ConVía+ **nunca** pasa por encima de la compatibilidad: solo
desempata entre solicitudes o viajes del mismo nivel (ver `tripMatching.ts` y
`respond_trip_request`).

## Qué hace cumplir el servidor y qué es solo de la app

**Servidor (no se puede saltar modificando la app):**
- quién es ConVía+ y hasta cuándo (`subscriptions` no se puede escribir desde la app);
- límites de vehículos, lugares guardados, rutas guardadas y favoritos (triggers con `plan_limit`);
- viajes recurrentes: crear o reanudar un horario exige `recurring_trips`, y sin
  la capacidad el servidor deja de publicar sus viajes (el horario queda en pausa);
- alertas: activarlas exige `smart_match_alerts`, y el servidor solo alerta a quien la tiene;
- estadísticas: `my_trip_stats()` solo devuelve cada sección con su capacidad;
- prioridad ConVía+ al aceptar solicitudes y su orden;
- la configuración (`app_config`, `plan_capabilities`, `plans`) solo la cambia un administrador.

El servidor responde `CAPACIDAD_PLAN:<clave>` cuando falta una capacidad y
`LIMITE_PLAN:<clave>:<límite>` cuando se llega a un límite; la app los convierte
en mensajes (`src/utils/format.ts`).

**Solo en la app** (comodidades sin datos privados de por medio):
- proveedor de mapa y tráfico (el SDK de Google habla directo con Google; la
  protección es la restricción de la clave en Google Cloud);
- cuántos viajes compatibles se muestran (`visible_results`);
- el botón "Repetir viaje" (repetir equivale a crear un viaje nuevo, que FREE ya puede hacer);
- filtros avanzados y preferencias (solo acotan u ordenan lo que la compatibilidad ya eligió).

## Agregar una capacidad ConVía+

1. Nueva migración: `insert into public.plan_capabilities (key, tier, beta_unlocked, description) values (...)`.
2. Agregarla a `CAPABILITIES` en `src/subscription/plans.ts` con el mismo `tier` y `betaUnlocked`, y su texto.
3. Usarla con `usePlan().can('<clave>')`; si no la tiene, `requirePlus({ capability: '<clave>' })`
   explica la función. Si guarda datos o da ventaja a otros, revisarla también en el
   servidor con `private.has_capability(auth.uid(), '<clave>')`.
4. `npm test` comprueba que el catálogo de la app y el de la migración coinciden.

Para un límite nuevo: agregarlo a `plans.limits` (migración) y a `PLAN_LIMITS` y
`LIMIT_INFO`, y aplicarlo en un trigger con `private.plan_limit(user, '<clave>')`.

## Activar ConVía+ a mano (pruebas)

```sql
insert into public.subscriptions (user_id, tier, status, provider, current_period_end)
select id, 'plus', 'active', 'manual', null from public.profiles where email = 'alguien@unisabana.edu.co'
on conflict (user_id) do update set tier = 'plus', status = 'active', provider = 'manual', current_period_end = null;
-- Volver a FREE: update public.subscriptions set status = 'canceled' where user_id = '<uuid>';
```

## Pruebas

- `npm test`: catálogo, límites, beta y paridad app ↔ migración (`src/subscription/plans.test.ts`).
- `npx supabase db query --linked -f supabase/tests/plan_capabilities_test.sql`: beta activa y
  terminada, ConVía+, vencimiento y que nadie se dé ConVía+ ni cambie la configuración.
- `npx supabase db query --linked -f supabase/tests/planned_features_test.sql`: cada función
  ConVía+ con beta y sin ella (horarios, alertas, rutas, estadísticas).
