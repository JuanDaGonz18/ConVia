# Operación de ConVía en el plan Free de Supabase

Guía para quien administra ConVía: límites del plan, revisión mensual de uso,
copias de seguridad, inicio de sesión con Microsoft, funciones de IA y
trabajos programados (sección 8), revisión manual (sección 9) y cuándo escalar.

> **Lo que este documento no afirma:** que el plan Free soporte 100 000
> usuarios activos al mes. No se ha medido. La capacidad real se conoce con la
> prueba de carga en staging (sección 6), no antes.

> **Supabase CLI v3:** los comandos apuntan a la base local por defecto. Para
> el proyecto enlazado se agrega `--remote` al final (reemplaza `--linked`,
> `--project-ref` y `--db-url`). Todo cambio en el proyecto alojado
> (`db push`, `functions deploy`, `secrets set/unset`, `db query` sin
> `--read-only`…) pide confirmación; `--yes` solo en CI. `secrets unset` sin
> nombres ya no borra todo (es `secrets unset --all`).

## 1. Límites del plan Free

Tomados de <https://supabase.com/pricing> el 2026-10-21. Revisarlos cada
trimestre: Supabase los cambia.

| Recurso | Free | Uso de ConVía (2026-10-21) |
| --- | --- | --- |
| Base de datos | 500 MB (CPU compartida, 500 MB RAM) | 15,8 MB |
| Archivos (Storage) | 1 GB · máx. 50 MB por archivo | 9,2 MB (7 archivos) |
| Egress | 5 GB + 5 GB de egress en caché | ver panel |
| Usuarios activos al mes (MAU) | 50 000 | 6 |
| Edge Functions | 500 000 invocaciones | ver panel |
| Realtime | 200 conexiones simultáneas · 2 millones de mensajes · 256 KB por mensaje | ver panel |
| Pausa | el proyecto se pausa tras 1 semana sin actividad | — |
| Copias de seguridad | **no incluidas** (ni automáticas ni PITR) | sección 4 |
| Logs | 1 día de retención | — |
| Proyectos | 2 activos | — |

No se agrega tráfico artificial para evitar la pausa. Si el proyecto se
pausa, se reanuda desde el panel (Project → Restore); los datos se conservan.

## 2. Qué consume cada parte de ConVía

| Recurso | Qué lo usa | Qué se hizo para reducirlo |
| --- | --- | --- |
| Egress | Lista de viajes (`available_trips`, con la ruta de cada viaje), fotos | Ruta pública de máx. 120 puntos y 5 decimales (migración 28); fotos redimensionadas antes de subirlas (avatar 512 px, vehículo 1280 px, JPEG 70 %). Las respuestas JSON viajan comprimidas (gzip). |
| Storage | Avatares y fotos de vehículos | Fotos de unos cientos de KB en vez de 2–3 MB; límites por bucket (avatares 3 MB, vehículos 4 MB) y solo JPG/PNG/WebP; un único archivo por usuario o vehículo (se reemplaza); al eliminar la cuenta se borran sus archivos. |
| Base de datos | Viajes, solicitudes, mensajes, calificaciones, historial de `pg_cron` | Limpieza diaria: historial de `pg_cron` > 7 días y alertas de viajes que salieron hace > 30 días (migración 27). |
| Realtime | Chat del viaje, QR de abordaje, solicitudes, estado de conductor | Solo se publican las 3 tablas que la app escucha; cada pantalla se suscribe al abrirse y se desuscribe al cerrarse; el pasajero filtra sus solicitudes por su id; varios cambios seguidos recargan una sola vez. |
| Edge Functions | `notify` (avisos), `delete-account` y las funciones de IA (sección 8) | Las operaciones con RLS van directo a la API; `notify` se invoca solo tras acciones reales, y el envío programado solo llama a la función cuando hay algo pendiente (si no, no hay invocación). |
| CPU de la base de datos | Trabajos programados (`dispatch-pending-pushes` cada 5 min, `mark-unstarted-trips` cada 10 min, `generate-recurring-trips` cada hora) | Son lo que más tiempo de base de datos usa hoy (~22 ms por ejecución); está dentro de lo esperado. |
| Escrituras | Token de notificaciones | Se guarda solo cuando cambia (antes se escribía en cada apertura de la app). |

Red: cada petición tiene un tiempo máximo de 30 s; las lecturas (GET) se
reintentan hasta 2 veces con espera exponencial y aleatoria ante errores de
red o 502/503/504. Las escrituras y RPC nunca se reintentan solas, para no
crear ni cobrar nada dos veces (`src/lib/resilientFetch.ts`).

## 3. Revisión mensual (primer lunes de cada mes)

1. Reporte de la base de datos (solo lectura):
   ```bash
   npx supabase db query --read-only -f supabase/admin/usage_report.sql --remote
   ```
   Tamaño de la base, tablas más grandes, archivos por bucket, archivos
   huérfanos, usuarios activos en 30 días, crecimiento de viajes, solicitudes
   y mensajes, trabajos programados fallidos y consultas más costosas.
2. Panel de Supabase → Organization → **Usage**: egress, invocaciones de Edge
   Functions, mensajes y conexiones pico de Realtime, MAU.
3. Panel → **Advisors** (Security y Performance) y **Logs** (errores de Auth y
   de la API del último día; el plan Free guarda 1 día).
4. Anotar los valores en la tabla de seguimiento del equipo y comparar con los
   umbrales:

| Recurso | 50 % (vigilar) | 70 % (planear) | 85 % (actuar) |
| --- | --- | --- | --- |
| Base de datos (500 MB) | 250 MB | 350 MB | 425 MB |
| Storage (1 GB) | 500 MB | 700 MB | 850 MB |
| Egress (5 GB/mes) | 2,5 GB | 3,5 GB | 4,25 GB |
| MAU (50 000) | 25 000 | 35 000 | 42 500 |
| Edge Functions (500 000/mes) | 250 000 | 350 000 | 425 000 |
| Realtime: conexiones pico (200) | 100 | 140 | 170 |
| Realtime: mensajes (2 M/mes) | 1 M | 1,4 M | 1,7 M |

- **Vigilar:** revisar qué creció y si es esperado.
- **Planear:** aplicar la palanca correspondiente de la sección 7 y presupuestar el plan Pro.
- **Actuar:** pasar a Pro antes de llegar al 100 % (al superar las cuotas del plan Free, Supabase puede restringir el proyecto).

La app nunca lee métricas de facturación: el reporte y el panel son tareas
de administración.

### Archivos huérfanos

El reporte cuenta archivos cuyo usuario ya no existe y fotos de vehículo que
ningún vehículo usa. No se borran solos. Para revisarlos:

```sql
select bucket_id, name, (metadata->>'size')::bigint / 1024 as kb, created_at
  from storage.objects o
 where (o.bucket_id in ('avatars','vehicle-photos')
        and not exists (select 1 from auth.users u where u.id::text = (storage.foldername(o.name))[1]))
    or (o.bucket_id = 'vehicle-photos'
        and not exists (select 1 from public.vehicles v where v.foto_url like '%' || o.name || '%'));
```

Antes de borrar: confirmar que no hay una verificación o un reclamo abierto
que necesite la foto. Se borran desde el panel (Storage) o con la API de
Storage; no con `delete from storage.objects`, que deja el archivo físico.

## 4. Copias de seguridad (manuales en el plan Free)

El plan Free **no** hace copias automáticas. Hacer una copia semanal y antes
de cada migración.

```bash
mkdir -p backups/$(date +%F)
npx supabase db dump --role-only -f backups/$(date +%F)/roles.sql --remote
npx supabase db dump -f backups/$(date +%F)/schema.sql --remote
npx supabase db dump --data-only --use-copy -f backups/$(date +%F)/data.sql --remote
```

- **Storage va aparte**: los archivos no están en el dump. Descargar los
  buckets desde el panel o con la CLI (`npx supabase storage cp -r ss:///avatars backups/<fecha>/avatars --experimental --remote`, igual para `vehicle-photos`).
- **Datos personales:** no dejar la carpeta sin cifrar. El formato vigente
  (desde el 2026-11-04) es **un archivo por copia**, `backups/<fecha>.tar.gpg`:
  un `tar` de la carpeta de la fecha, cifrado con contraseña (simétrico,
  AES-256, derivación de clave SHA-512):
  ```bash
  F=$(date +%F)
  tar -cf - -C backups "$F" | gpg -c --cipher-algo AES256 --s2k-digest-algo SHA512 -o "backups/$F.tar.gpg"
  gpg -d "backups/$F.tar.gpg" | tar -tf -   # comprobar que se descifra y lista los archivos
  rm -rf "backups/$F"                       # solo después de la comprobación anterior
  ```
  La contraseña se guarda en el gestor de contraseñas del administrador, nunca
  junto al archivo ni en el repositorio. Guardar el `.tar.gpg` en un lugar con
  acceso restringido (no en Git: `backups/` y `*.sql.gpg` están en `.gitignore`).
- **Restaurar desde un `.tar.gpg`:** descifrar en una carpeta temporal fuera
  del repositorio, revisar el contenido, seguir la prueba de restauración de
  abajo y borrar la carpeta al terminar.
  ```bash
  mkdir -p /tmp/convia-restore
  gpg -d backups/<fecha>.tar.gpg | tar -xf - -C /tmp/convia-restore
  ls /tmp/convia-restore/<fecha>   # roles.sql, schema.sql, data.sql (+ buckets si se descargaron)
  ```
- **Retención:** 4 copias semanales y 3 mensuales; borrar las más antiguas.
  Si una persona elimina su cuenta, sus datos desaparecen de las copias
  cuando estas se rotan (máx. 3 meses); documentarlo en la política de datos.
- **Probar la restauración cada trimestre** en un entorno aislado, nunca en
  producción: un proyecto Free de staging o `npx supabase start` (Docker).
  ```bash
  psql "$STAGING_DB_URL" -f roles.sql
  psql "$STAGING_DB_URL" -f schema.sql
  psql "$STAGING_DB_URL" -c "SET session_replication_role = replica" -f data.sql
  ```
  Luego correr las pruebas de `supabase/tests/` contra staging.

## 5. Inicio de sesión con Microsoft (Entra ID)

El botón "Continuar con Microsoft" (login) y "Crear cuenta con Microsoft"
(registro) están en la app, ocultos hasta activarlos. El servidor valida el
tenant y el dominio. Todo esto cuesta $0: Entra ID Free y Supabase Free.

### Estado (2026-10-21)

| Pieza | Valor | Estado |
| --- | --- | --- |
| App en Entra (directorio de gonzalezjuandavid07@gmail.com) | **ConVía** · Client ID `c434c61f-1d89-49bf-9f1e-f814575c1177` · multitenant | ✅ |
| Redirect URI (Web) | `https://hfnsgeunskbkapjavcao.supabase.co/auth/v1/callback` | ✅ |
| Claims opcionales del ID token | `email`, `xms_edov` | ✅ |
| Permisos delegados de Microsoft Graph | `openid`, `email`, `profile`, `offline_access`, `User.Read` | ✅ |
| Secreto de cliente | 24 meses; **renovarlo antes de que venza** (abajo) | ✅ |
| Supabase → Providers → Azure | activado, *Azure Tenant URL* vacío | ✅ |
| Supabase → Redirect URLs | `https://juandagonz18.github.io/ConVia/**`, `convia://**` | ✅ |
| Tenant autorizado: Universidad de La Sabana | `aca51631-00fe-490d-91ab-163ef87260ee` | ✅ |
| *Admin consent* de TI de La Sabana | — | ⏳ pendiente |
| Botón activado en web y APK | — | ⏳ después del consentimiento |

### Consentimiento del administrador (obligatorio)

Microsoft no deja que los usuarios de otra organización acepten una app
multitenant nueva sin *editor verificado*. Un administrador de Entra de la
universidad debe abrir este enlace y aceptar (solo inicio de sesión, nombre
y correo; no lee correos ni archivos):

```
https://login.microsoftonline.com/<tenant-id>/adminconsent?client_id=c434c61f-1d89-49bf-9f1e-f814575c1177
```

La Sabana: `<tenant-id>` = `aca51631-00fe-490d-91ab-163ef87260ee`. Sin
eso, Microsoft muestra "Se necesita aprobación del administrador" y la app
explica que se pida a TI.

### Activar el botón

1. **Web:** GitHub → repo → Settings → Secrets and variables → Actions →
   pestaña *Variables* → New repository variable `MICROSOFT_AUTH` = `true`.
   Luego Actions → *Sitio web (GitHub Pages)* → *Run workflow* (o cualquier
   push). Para apagarlo, cambia la variable a `false`.
2. **APK:** `EXPO_PUBLIC_MICROSOFT_AUTH=true` en el entorno de EAS
   (`npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_MICROSOFT_AUTH --value true --visibility plaintext`)
   y en tu `.env`; compilar y publicar un APK nuevo.

La web va a Microsoft en la misma pestaña y vuelve a `/app/callback?via=microsoft`
(Safari bloquea las ventanas emergentes); el APK usa el navegador del sistema y
vuelve por `convia://callback`. `domain_hint` lleva directo al inicio de
sesión de la institución (`EXPO_PUBLIC_MICROSOFT_DOMAIN_HINT`, por defecto
`unisabana.edu.co`).

### Agregar otra institución

1. Su dominio en `public.institutions`.
2. Su tenant ID: `https://login.microsoftonline.com/<dominio>/v2.0/.well-known/openid-configuration`
   → el GUID dentro de `issuer`.
3. SQL (solo administradores):
   ```sql
   insert into public.institution_identity_providers (provider, tenant_id, institution_id)
   select 'azure', '<tenant-id-en-minúsculas>', id from public.institutions where dominio = '<dominio>';
   ```
4. Pedir el *admin consent* con el enlace de arriba y su tenant ID.

### Renovar el secreto

Entra → ConVía → Certificados y secretos → nuevo secreto → pegar el **Valor**
en Supabase → Providers → Azure → *Save* → borrar el secreto viejo. Hacerlo
antes de que venza: si vence, nadie puede entrar con Microsoft.

### Verificar con una cuenta real antes de anunciarlo

Que entra y el perfil queda con el nombre; que una cuenta personal
(outlook.com) y una de otro tenant son rechazadas; y que en `auth.identities`
el campo `identity_data` trae `custom_claims.tid` o `iss` (el servidor
rechaza si no encuentra el tenant). Probar en Safari (iPhone) y en el APK.

### Reglas del servidor (migración 27)

Una identidad de Azure solo se acepta si su tenant está en
`institution_identity_providers` y el correo es del dominio de esa
institución. Esto también protege el enlace automático de Supabase (que une
cuentas con el mismo correo): una cuenta de otro tenant con un correo
`@unisabana.edu.co` es rechazada, no unida. Los usuarios existentes con
correo y contraseña conservan su id y sus datos; si entran con Microsoft
desde su tenant autorizado, Supabase agrega la identidad a la misma cuenta.
El secreto de Microsoft **nunca** va a la app ni al repositorio; solo vive en
Supabase.

## 6. Prueba de carga (stack local, datos sintéticos)

Nunca contra el proyecto alojado: el workflow levanta Supabase **local** en el
runner, no usa secretos y `k6-peak.js` se niega a correr contra otra URL.

### Procedimiento

1. GitHub → Actions → **Perf** → *Run workflow*, con `vus` = 50, 100, 200 y
   300. Cada carga tiene su propio grupo de concurrencia, así que se pueden
   lanzar las cuatro a la vez (~15 min).
2. El workflow hace `supabase start` + `db reset`, siembra
   `scripts/perf/seed.sql` (5 instituciones, 2 000 usuarios, 5 000 viajes
   futuros con ruta de 80 puntos, 20 000 solicitudes, 30 000 mensajes), corre
   `EXPLAIN (ANALYZE, BUFFERS)` de las rutas calientes y luego
   `scripts/perf/k6-peak.js`: rampa de 2 min, 7 min sostenidos, 1 min de bajada.
   Pasajeros y conductores hacen las mismas consultas que la app
   (buscar → detalle → pedir cupo → mis solicitudes → cancelar → chat → plan).
3. Metas (umbrales de k6): **p95 < 500 ms** y **< 1 % de errores** en todas las
   peticiones. Si no se cumplen, la corrida termina en rojo; los números siguen
   en el artefacto `perf-k6-summary-<vus>` (`k6-summary.json`,
   `top-queries.txt` de `pg_stat_statements`, EXPLAIN antes/después).
4. Leer `http_req_duration` p(95) y `http_req_failed` del resumen, y en
   `top-queries.txt` qué consulta se lleva el tiempo de la base.

Límite del método: base, PostgREST, Kong y k6 comparten un runner de 4 vCPU,
así que los valores absolutos son pesimistas frente a un proyecto alojado. Sirven
para comparar cargas y cambios entre sí, no como capacidad de producción.

### Resultados (2026-11-11, `main` en b97f4c1)

| Usuarios virtuales | p95 (todas) | Mediana | Errores | p95 búsqueda | Tiempo de la base en `available_trips` |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 50  | 7,7 s  | 1,0 s  | 0,99 % | 10,4 s | 95 % (3,7 s por llamada) |
| 100 | 11,1 s | 8,2 s  | 35 %   | 14,6 s | 96 % (6,2 s por llamada) |
| 200 | 10,4 s | 10,0 s | 78 %   | 15,5 s | 63 % (la mayoría de las peticiones no llegó a la base) |
| 300 | 10,0 s | 10,0 s | 76 %   | 13,0 s | 95 % (6,2 s por llamada) |

Corridas: [50](https://github.com/JuanDaGonz18/ConVia/actions/runs/43083830667),
[100](https://github.com/JuanDaGonz18/ConVia/actions/runs/43083836753),
[200](https://github.com/JuanDaGonz18/ConVia/actions/runs/43083842377),
[300](https://github.com/JuanDaGonz18/ConVia/actions/runs/43083848444).
Desde 100 usuarios casi todos los errores son peticiones que se cortan a los
~10 s (por eso p95 y mediana se quedan en 10 s).

**Ninguna carga cumple las metas.** Con 50 usuarios los errores quedan justo por
debajo del 1 %, pero el p95 es 15 veces la meta. Incluso sin carga no se
alcanzaría: en el EXPLAIN, una sola búsqueda en la base ya tarda ~1,0 s.

### Dónde se va el tiempo

La búsqueda: `available_trips` devuelve **todos** los viajes abiertos de la
institución (~1 000 en el seed) con su ruta completa, en cada búsqueda. Con 50
usuarios se recibieron 1,9 GB en 10 min, ≈ 2,4 MB por búsqueda (cota
superior: el resto de respuestas son pequeñas). La app repite esa búsqueda
entera en Inicio, Viajes y Mapa.

El detalle de un viaje cuesta lo mismo que la lista: la vista envuelve la
función `private.available_trip_rows()` (SECURITY DEFINER, sin parámetros), así
que filtros como `id = …` o `driver_id <> …` se aplican **después** de calcular
todas las filas. En el EXPLAIN, el detalle de un solo viaje tarda 1,08 s, frente
a 1,02 s de la lista completa. Entre las dos se llevan el 95 % del tiempo de la
base; la siguiente consulta (`driver_trip_requests`, ~0,9 s) es el 4 %.

### Arreglo previsto (pendiente, no implementado)

1. **Filtrar en el servidor**: RPC de búsqueda con parámetros (zona/destino,
   franja horaria) que filtre dentro de la función, con índice
   `(institution_id, estado, salida_at)`, en vez de filtrar después de la vista.
2. **Paginar**: devolver 20–30 viajes por página, ordenados por `salida_at`, y
   **sin la ruta** en la lista; la ruta solo se pide al abrir el mapa o el
   detalle.
3. **RPC de un solo viaje** (`get_available_trip(p_trip_id)`) para el detalle
   y las alertas (`getAvailableTripsByIds`), que lea únicamente esa fila.
4. Después, revisar `driver_trip_requests` (~0,9 s por llamada con 50 usuarios).

Al terminar cada paso: volver a correr las cuatro cargas y reemplazar esta tabla.

Sin medir todavía: escrituras concurrentes sobre los mismos cupos y 200
conexiones Realtime al chat (`scripts/loadtest/convia.k6.js` cubre parte de esto
contra un proyecto de staging).

## 7. Plan de escalamiento (por orden)

| Señal medida | Acción |
| --- | --- |
| Egress > 70 % del mes | Revisar la búsqueda: paginar `available_trips` por zona/horario, cachear 30–60 s la lista en el teléfono, servir fotos con transformaciones de imagen (Pro). |
| p95 de `available_trips` > 800 ms o CPU > 70 % sostenida | Analizar el plan de la consulta con datos reales (`explain analyze`), índices por `(institution_id, estado, salida_at)`; pasar trabajos programados a menor frecuencia. |
| Base de datos > 350 MB | Archivar mensajes de viajes finalizados hace > 6 meses (con política de retención aprobada), revisar tablas con `usage_report.sql`. |
| Conexiones Realtime pico > 140 | Suscribirse al chat solo con la pantalla abierta (ya se hace); si no alcanza, plan Pro (cuota de conexiones mayor; ver precios vigentes). |
| MAU > 35 000, o cualquier recurso al 85 % | **Plan Pro** (cuotas mayores, sin pausas por inactividad y copias automáticas; confirmar condiciones vigentes en la página de precios). |
| Necesidad de copias automáticas o restaurar a un punto en el tiempo | Plan Pro + PITR. |
| > 200 000 MAU o varias universidades grandes | Medir de nuevo; considerar instancia de cómputo mayor y réplicas de lectura. |

Sin las pruebas de carga y la medición mensual no hay base para afirmar una
capacidad; esta tabla se ajusta con esos datos.

## 8. Funciones de IA, secretos y trabajos programados

Estado verificado en producción (`hfnsgeunskbkapjavcao`) el 2026-11-06:
migraciones hasta la 039 aplicadas, las 8 funciones activas y los trabajos
de abajo con su última ejecución correcta.

### Edge Functions

Todas tienen `verify_jwt = true` (`supabase/config.toml`; `match-agent` no
tiene entrada y usa el valor por defecto, también `true`).

| Función | Quién la llama | Qué hace | Plan |
| --- | --- | --- | --- |
| `notify` | app (JWT) y `dispatch-pending-pushes` (`x-convia-cron`) | avisos push; anti-replay con `notified_events` | todos |
| `delete-account` | app (JWT) | elimina la cuenta y sus archivos | todos |
| `verify-vehicle` | app (JWT) | SAM 3.1 + Muse Spark 1.3: la foto muestra el carro registrado (placa, marca, color). La foto se borra al terminar | gratis |
| `suggest-vehicle` | app (JWT) | Muse Spark propone marca, línea, color y placa desde una foto; no guarda nada | ConVía+ (`vehicle_autofill`) |
| `verify-pickup` | app (JWT) y `cleanup-pickup-clips` (`x-convia-cron`) | clip de ≤ 2 s del carro que llega; va inline al modelo (sin Files API) y se borra de Storage al terminar | gratis, con límite mensual |
| `verify-student-id` | app (JWT) | carné (recortes sin rostro) o carné sin foto + captura → Muse Spark; los casos dudosos y los de documento van a revisión manual | gratis |
| `card-review-cleanup` | solo `cleanup-card-review-files` (`x-convia-cron`) | borra las imágenes de revisión de carné de más de 7 días; rechaza cualquier otra llamada | — |
| `match-agent` | app (JWT) | asistente de viajes: Muse Spark con herramientas (lee con la sesión del usuario, RLS) y una segunda llamada que juzga la propuesta | ConVía+ (`trip_assistant`) |

Sin `MODEL_API_KEY` las funciones de IA responden 503 `MODEL_UNAVAILABLE`.
Las cinco funciones de IA exigen además que la persona haya aceptado los
documentos legales 1.2 o posteriores (`profiles.accepted_legal_version`,
migración 040); si no, responden 403 `LEGAL_OUTDATED` y la app muestra el
modal para aceptarlos. Al publicar una versión legal nueva, seguir el
encabezado de esa migración.

**Regla:** cualquier cambio de `LEGAL_VERSION` en `src/content/legal.ts` necesita,
en el mismo PR, una migración que suba `private.current_legal_version()` a esa
versión; las funciones de IA exigen esa versión.

### Secretos de las funciones (`npx supabase secrets list`)

| Secreto | Uso | Producción |
| --- | --- | --- |
| `MODEL_API_KEY` | clave de la Meta Model API para todas las funciones de IA | obligatorio |
| `CRON_SECRET` | encabezado `x-convia-cron` de los trabajos programados; igual a `convia_cron_secret` del Vault | obligatorio |
| `MODEL_API_BASE_URL` | por defecto `https://api.meta.ai/v1` | opcional |
| `ALLOW_MOCK` | respuestas simuladas sin clave | **nunca en producción** (solo local o staging) |
| `VERIFY_VEHICLE_MAX_PER_DAY`, `PICKUP_*`, `STUDENT_ID_MAX_PER_DAY`, `AGENT_RUNS_PER_DAY` | ver «Límites de IA» | opcionales |

Plantilla: `supabase/functions/.env.example`. Se cambian con
`npx supabase secrets set NOMBRE=valor`. `secrets list` solo muestra nombres y
hashes; nunca imprimir ni pegar valores.

**Créditos gratuitos de Meta:** deben seguir **desactivados** en la cuenta de
la Meta Model API que emite la `MODEL_API_KEY` de producción. Revisarlo en la
consola de Meta en la revisión mensual y cada vez que se rote la clave.

### Secretos del Vault (base de datos)

Los usan los trabajos programados que llaman a funciones con `pg_net`. Sin
ellos el trabajo no hace nada (no falla).

| Nombre | Contenido |
| --- | --- |
| `convia_project_url` | URL del proyecto (`https://<ref>.supabase.co`) |
| `convia_anon_key` | clave anon (para pasar `verify_jwt`) |
| `convia_cron_secret` | el mismo valor que `CRON_SECRET` |

Si se rota `CRON_SECRET`, cambiar los dos a la vez (secreto de funciones y Vault).

### Trabajos programados (`pg_cron`)

| Trabajo | Horario (UTC) | Qué hace | Migración |
| --- | --- | --- | --- |
| `dispatch-pending-pushes` | cada 5 min | llama a `notify` (`sweep`) solo si hay avisos pendientes | 025 |
| `mark-unstarted-trips` | cada 10 min | marca los viajes que no arrancaron | 015 |
| `generate-recurring-trips` | `7 * * * *` | crea los viajes recurrentes | 025 |
| `cleanup-logs` | `17 3 * * *` | historial de `pg_cron` de más de 7 días | 027 |
| `cleanup-alert-hits` | `23 3 * * *` | alertas de viajes viejos | 027 |
| `cleanup-notified-events` | `29 3 * * *` | anti-replay de `notify` de más de 30 días | 030 |
| `cleanup-vehicle-suggestions` | `31 3 * * *` | contador de `suggest-vehicle` de más de 1 día | 032 |
| `cleanup-pickup-clips` | cada 30 min | clips de recogida de más de 1 hora (vía `verify-pickup`) | 033 |
| `cleanup-card-review-files` | `41 3 * * *` | imágenes de revisión de carné de más de 7 días (vía `card-review-cleanup`) | 038 |
| `admin-review-alerts` | `0 12,22 * * *` | si hay carnés o instituciones por revisar, encola un aviso por administrador (máx. uno al día); lo envía `dispatch-pending-pushes` | 041 |

En el repositorio del hackathon, `cleanup-notified-events` y
`cleanup-vehicle-suggestions` eran un solo trabajo, `cleanup-function-guards`;
aquí no existe con ese nombre.

Comprobar (solo lectura):
```sql
select j.jobname, j.active, r.status, r.start_time
  from cron.job j
  left join lateral (select * from cron.job_run_details d where d.jobid = j.jobid
                     order by start_time desc limit 1) r on true
 order by 1;
-- respuesta HTTP de los trabajos que llaman a funciones (pg_net la guarda pocas horas):
select status_code, count(*), max(created) from net._http_response group by 1;
```
No incluir `cron.job.command` en reportes que se compartan.

### Límites de IA

| Función | Límite | Variable |
| --- | --- | --- |
| `verify-vehicle` | 10 intentos por conductor por hora y 20 en 24 h | `VERIFY_VEHICLE_MAX_PER_DAY` (el de 1 h es fijo) |
| `verify-pickup` | plan: `pickup_verifications_month` (Gratis 10 al mes, ConVía+ sin tope; la beta no lo relaja); además 6 por solicitud, 30 por pasajero en 24 h y 1 000 en total en 24 h | `PICKUP_MAX_ATTEMPTS`, `PICKUP_MAX_PER_USER_DAY`, `PICKUP_MAX_TOTAL_DAY` |
| `verify-student-id` | 5 por usuario al día | `STUDENT_ID_MAX_PER_DAY` |
| `suggest-vehicle` | 20 por usuario por hora (contador en la base, entre instancias) | fijo |
| `match-agent` | 30 ejecuciones por usuario al día | `AGENT_RUNS_PER_DAY` |

Cada intento real cuesta llamadas al modelo: subir un límite es una decisión
de costo. Revisar el consumo en la consola de Meta en la revisión mensual.

## 9. Revisión manual

Los carnés que la IA no pudo confirmar (y los documentos sin foto) quedan en
revisión (`institution_memberships.status = 'review'`); las solicitudes de
«Mi institución no aparece» quedan `pendiente`. Se deciden desde la terminal
con `scripts/admin/review-cli.mjs`, nunca desde la app.

### Configuración (una vez)

Copiar `scripts/admin/.env.review.example` a `scripts/admin/.env.review.local`
(está en `.gitignore`, fuera del bundle de la app) y llenar:

| Variable | Valor |
| --- | --- |
| `SUPABASE_URL` | URL del proyecto a revisar (`http://127.0.0.1:54321` para el stack local) |
| `SUPABASE_SERVICE_ROLE_KEY` | Dashboard → Project Settings → API Keys → clave secreta (`service_role`) |

Esa clave salta RLS: nunca va en el `.env` de la app, ni en un chat, ni en
un commit. La herramienta solo muestra el host del proyecto, nunca la clave.

### Comandos

| Comando | Qué hace | Teclas |
| --- | --- | --- |
| `npm run review` | carnés en revisión, el más antiguo primero; abre un enlace de 5 min a las imágenes | `a` aprobar · `r` rechazar (elige motivo `1` unclear, `2` mismatch, `3` not_student, `c` cancelar) · `s` saltar · `q` salir |
| `npm run review -- --institutions` | solicitudes de institución | `a` aprobar (crea la institución y sus dominios) · `m` unir a una existente · `r` rechazar con motivo · `s` saltar · `q` salir |
| `npm run review -- --count` | cuántos carnés y solicitudes hay pendientes | — |
| `npm run review -- --user <user_id>` | solo esa persona (con `--institutions`, su solicitud) | las mismas |

Aprobar o unir vuelve a revisar el correo de quien pidió la institución: si es
de ese dominio, queda verificado de inmediato.

### Imágenes de revisión (7 días)

Las imágenes que se guardan para revisar un carné (recortes sin rostro, o el
documento sin foto + la captura) están en
`face-verifications/<user_id>/student-card-review-*.jpg`. Se borran al aprobar
o rechazar, cuando la persona vuelve a intentarlo, al eliminar la cuenta y, en
todo caso, a los **7 días** (`cleanup-card-review-files` → `card-review-cleanup`,
migración 038). Pasados 7 días sin decidir, el caso sigue en revisión pero ya
sin imágenes.

### Aviso a los administradores

A las 12:00 y 22:00 UTC (07:00 y 17:00 en Bogotá), si hay algo pendiente, cada
administrador recibe un push: «ConVía: N carnés y M instituciones por revisar».
Como máximo uno por persona y día (la corrida de las 22:00 solo avisa si la de
las 12:00 no lo hizo); si los dos conteos son 0 no se envía nada. El texto solo
lleva los conteos, sin nombres ni imágenes. Usa la misma ruta que los demás
avisos (`notify`, secretos del Vault de la sección 8): $0 adicional. El
administrador necesita una cuenta en la app con las notificaciones activadas.

Agregar un administrador (SQL editor del Dashboard, con el `user_id` de su
cuenta en Authentication → Users):

```sql
insert into private.admins (user_id) values ('<user_id>');
-- quitarlo:
delete from private.admins where user_id = '<user_id>';
-- ver quiénes son:
select a.user_id, u.email from private.admins a join auth.users u on u.id = a.user_id;
```

`private.admins` solo es accesible con `service_role` o desde el SQL editor;
la app no puede leerla ni escribirla.
