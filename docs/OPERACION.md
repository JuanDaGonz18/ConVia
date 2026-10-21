# Operación de ConVía en el plan Free de Supabase

Guía para quien administra ConVía: límites del plan, revisión mensual de uso,
copias de seguridad, inicio de sesión con Microsoft y cuándo escalar.

> **Lo que este documento no afirma:** que el plan Free soporte 100 000
> usuarios activos al mes. No se ha medido. La capacidad real se conoce con la
> prueba de carga en staging (sección 6), no antes.

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
| Edge Functions | `notify` (avisos), `delete-account` | Las operaciones con RLS van directo a la API; `notify` se invoca solo tras acciones reales, y el envío programado solo llama a la función cuando hay algo pendiente (si no, no hay invocación). |
| CPU de la base de datos | Trabajos programados (`dispatch-pending-pushes` cada 5 min, `mark-unstarted-trips` cada 10 min, `generate-recurring-trips` cada hora) | Son lo que más tiempo de base de datos usa hoy (~22 ms por ejecución); está dentro de lo esperado. |
| Escrituras | Token de notificaciones | Se guarda solo cuando cambia (antes se escribía en cada apertura de la app). |

Red: cada petición tiene un tiempo máximo de 30 s; las lecturas (GET) se
reintentan hasta 2 veces con espera exponencial y aleatoria ante errores de
red o 502/503/504. Las escrituras y RPC nunca se reintentan solas, para no
crear ni cobrar nada dos veces (`src/lib/resilientFetch.ts`).

## 3. Revisión mensual (primer lunes de cada mes)

1. Reporte de la base de datos (solo lectura):
   ```bash
   npx supabase db query --linked -f supabase/admin/usage_report.sql
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
npx supabase db dump --linked --role-only -f backups/$(date +%F)/roles.sql
npx supabase db dump --linked             -f backups/$(date +%F)/schema.sql
npx supabase db dump --linked --data-only --use-copy -f backups/$(date +%F)/data.sql
```

- **Storage va aparte**: los archivos no están en el dump. Descargar los
  buckets desde el panel o con la CLI (`npx supabase storage cp -r ss:///avatars backups/<fecha>/avatars --experimental`, igual para `vehicle-photos`).
- **Datos personales:** cifrar antes de sacarlos del equipo
  (`gpg -c --cipher-algo AES256 data.sql`) y guardar en un lugar con acceso
  restringido (no en Git: `backups/` y `*.sql.gpg` están en `.gitignore`).
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

La app ya tiene el botón "Continuar con Microsoft" (oculto hasta activarlo) y
el servidor ya valida el tenant. Pasos manuales (no se pueden hacer desde el
código):

1. **Microsoft Entra (Azure Portal)** → App registrations → New registration.
   - Supported account types: *Accounts in any organizational directory (multitenant)*.
   - Redirect URI (Web): `https://hfnsgeunskbkapjavcao.supabase.co/auth/v1/callback`.
   - Certificates & secrets → New client secret (anotar el valor; vence).
   - Token configuration → Add optional claim → ID token → `email` y `xms_edov`.
   - API permissions: `openid`, `email`, `profile`, `offline_access` (Microsoft Graph, delegadas).
2. **Supabase** → Authentication → Sign In / Providers → Azure: activar,
   pegar Application (client) ID y el secreto. Dejar *Azure Tenant URL*
   vacío (multitenant): el control de tenants lo hace la base de datos.
   Authentication → URL Configuration → Redirect URLs: agregar `convia://callback`.
3. **Autorizar cada institución** (solo administradores, SQL):
   ```sql
   insert into public.institution_identity_providers (provider, tenant_id, institution_id)
   select 'azure', '<directory-tenant-id-en-minúsculas>', id from public.institutions where dominio = 'unisabana.edu.co';
   ```
   El tenant ID de la universidad lo da su área de TI (Entra → Overview →
   Tenant ID).
4. **Consentimiento de administrador:** muchas universidades no permiten que
   cada estudiante autorice apps externas. Su administrador de Entra debe dar
   *admin consent* a la app (Enterprise applications → ConVía → Permissions →
   Grant admin consent). Sin eso, Microsoft muestra "Se necesita aprobación
   del administrador" y la app explica que se pida a TI. No asumir que una
   universidad aprobó la app.
5. **Activar en la app**: `EXPO_PUBLIC_MICROSOFT_AUTH=true` en el entorno de
   EAS (preview/production) y generar un APK nuevo. El secreto de Microsoft
   **nunca** va a la app ni al repositorio; solo vive en Supabase.
6. **Verificar con una cuenta real** antes de anunciarlo: que entra, que el
   perfil queda con el nombre, que una cuenta personal (outlook.com) y una de
   otro tenant son rechazadas, y que en `auth.identities` el campo
   `identity_data` trae `custom_claims.tid` o `iss` (el servidor rechaza si no
   encuentra el tenant).

Reglas del servidor (migración 27): una identidad de Azure solo se acepta si
su tenant está en `institution_identity_providers` y el correo es del dominio
de esa institución. Esto también protege el enlace automático de Supabase
(que une cuentas con el mismo correo): una cuenta de otro tenant con un
correo `@unisabana.edu.co` es rechazada, no unida. Los usuarios existentes
con correo y contraseña conservan su id y sus datos; si entran con Microsoft
desde su tenant autorizado, Supabase agrega la identidad a la misma cuenta.

## 6. Prueba de carga (staging, datos sintéticos)

Nunca contra producción (el script se niega).

1. Crear un proyecto Free de staging, aplicar las migraciones
   (`npx supabase db push` con ese proyecto) y una institución de prueba.
2. Generar cuentas y datos sintéticos: 500 usuarios, 50 conductores
   aprobados, 300 viajes abiertos con rutas reales de la zona, 2 000
   solicitudes, 10 000 mensajes.
3. Escenario 1 — búsqueda (`scripts/loadtest/convia.k6.js`): inicio de
   sesión, lista de viajes, solicitudes y plan; 20 → 100 → 200 usuarios
   virtuales. Metas: p95 < 800 ms en `available_trips`, < 1 % de errores.
4. Escenario 2 — escritura: publicar viajes, pedir cupo y aceptar en paralelo
   sobre los mismos viajes (comprueba que no se sobrevenden cupos).
5. Escenario 3 — chat: 200 conexiones Realtime simultáneas a 50 viajes,
   1 mensaje cada 10 s por persona; medir latencia y mensajes de Realtime.
6. Registrar CPU y RAM de la base (panel → Reports), egress por usuario y por
   búsqueda, y extrapolar a MAU con datos reales de uso (búsquedas por usuario
   al día del reporte mensual), no con supuestos.

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
