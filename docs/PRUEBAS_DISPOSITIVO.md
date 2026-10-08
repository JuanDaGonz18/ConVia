# Pruebas en dispositivo — APK preview

Usa siempre el APK preview más reciente (Expo → proyecto → Builds, perfil `preview`).
Anota en cada prueba el commit del build que probaste.

Lo que ya está verificado automáticamente y contra el Supabase real (permisos, privacidad
en la base de datos, organizaciones, prioridad, autenticación) **no** dice nada de cómo se
comporta el teléfono. Esta lista cubre solo lo que exige un dispositivo. Marca cada punto
con ✅ / ❌ y anota el teléfono y la cuenta usada.

## Preparación

| Qué | Para qué |
| --- | --- |
| **Teléfono A** y **teléfono B** (Android, con Google Play Services) | Casi todo el flujo pasajero ↔ conductor necesita dos dispositivos |
| Cuenta **Conductor** `@unisabana.edu.co` | Debe completar la verificación de licencia en el teléfono (rostro + foto de la licencia) |
| Cuenta **Pasajero FREE** `@unisabana.edu.co` | Selfie de registro en el teléfono |
| Cuenta **Pasajero ConVía+** `@unisabana.edu.co` | Activar ConVía+ con el SQL del README principal |
| Desinstalar cualquier versión anterior | El APK anterior no puede iniciar sesión con el backend actual, y una versión de desarrollo con otra firma impide instalar este APK |

Conectado por USB, estos comandos ayudan a ver lo que no se ve en pantalla:

```bash
adb install -r app-preview.apk
# Cierres inesperados y errores de JavaScript:
adb logcat -s ReactNativeJS:V AndroidRuntime:E
# ¿Se inicializó Google Maps? (no debe aparecer con una cuenta FREE):
adb logcat | grep -i -E "Google Android Maps SDK|MapsInitializer|AirMapRenderer"
```

## 1. Autenticación (un teléfono)

- [ ] **Registro:** formulario vacío → cada campo en rojo con su mensaje debajo; los textos de ejemplo no parecen datos reales.
- [ ] **Registro:** correo de otro dominio → "Usa el correo de tu institución…".
- [ ] **Registro completo** → entra directo (no pide confirmar correo) y muestra el nombre en Inicio.
- [ ] **Perfil:** nombre, correo, teléfono (si se puso) y estado de verificación correctos.
- [ ] **Cerrar la app** (quitarla de recientes) y abrir → sigue con la sesión.
- [ ] **Cerrar sesión** → vuelve al login; **entrar de nuevo** → perfil correcto.
- [ ] **Cambiar contraseña** (Perfil → Información personal) → cerrar sesión → entra con la nueva; la anterior falla.
- [ ] No existe "¿Olvidaste tu contraseña?" (decisión previa; no es un error).

## 2. Pasajero (teléfono A = pasajero, B = conductor con viajes publicados)

Antes, desde B, publicar estos viajes desde la universidad: uno a **Cota**, uno a **Siberia pasando por Cota** (elegir una ruta que pase por Cota), uno a **Chía** y uno a **Bogotá**.

- [ ] Inicio sin destino ni lugares guardados → "¿A dónde vas?", no lista todos los viajes de la universidad.
- [ ] Buscar destino **Cota** → aparece "Desde" con la ubicación actual; los chips de horario funcionan.
- [ ] Resultados: Cota ("Muy compatible", "Va a tu destino") y Siberia ("Pasa a … de tu destino"); **no** aparecen Chía ni Bogotá.
- [ ] "Lo antes posible" / "Mañana" filtran por horario; si no hay nada, el mensaje lo explica.
- [ ] Más de 5 resultados → "Ver más viajes compatibles".
- [ ] Detalle del viaje: placa **enmascarada** (`A••••3`), dirección de salida **sin número de casa**, distintivo ConVía+ del conductor si lo tiene.
- [ ] Pedir cupo: sin punto de recogida → error en el campo; "Dónde te bajas" viene lleno con Cota.
- [ ] La verificación facial del pasajero se pide y funciona (cámara frontal).
- [ ] **B (conductor)** ve la solicitud: recogida **sin número de casa**, "Se baja en: Cota", nivel de compatibilidad.
- [ ] B acepta → **A recibe la notificación** "… aceptó tu solicitud" (con la app cerrada y abierta).
- [ ] A: Solicitudes → "Mostrar mi código de abordaje" y el chat del viaje se abren.
- [ ] B edita la hora o el precio → **A recibe** "… cambió tu viaje" y el cambio aparece en Solicitudes, sin números de casa.
- [ ] B escanea el QR de A → la pantalla del QR de A cambia sola a "a bordo" (**tiempo real**).
- [ ] B finaliza → **A recibe** "Viaje finalizado … Toca para calificar" → al tocarla abre el viaje con la calificación.
- [ ] Calificar con comentario → "¡Gracias…!"; en Viajes → Mis viajes aparece "Tu calificación ★".
- [ ] Ya no se ofrece calificar ese viaje otra vez (ni en el aviso ni en el historial).
- [ ] Aviso "¿Cómo te fue con …?" → cerrarlo con la X → no vuelve, pero "Calificar al conductor" sigue en Mis viajes (con otro viaje sin calificar).
- [ ] Después del viaje, en el resumen: placa enmascarada otra vez; el chat ya no aparece en Chats; abrir el chat desde una notificación vieja → "Este chat ya no está disponible".

## 3. Conductor (teléfono B, A y un tercer pasajero o cuenta ConVía+ en otro teléfono)

- [ ] Verificación de licencia: foto de la licencia + rostro → aprobado; el modo conductor se desbloquea.
- [ ] Vehículo: formulario vacío → errores en cada campo; la guía de la foto ya no pide la placa.
- [ ] Cuenta FREE con un vehículo → "Agregar vehículo" muestra la explicación de ConVía+ (no falla ni se cierra).
- [ ] Crear viaje: campos vacíos → error debajo de cada uno (vehículo, salida, destino, hora, precio, cupos).
- [ ] Elegir ruta (alternativas, paradas) y vehículo; publicar → aparece en Mis viajes.
- [ ] **Prioridad (1 cupo):** una solicitud FREE que va a Cota y una ConVía+ que va a otro lado → la FREE aparece primero y se puede aceptar.
- [ ] **Prioridad (1 cupo):** FREE y ConVía+ igual de compatibles → la ConVía+ aparece primero; aceptar la FREE muestra "Hay 1 solicitud(es) ConVía+ igual de compatibles…"; la FREE sigue pendiente (no rechazada).
- [ ] La recogida exacta (con número) se ve **solo después de aceptar**.
- [ ] Chat con el pasajero aceptado, en ambos sentidos; notificación de mensaje con la app cerrada.
- [ ] Iniciar → escanear QR (permiso de cámara) → finalizar → resumen con pagos y calificación de pasajeros.
- [ ] Viaje finalizado: no se puede editar; el chat no permite escribir.
- [ ] Repetir viaje crea uno nuevo; el finalizado no cambia.

## 4. Mapas

- [ ] Cuenta **FREE**: el mapa es MapLibre (estilo OpenStreetMap, botón ⓘ de atribución visible abajo a la izquierda) y `logcat` **no** muestra "Google Android Maps SDK".
- [ ] Cuenta **ConVía+**: el mapa es Google Maps (logo de Google) y aparece el botón de tráfico.
- [ ] FREE: el botón de tráfico abre la explicación de ConVía+.
- [ ] Buscar un lugar, tocar el mapa, arrastrar el pin, "Planear un viaje hacia aquí".
- [ ] Vista previa de ruta en el detalle del viaje (recortada en los extremos para otros usuarios).
- [ ] Permiso de ubicación: aceptar, negar y "Usar mi ubicación actual" con el permiso negado (mensaje claro, sin cierre).

## 5. Identidad y seguridad del viaje

- [ ] Permiso de cámara: aceptar / negar / "Abrir ajustes" desde el escáner.
- [ ] Selfie de registro y verificación antes de pedir cupo.
- [ ] Escanear el QR de un pasajero de **otro** viaje → mensaje de error, no lo marca a bordo.
- [ ] Escanear un QR que no es de ConVía → "Este no es un código de ConVía".

## 6. Interfaz

- [ ] Pestaña seleccionada: barra azul arriba, ícono relleno, **sin recuadro**.
- [ ] Distintivo ConVía+ igual en perfil, tarjetas, detalle, solicitudes y resumen.
- [ ] Estados de carga (esqueletos), vacíos y de error comprensibles.
- [ ] Sin pantallas cortadas con teclado abierto (registro, crear viaje, chat, calificación).
- [ ] Ningún cierre inesperado durante toda la prueba (revisar `logcat`).

## No se puede probar aquí

- **Aislamiento entre organizaciones en el teléfono:** solo existe la organización `unisabana.edu.co`. Está verificado en la base de datos (`supabase/tests/security_audit_test.sql`); probarlo en un teléfono requiere crear otra institución con un dominio de correo real.
- **Recordatorio de calificación programado:** no existe; el recordatorio es la notificación de viaje finalizado y el aviso en la app.
- **iPhone:** no hay build de iOS.
