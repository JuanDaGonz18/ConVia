# ConVía — Backend Supabase

Proyecto: **ConVía** · ref `hfnsgeunskbkapjavcao` · región Canada (Central) · plan Free
URL: `https://hfnsgeunskbkapjavcao.supabase.co`

Estado: las migraciones 1–7 están aplicadas (historial reparado el 2026-09-26). La 6 añade chat persistente y referencia facial privada; la 7 añade `expo_push_token` y `notifications_enabled` en `profiles`.

Edge Functions desplegadas: `notify` (push de solicitudes, respuestas y mensajes; los destinatarios se calculan en el servidor) y `delete-account` (borra archivos de Storage y el usuario con `auth.admin.deleteUser`; cascada al resto).

> Registro: **solo se aceptan correos de dominios en `institutions`**. Un correo de otro dominio hace fallar `signUp` con `DOMINIO_NO_PERMITIDO`, así que valida antes con `check_email_domain`. Para crear usuarios de prueba desde el dashboard, usa correos `@unisabana.edu.co`.

## Conectar la app

```bash
npx expo install @supabase/supabase-js react-native-url-polyfill expo-secure-store
cp .env.example .env   # pega la anon/publishable key (Supabase → Connect)
npx supabase gen types typescript --project-id hfnsgeunskbkapjavcao > src/lib/database.types.ts
```
El cliente está en `src/lib/supabase.ts` (sesión guardada en SecureStore).

## Modelo de datos

| Tabla | Para qué | Pantallas Figma |
|---|---|---|
| `institutions` | Dominios permitidos (`unisabana.edu.co`) | Regístrate, Correo institucional |
| `profiles` | 1:1 con `auth.users`: nombre, rol, institución, rating, estado de verificación | Perfil, headers, cards de conductor |
| `vehicles` | Placa, marca, color, puestos, foto | Registra tu carro, Editar vehículo |
| `trips` | Viaje del conductor: origen, destino, sector, salida, precio, cupos, estado | Home/Mis viajes conductor, Crear viaje, resultados del cliente |
| `trip_requests` | Punto solicitado por un pasajero + `qr_token` | Solicitudes, Puntos solicitados, QR, Aceptar/Cancelar |
| `trip_locations` | Posición en vivo del conductor + ETA a la próxima parada | Viaje en curso (mapa, "00:00") |
| `ratings` | Calificación 1–5 tras el viaje (recalcula `rating_avg`) | ★ 4.8 |
| `assistant_messages` | Chat con el asistente virtual | Chat |
| `recent_searches` | Búsquedas recientes | Búsqueda |
| `face_verifications` | Intentos de verificación facial (`purpose`, `template_kind`) | Verifica tu identidad |
| `face_templates` | Embeddings faciales: `selfie` (registro) y `license` (foto de la licencia). Ilegible por la API | — |
| `driver_profiles` | Permiso de conductor: estado, cuándo se registró la licencia y cuándo se verificó la identidad | Licencia de conducción |
| `messages` | Mensajes entre pasajeros y conductores del mismo viaje | Chat |
| vista `available_trips` | Viajes `por_empezar` + cupos libres + datos de conductor y carro | Home cliente |

Estados: viaje `por_empezar → en_curso → finalizado | cancelado`; solicitud `pendiente → aceptado | negado → abordado` (o `cancelado`); verificación `pendiente → procesando → verificado | fallido`.

## Cómo la usa la app

```ts
// Registro (el trigger crea el perfil y asigna la institución por dominio)
await supabase.rpc('check_email_domain', { p_email });              // "Dominio reconocido"
await supabase.auth.signUp({ email, password,
  options: { data: { nombre, rol: 'conductor', terms_accepted: true } } });

// Pasajero
await supabase.from('available_trips').select('*').order('salida_at');
await supabase.from('trip_requests').insert({ trip_id, passenger_id: uid, direccion, lat, lng });
await supabase.rpc('cancel_trip_request', { p_request_id });

// Conductor
await supabase.from('vehicles').insert({ driver_id: uid, placa: 'ABC123', marca, color, puestos });
await supabase.from('trips').insert({ driver_id: uid, vehicle_id, origen_nombre, destino_nombre, salida_at, precio, cupos_totales });
await supabase.rpc('respond_trip_request', { p_request_id, p_accept: true });
await supabase.rpc('start_trip', { p_trip_id });
await supabase.rpc('board_passenger', { p_qr_token });               // escáner QR
await supabase.from('trip_locations').upsert({ trip_id, lat, lng, eta_next_stop_seconds });
await supabase.rpc('finish_trip', { p_trip_id });

// Perfil
await supabase.rpc('switch_role', { p_rol: 'usuario' });

// Realtime (solicitudes nuevas / aceptadas, ubicación en vivo)
supabase.channel('trip').on('postgres_changes',
  { event: '*', schema: 'public', table: 'trip_requests', filter: `trip_id=eq.${tripId}` }, cb).subscribe();
```

## Reglas de seguridad (RLS)

- Cada usuario solo ve perfiles, vehículos y viajes **de su misma institución**.
- Solo un **conductor verificado** puede crear viajes; solo un usuario **verificado** puede pedir un punto.
- Los cambios de estado (aceptar, negar, abordar, empezar, terminar, cancelar, cambiar rol) **solo** van por RPC, que validan `auth.uid()`, cupos y estados. `rol`, `rating_*` y `verification_status` no se pueden editar directamente.
- Los cupos se limitan a los puestos del vehículo; no se acepta más gente que cupos.
- La ubicación en vivo solo la ven el conductor y sus pasajeros aceptados.
- `set_verification_result` solo lo puede llamar el backend (`service_role`), p. ej. una Edge Function del proveedor facial.

## Storage

| Bucket | Público | Ruta |
|---|---|---|
| `avatars` | sí | `avatars/<uid>/avatar.jpg` |
| `vehicle-photos` | sí | `vehicle-photos/<uid>/<placa>.jpg` |

Cada usuario solo puede escribir y listar su carpeta `<uid>/`. Las fotos públicas se muestran con `supabase.storage.from('avatars').getPublicUrl(path)` y nadie puede listar el bucket completo. Las selfies no se pueden borrar ni reemplazar desde la app.

Otras reglas: un pasajero puede volver a pedir un viaje si su solicitud anterior fue cancelada o negada (solo una activa a la vez). El chat no permite escribir mensajes como "asistente". Solo se puede calificar a alguien que haya estado en el mismo viaje finalizado.

## Auth

- Email + contraseña (proveedor por defecto).
- Site URL `convia://` · Redirect URLs `convia://**`, `exp://**` (Expo Go) y `https://juandagonz18.github.io/ConVia/**` (versión web). Configura `"scheme": "convia"` en `app.json`.
- Los enlaces de correo usan PKCE: vuelven como `convia://callback?code=…`. Si el enlace venció, Supabase manda el error en el fragmento (`#error_code=otp_expired`); `src/utils/authLink.ts` lo lee.


## Verificación facial (gratuita, en el dispositivo)

No usa servicios de pago ni sube fotos:

1. La app toma una selfie con `expo-camera`.
2. En el teléfono, ML Kit (`react-native-vision-camera-face-detector`) detecta el rostro y sus puntos (ojos, nariz, boca) y valida: un solo rostro, tamaño, ángulo, ojos abiertos, nitidez y luz.
3. El rostro se alinea a 112×112 y el modelo SFace (`assets/models/sface_int8.onnx`, ONNX Runtime) produce un embedding de 128 valores. La foto se borra.
4. `submit_face_embedding(p_embedding, p_purpose)` guarda el embedding la primera vez (`face_templates`, ilegible por la API) o lo compara en el servidor (similitud coseno ≥ **0.40**) y registra el intento en `face_verifications` (`provider = on_device_sface`).

Pedir cupo exige una verificación exitosa contra la selfie del registro en los últimos 10 minutos; aceptar pasajeros, una contra la foto de la licencia. Máximo 10 intentos cada 10 minutos. Para que un usuario vuelva a registrar su rostro, borra su fila `kind = 'selfie'` en `face_templates`.

## Identidad del conductor (foto de la licencia)

No hay integración con el RUNT ni con ninguna fuente oficial: **esto no valida que la licencia sea auténtica**, solo que quien usa la cuenta de conductor es la persona de la foto de la licencia.

1. El conductor toma o sube una foto de su licencia (`expo-image-picker`).
2. En el teléfono se busca el rostro del documento (mismo pipeline, modo `document`: 1600 px, rostro ≥ 90 px y ≤ 30 % del ancho, sin reflejos) y se calcula su embedding SFace. La foto se borra.
3. `submit_license_face(p_embedding)` guarda la plantilla `license` y deja el permiso en `pendiente`.
4. Una selfie con `submit_face_embedding(..., 'driver_identity')` se compara con esa plantilla (≥ 0.40). Si coincide, `driver_profiles.status = 'aprobado'` e `identity_verified_at = now()`. Una selfie casi idéntica a la licencia (≥ 0.87) se rechaza: suele ser una foto de la propia licencia.

Para suspender a un conductor: `update driver_profiles set status = 'suspendido' where user_id = '...'`.

El bucket `face-verifications` y la columna `profiles.face_reference_path` ya no se usan (el bucket se eliminó el 2026-09-26).

## Pendiente

- **Asistente virtual:** falta la Edge Function que responda (guarda las respuestas en `assistant_messages` con `autor = 'asistente'`).
- **Empresas:** agrega sus dominios con `insert into institutions (nombre, tipo, dominio) values (..., 'empresa', 'empresa.com');`
- **Security Advisor:** quedan avisos "SECURITY DEFINER callable" solo sobre las 9 RPC de la app. Son intencionales: cada una valida `auth.uid()`. Los helpers ya no aparecen porque se movieron a `private`.
