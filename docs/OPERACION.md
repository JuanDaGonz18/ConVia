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
