# ConVía — Especificación extraída del Figma

Fuente: `figma.com/design/aEHTWD1yun7qkzKrHFbN30/WheelsApp` (página única "Page 1"). Solo lectura, no se modificó nada.
Fecha de extracción: 25-sep-2026. Los IDs `[x:y]` son los nodos de Figma, por si necesitas volver a uno puntual.

---

## 1. Resumen del producto

App de **carpooling / viajes compartidos** para comunidades cerradas (universidad o empresa, validadas por dominio de correo, p. ej. `unisabana.edu.co`), en la zona Chía / Colina / Santafe. Tiene dos roles:

- **Usuario (pasajero / cliente):** busca viajes publicados, pide que lo recojan en un **punto** (parada), ve el estado de sus solicitudes, muestra un **QR** al conductor para abordar, sigue el viaje en el mapa y habla con un **asistente virtual**.
- **Conductor:** registra su carro, **crea viajes** (origen, destino, fecha, hora, precio), acepta o rechaza los **puntos solicitados**, empieza el viaje, **escanea el QR** de cada pasajero y termina el viaje.

El rol se elige al registrarse y **se puede cambiar después** ("Quiero ser usuario" en el perfil). Antes de pedir viajes, el usuario debe **verificar su identidad con reconocimiento facial**.

---

## 2. Organización del archivo

| Sección (frame) | ID | Pantallas |
|---|---|---|
| Authentication | 26:2061 | Onboarding, Login, Sign up, Rol, Registra tu carro |
| *(imágenes planas, fuera de sección)* | 3040:3551–3563 | Regístrate (Universidad/Empresa), Correo institucional, Verifica tu identidad, Captura facial, Verificación completada |
| Reservar viajes – Cliente | 26:1752 | Home/Resultados, Búsqueda, Filtros, Detalle del viaje (solicitar punto) |
| Qr – Cliente | 27:7030 | Solicitudes, Info del viaje aceptado (QR) |
| Historial de viajes | 34:3468 | Tus anteriores viajes |
| Viaje en curso – Cliente | 26:3131 | 3 estados de mapa + Chat asistente |
| Home – Conductor | 27:5096 | Home conductor, Crear viaje |
| Mis viajes – Conductor | 27:5889 | Mis viajes, Detalle viaje (aceptar puntos) |
| Viaje en curso – Conductor | 27:7385 | Mapa colapsado, Mapa con usuarios, Escáner QR |
| Perfil | 26:2703 | Ajustes, Cerrar sesión (diálogo) |
| Diálogos sueltos | 38:3542 / 38:3556 / 38:3570 | Confirmación ×2, Información |

Todas las pantallas son **375 × 812** (iPhone X/11 Pro). No hay prototipo configurado (0 flows); solo existen 5 interacciones sueltas (ver §7).

> ⚠️ Las 5 pantallas de registro institucional y verificación facial (image 1–5) son **capturas PNG pegadas**, no frames editables. Hay que reconstruirlas a ojo con los tokens de §3.

---

## 3. Design system

No hay estilos locales ni variables: los componentes vienen de un UI kit externo. Los tokens se derivaron del uso real en las pantallas.

### 3.1 Colores

| Token sugerido | Hex | Uso |
|---|---|---|
| `primary` | **#006FFD** | Botones, links, tags activos, badges, burbuja enviada, pins activos, borde input en foco |
| `primaryLight` | #EAF2FF | Tag por defecto, fondo avatar, ítem seleccionado |
| `primaryLighter` | #B4DBFF | Nombre en burbuja enviada |
| `surface` | #F8F9FE | Cards, search bar, burbuja recibida, input de chat |
| `white` | #FFFFFF | Fondos |
| `textPrimary` | #1F2024 | Títulos y texto principal |
| `textLabel` | #2F3036 | Label de inputs |
| `textSecondary` | #71727A | Subtítulos, descripciones |
| `textPlaceholder` | #8F9098 | Placeholder / support text |
| `border` | #C5C6CC | Bordes de input, checkbox, pins inactivos |
| `borderLight` | #D4D6DD | Divisores |
| `track` | #E8E9F1 | Fondo progress bar |
| `success` | #3AC0A0 | Verificación completada, dominio reconocido |
| `navInactive` | #6B6B6B | Tabs inactivos del bottom nav |
| `navActive` | #000000 | Tab activo |
| `overlay` | #808080 @55% | Fondo detrás de diálogos |

### 3.2 Tipografía

Fuente principal **Inter**. (El bottom nav y el banner del carro usan *Uber Move*, heredado del kit; recomiendo reemplazar por Inter.)

| Estilo | Fuente | Uso |
|---|---|---|
| H1 | Inter ExtraBold 24 | Títulos de pantalla ("Iniciar Sesion", "Solicitudes") |
| H2 | Inter ExtraBold 18 | Títulos grandes secundarios |
| H3 | Inter ExtraBold 16 | Título de diálogo, título de sheet |
| H4 | Inter Bold 14 | Título de card, título de nav bar |
| H5 | Inter Bold 12 | Label de input, nombre en burbuja |
| Body L | Inter Regular 14 / 20 | Texto de lista, mensajes |
| Body M | Inter Regular 12 / 16 | Descripciones |
| Body S | Inter Regular 10 / 14 | Captions |
| Action M | Inter SemiBold 12 | Texto de botones |
| Caption/Tag | Inter SemiBold 10 | Tags, badges, overline ("ACEPTADOS") |
| Nav label | 14 Medium | Bottom nav |

### 3.3 Radios, bordes y sombras

- Radios: **12** (botones, inputs, tags, filtros), **16** (cards, diálogos), **20** (burbujas, badges), **24** (search bar, dots), **32** (avatar L), full/500 (radio button).
- Bordes: input vacío 1px #C5C6CC · input en foco 1.5px #006FFD · botón secundario 1.5px #006FFD · filtro 0.5px #C5C6CC.
- Sombra: `0 1 0 rgba(0,0,0,.3)` (separador del nav bar). Blur de fondo 70 en bottom sheets.

### 3.4 Componentes (specs medidos)

| Componente | Specs |
|---|---|
| **Button Primary** | 327×48, bg #006FFD, r12, padding 12/16, gap 8, texto SemiBold 12 blanco, íconos izq./der. opcionales 12px. Variante pequeña 67×29 ("Reservar") |
| **Button Secondary** | alto 40, borde 1.5 #006FFD, r12, texto SemiBold 12 #006FFD |
| **Text Field** | 327×71: label Bold 12 #2F3036 + campo 48 alto r12 padding 12/16 + support text 10 #8F9098. Estados: `Empty` (borde #C5C6CC), `Typing` (borde 1.5 #006FFD). Ícono ojo en contraseña |
| **Search Bar** | 343×44, bg #F8F9FE, r24, ícono lupa 16, texto 14. Estados `Typing` / `Filled` |
| **Filter / Sort chip** | alto 36, borde 0.5 #C5C6CC, r12, texto 12, flecha ▾; estado `Active` con Badge numérico |
| **Badge (number)** | 24×24 (20 en chip), bg #006FFD, r20, SemiBold 10 blanco |
| **Tag** | alto 24, r12, padding 6/8, SemiBold 10. `Focus`: bg #006FFD texto blanco · `Default`: bg #EAF2FF texto #006FFD |
| **List Item** | 343×52, padding 16, título 14 + subtítulo 12 #71727A; controles: ninguno / flecha › / badge / check. Variante con borde 0.5 r12 para opciones seleccionables |
| **Vertical Card** | 166×189, bg #F8F9FE, r16, imagen 120 alto + contenido padding 16; tag de fecha arriba-derecha |
| **Horizontal Card** | 343×69, bg #F8F9FE, r16, imagen 80 + título Bold 14 + subtítulo 12 + flecha › |
| **Nav Bar** | 375×56 blanco; variantes: texto-título-texto (Cancel / Filtro / Limpiar), ícono-título-avatar (chat), solo título (Ajustes) |
| **Header de detalle** | ‹ + título Bold 14 + subtítulo 12 (fecha) + texto derecha |
| **Bottom Navigation** | 376×83 blanco; 4 tabs: Home, Services, Activity, Account (activo negro, inactivo #6B6B6B) |
| **FAB "+"** | círculo #006FFD centrado sobre el bottom nav (solo Home conductor) |
| **Progress Bar** | 327×8, track #E8E9F1 r4, relleno #006FFD r8 |
| **Checkbox** | 24×24, borde 1.5 #C5C6CC, r6; interacción ON_CLICK → Selected=True |
| **Radio Button** | 16×16 círculo #006FFD con punto blanco |
| **Pagination Dots** | puntos 8×8 gap 8; activo #006FFD |
| **Avatar** | S 24×24 (r16) · L 80×80 (r32) con botón editar; bg #EAF2FF |
| **Rating** | estrella rellena + "4.8" |
| **Location Pin** | M 24×32 / S 18×24; gris #C5C6CC (inactivo), azul (activo), negro (destino) |
| **Message Bubble** | Received: bg #F8F9FE, nombre Bold 12 #71727A · Sent: bg #006FFD, nombre #B4DBFF, texto blanco · r20 · con/sin "tip" |
| **Message Input** | botón "+" 32 + campo pill bg #F8F9FE r71 + botón enviar |
| **2-Button Dialog** | 300 ancho, blanco r16 padding 16 gap 20; título ExtraBold 16, texto 12 #71727A; botones Secondary + Primary (o solo Primary) |
| **Bottom Sheet** | blanco, esquinas redondeadas arriba, handle gris; contiene carrusel de imagen + info |
| **Banner "Viaje en Curso"** | card azul #006FFD con imagen de carro a la derecha, texto blanco + "Ver detalles →" |
| **Mapa** | mapa gris claro estilizado (usar estilo custom en react-native-maps) |

---

## 4. Pantallas en detalle

### 4.1 Autenticación y onboarding

**A1. Onboarding** `[38:3482]`
- Imagen hero mitad superior. Pagination dots (3, primero activo) → carrusel.
- Título "Crea tu viaje en segundos", subtítulo "Disfruta de poder ..." (placeholder).
- Botón "Siguiente".

**A2. Login** `[26:2370]`
- Imagen superior. Título "Iniciar Sesion".
- Inputs: Correo Electronico, Contraseña (con ojo mostrar/ocultar).
- Link "¿Olvidaste tu contraseña?" (no hay pantalla diseñada para esto).
- Botón "Entrar". Texto "No tienes cuenta? **Registrate**".

**A3. Regístrate – tipo de comunidad** `[image 1]`
- ‹ atrás. Título "Regístrate", subtítulo "Únete de forma segura a nuestra comunidad de transporte".
- Dos cards seleccionables con ícono y ›:
  - **Universidad** — "Usa tu correo institucional" (ícono birrete, fondo azul claro = seleccionada)
  - **Empresa** — "Usa tu correo corporativo" (ícono edificio)
- Pie: "¿Ya tienes una cuenta? **Iniciar sesión**".

**A4. Correo institucional** `[image 2]`
- ‹ + progress bar (~1/3). Título "Correo institucional", "Ingresa tu correo institucional para verificar tu identidad."
- Input con botón limpiar: `tuusuario@unisabana.edu.co`.
- Card de validación verde: "✓ Dominio reconocido — unisabana.edu.co" (ícono birrete). → implica una lista de dominios permitidos por institución.
- Botón "Continuar".

**A5. Registrar – datos** `[26:2383]`
- Progress 50%. "Registrar" / "Crea una cuenta".
- Inputs: Nombre, Correo electronico (`name@email.com`), Contraseña ("Create a password"), Confirm password (con ojo).
- Checkbox "Leí los Términos y Condiciones y la Política de Privacidad." (links en azul).
- Se muestra con teclado abierto.

**A6. Personaliza tu experiencia – rol** `[27:8328]`
- Progress 50%. "Personaliza tu experiencia", "Escoge tu rol:".
- Opciones: **Usuario** / **Conductor** (seleccionada con fondo azul claro y ✓).
- Nota abajo: "**Importante:** independientemente del rol que escojas, más adelante podrás cambiarlo".
- Botón "Siguiente".

**A7. Registra tu carro** (solo conductor) `[27:8402]`
- Progress 50%. "Registra tu carro", "Necesitamos la siguiente información para registrar tu carro:".
- Inputs: **Placa**, **Marca** ("marca del vehiculo"), **Color** ("color del vehiculo"), **Cantidad de puestos** ("cantidad de puestos disponibles para el servicio").
- Card de subida: miniatura + badge "+", "Subir Foto del Vehiculo — Asegúrate de que se vea nítidamente tu vehículo".
- Botón "Finalizar".

**A8. Verifica tu identidad** `[image 3]`
- ‹ + progress. "Verifica tu identidad", "Por tu seguridad y la de todos, primero debes verificar tu rostro antes de solicitar un viaje."
- Ilustración de rostro con esquinas de encuadre azules.
- Tips con ícono: "Toma una foto en tiempo real", "Mantén un rostro neutral", "Asegúrate de tener buena iluminación".
- Botón "Comenzar verificación".

**A9. Captura facial** `[image 4]`
- Fondo negro (cámara), ✕ cerrar, "Coloca tu rostro dentro del marco".
- Óvalo blanco + esquinas azules; botón obturador circular blanco.

**A10. Verificación completada** `[image 5]`
- ‹. Círculo verde con ✓. "¡Verificación completada!", "Tu identidad ha sido verificada correctamente."
- Card azul claro con escudo: "Ahora puedes solicitar un viaje de forma segura."
- Botón "Continuar".

### 4.2 Cliente – reservar viajes

**C1. Home cliente / Resultados** `[26:1763]` — tab Home
- Search bar ("Autopista"). Chips "Sort ▾" y "Filter (2)".
- Banner azul **"Viaje en Curso"** — "fecha, hora de inicio, direccion, sector" — "Ver detalles →" (solo si hay viaje activo).
- Grid 2 columnas de Vertical Cards: "Viaje 1 € 12.00", "Viaje 2 € 15.00" … con botón pequeño **"Reservar"**.

**C2. Búsqueda** `[26:1753]`
- Search bar escribiendo ("Colina"). "RECENT SEARCHES": Colina, Santafe, Chia, cada uno con ✕ para borrar. Teclado abierto.

**C3. Filtros** `[26:1779]`
- Nav: "Cancel" · **Filtro** · "Limpiar".
- Filas: **Sector** (badge 1), **Dirección** (badge 1), **Rango de precio** ▾, **Hora** ▾, **Puntaje del Conductor** ▾.
- Botón "Aplicar Filtros". Tab Home activo.

**C4. Detalle del viaje / Solicitar punto** `[52:3067]` (anotación: "Solicitar punto", "Aprox hora")
- Header: ‹ "Colina" / "Mar 12 – Mar 15".
- Input "Where to?" + botón circular azul "+" → el pasajero agrega su **punto de recogida**.
- Mapa con pins. Bottom sheet: carrusel de imágenes (dots), "Info del Viaje", precio, "Sobre el viaje", Conductor **Rita C ★4.8**.
- Interacción: tocar el mapa → `[26:3954]`.
- La nota "Aprox hora" sugiere mostrar la hora aproximada de recogida.

### 4.3 Cliente – solicitudes y QR (tab Services)

**C5. Solicitudes** `[27:9068]`
- Título "Solicitudes". Tags filtro: **Todos** (activo) · Aceptados · Pendientes · Negados.
- Secciones **Aceptados** / **Pendientes** / **Negados**, cada una con card: radio/ícono, "Info del viaje aceptado", "fecha, hora de inicio, direccion, sector", "€ 000". (Aceptados con fondo azul claro.)

**C6. Info del Viaje Aceptado – QR** `[27:8827]` (anotación "Ruta del viaje")
- Header ‹ "Info del Viaje Aceptado" / "Fecha, hora".
- Sheet con **código QR grande** (el pasajero lo muestra al conductor para abordar).
- "Punto" + precio, "About" (descripción), Conductor **Karen Roe ★4.8**.

### 4.4 Cliente – historial

**C7. Historial de viajes** `[39:3632]` — tab Services
- Ícono buscar. "Tus anteriores viajes". Lista de Horizontal Cards: "Fecha, hora" / "direccion, parada" ›.

### 4.5 Cliente – viaje en curso (tab Activity)

Anotaciones del diseñador: **"No tiene viajes en curso"** (estado vacío, no diseñado) y **"viajes con sus estados"**.

**C8. Viaje por empezar** `[26:3885]`
- Header ‹ "Colina – En curso" / "Mar 12 – Mar 15".
- Mapa + sheet: Info del Viaje, precio, Sobre el viaje, Conductor Rita C ★4.8.
- Botón secundario **"Scannear Qr Para Empezar Viaje"**.

**C9. Mapa completo en curso** `[27:8586]`
- Mapa a pantalla completa con muchos pins azules (paradas), pastilla azul **"00:00"** (tiempo / ETA), sheet colapsado.

**C10. En curso con sheet** `[26:3954]`
- Mapa + pastilla "00:00" + sheet: Info del Viaje, Conductor Karen Roe.

**C11. Chat – Asistente Virtual** `[27:4968]`, `[28:9789]`
- Nav: ‹ "Asistente Virtual" + avatar.
- Conversación de ejemplo: Asistente "Hola! ¿En qué te puedo ayudar?", usuario (Merchito) "Hola", "¿Podrías decirme cuánto tarda mi conductor?".
- Input con "+" y enviar. Teclado abierto. Es un **bot**, no chat con el conductor.

### 4.6 Conductor – home y crear viaje

**D1. Home conductor** `[52:3437]` (anotación: "Página principal – mis viajes, opción de crear viaje") — tab Home
- Ícono buscar. Banner **"Viaje en Curso"** — "fecha, hora de inicio, direccion, sector" — "Ver detalles".
- "Tus viajes" + "Ver más": carrusel horizontal de Vertical Cards: tag fecha "MAR 05", "Colina", "hora, direccion, precio", "**2 solicitudes pendientes**", botón "Ver info".
- "Puntos Solicitados": Horizontal Cards — **Merchito** "Colina, calle 153"; **Brandon** "Santafe, calle 180" ›.
- **FAB "+"** sobre el bottom nav → Crear viaje.

**D2. Crear un nuevo viaje** `[34:2125]` + header `[52:3941]`
- Header ‹ "Crea un nuevo viaje".
- Origen / destino (dos inputs apilados con línea de ruta, placeholders "Badarpur-India Post Office" / "Where to?") + botón de intercambio.
- Inputs: **Fecha** ("Lunes 12-12-2012", en foco), **Hora** ("Hora del viaje"), **Precio** (placeholder copiado mal: "color del vehiculo").
- Chips de hora rápida: **15.00** (activo), 15.30, 15.10, 15.05.
- Botón "Crear Viaje".

### 4.7 Conductor – mis viajes (tab Services)

**D3. Mis viajes** `[34:3270]`
- Igual a D1 sin banner ni FAB: "Tus viajes" (carrusel) + "Puntos Solicitados".

**D4. Detalle del viaje – aceptar puntos** `[35:4420]` (anotación: "Aceptar puntos – (ver cliente, ver ruta)")
- Header ‹ "Santafe – Por empezar" / fecha. Mapa con pines (azul = aceptados, negro = destino/pendientes).
- Sheet: "Colina" "€ 150.00".
  - **ACEPTADOS:** Merchito — Colina, calle 153 — acción "Scanear QR".
  - **PENDIENTES:** Brandon — Santafe, calle 180 — botones **Aceptar** / **Cancelar**.
- Botón secundario "Empezar viaje".

### 4.8 Conductor – viaje en curso (tab Activity/Home)

Anotaciones: **"Leer qr"**, **"ver info"**, **"tiempo hasta próxima parada"**.

**D5. Mapa en curso colapsado** `[35:3541]`
- ‹ "Colina – En curso" / fecha. Mapa completo; sheet mínimo "Colina € 150.00". Tocar un pin → D6.

**D6. Mapa con usuarios** `[35:3472]`
- Sheet: "Colina € 150.00", **USUARIOS**: Merchito (Colina, calle 153) y Brandon (Santafe, calle 180), cada uno con "Scanear QR".
- Botón secundario **"Terminar viaje"** (el diseño contempla "Empezar viaje / Terminar viaje" según estado).
- Interacciones: mapa → D5; pin → D6.

**D7. Escáner QR** `[38:2950]`
- Header ‹ "Merchito" / "parada". Visor de QR con esquinas azules y línea de escaneo.
- Botón secundario "Seguir Viaje".

### 4.9 Perfil (tab Account)

**P1. Ajustes** `[26:3012]`
- Nav "Ajustes". Avatar L con botón editar, "Merchito", rol "Conductor".
- Lista con ›: **Quiero ser usuario** (cambio de rol), **Editar datos de mi vehículo**, **Configuración**.
- En rol usuario, lo lógico es "Quiero ser conductor" y ocultar "Editar datos de mi vehículo" (no diseñado).

**P2. Cerrar sesión** `[27:8158]`
- Diálogo sobre overlay: "Cerrar Sesión" — "¿Estás seguro de que quieres cerrar tu sesión?" — Cancel / **Cerrar Sesión**.
- El fondo es una pantalla de ejemplo del kit (Lucas Scott, Saved Messages…); **ignorar**, solo importa el diálogo.

### 4.10 Diálogos genéricos
- **Confirmación** `[38:3542/38:3556]`: "Esta seguro de accion..." — Cancelar / Confirmar (p. ej. aceptar/cancelar punto, terminar viaje).
- **Información** `[38:3570]`: "Su accion fue realizada con exito" — Seguir.

---

## 5. Navegación propuesta

```
Onboarding → Login ──(Registrate)→ Regístrate (Universidad | Empresa)
                                     → Correo institucional (valida dominio)
                                     → Datos (nombre, correo, contraseña, T&C)
                                     → Rol (Usuario | Conductor)
                                         ├─ Conductor → Registra tu carro
                                         └─ Usuario ─┐
                                     → Verifica tu identidad → Captura facial → Verificación completada
                                     → Tabs según rol
```

**Tabs cliente**
| Tab | Contenido |
|---|---|
| Home | Buscar/listar viajes (C1) → Búsqueda (C2), Filtros (C3), Detalle/Solicitar punto (C4) |
| Services | Solicitudes (C5) → QR (C6); Historial (C7) |
| Activity | Viaje en curso (C8–C10) o estado vacío; Chat asistente (C11) |
| Account | Perfil (P1), cerrar sesión (P2) |

**Tabs conductor**
| Tab | Contenido |
|---|---|
| Home | Home (D1) + FAB → Crear viaje (D2) |
| Services | Mis viajes (D3) → Detalle/aceptar puntos (D4) |
| Activity | Viaje en curso (D5–D6) → Escáner QR (D7) |
| Account | Perfil (P1) |

(La asignación de tabs sale del tab activo en cada pantalla; los labels están en inglés en el diseño.)

---

## 6. Flujos de negocio

**Pasajero**
1. Busca/filtra viajes (sector, dirección, precio, hora, puntaje del conductor).
2. Abre un viaje → agrega su **punto** ("Where to?" + "+") → queda **Pendiente**.
3. El conductor acepta o rechaza → **Aceptado** / **Negado** (visible en Solicitudes).
4. En un viaje aceptado ve su **QR**.
5. Al llegar el conductor, este **escanea el QR** → empieza el viaje para ese pasajero.
6. Sigue el viaje en el mapa con el tiempo (00:00); puede preguntar al asistente virtual.
7. Viaje terminado → aparece en Historial.

**Conductor**
1. Crea un viaje (origen, destino, fecha, hora, precio; los cupos salen del carro).
2. Recibe **puntos solicitados** ("2 solicitudes pendientes").
3. En el detalle: ve cliente y ruta, **Acepta / Cancela** cada punto.
4. **Empezar viaje** → mapa con paradas y "tiempo hasta próxima parada".
5. En cada parada **escanea el QR** del pasajero → "Seguir Viaje".
6. **Terminar viaje**.

**Estados**
- Viaje: `por_empezar` → `en_curso` → `finalizado` (+ `cancelado`, implícito).
- Solicitud/punto: `pendiente` → `aceptado` | `negado`; luego `abordado` (QR escaneado).
- Verificación facial: `idle` → `processing` → `verified` | `failed` → `retry`.

---

## 7. Interacciones que sí existen en Figma

| Origen | Acción | Destino |
|---|---|---|
| Checkbox (Sign up) | On click → cambia a | Selected=True |
| Radio Button (Solicitudes) | On click → cambia a | Selected=False |
| Mapa (C4, C8, C9) | Navigate | C10 `[26:3954]` |
| Mapa (D6) | Navigate | D5 `[35:3541]` |
| Location Pin (D5, D6) | Navigate | D6 `[35:3472]` |

Todo lo demás hay que definirlo en código.

---

## 8. Entidades de datos (para los mocks)

```ts
User        { id, nombre, correo, tipoComunidad: 'universidad'|'empresa', dominio, rol: 'usuario'|'conductor',
              verificado: boolean, avatarUrl?, rating }
Vehicle     { id, conductorId, placa, marca, color, puestos, fotoUrl }
Trip        { id, conductorId, origen, destino, sector, fecha, hora, precio, cuposTotales,
              estado: 'por_empezar'|'en_curso'|'finalizado'|'cancelado', imagenes[], descripcion }
PointRequest{ id, tripId, pasajeroId, direccion, lat, lng, horaAprox?,
              estado: 'pendiente'|'aceptado'|'negado'|'abordado', qrToken }
ChatMessage { id, autor: 'usuario'|'asistente', texto, timestamp }
RecentSearch{ texto, fecha }
```

Datos de ejemplo del diseño: conductores **Rita C** y **Karen Roe** (★4.8); pasajeros **Merchito** (Colina, calle 153) y **Brandon** (Santafe, calle 180); lugares **Colina, Santafe, Chía, Autopista**; precios 12.00 / 15.00 / 150.00; dominio **unisabana.edu.co**.

---

## 9. Inconsistencias y huecos a decidir

1. **Moneda:** el diseño usa "€"; para Colombia debería ser COP ($).
2. **Textos del kit en inglés** que se deben reemplazar: "Recent searches", "Sort", "Filter", "Cancel", "Where to?", "291 results", "every year", "Great Apartment", "Hosted by", "Perfect flat for 4 people…", "See details", "Buy tickets", "Maroon 5", labels del bottom nav (Home/Services/Activity/Account).
3. **Placeholder erróneo:** campo Precio en Crear viaje dice "color del vehiculo".
4. **Progress bars:** todas al 50%; hay que definir los pasos reales del registro.
5. **Orden del registro** no está explícito: ¿los datos (A5) van antes o después del correo institucional (A4)? ¿Empresa usa el mismo flujo con dominio corporativo?
6. **5 pantallas son imágenes** (A3, A4, A8–A10), no frames.
7. **Pantallas faltantes:** recuperar contraseña, estado vacío "No tiene viajes en curso", perfil del rol usuario, Configuración, Editar vehículo, verificación fallida/reintento, confirmación de viaje creado, detalle de historial, flujo "Reservar" en C1 vs "Solicitar punto" en C4 (¿son lo mismo?).
8. **Fuente Uber Move** en bottom nav y banner → usar Inter.
9. Los botones "Reservar" de C1 están sueltos sobre la sección, no dentro de las cards.
10. No hay chat pasajero↔conductor, solo asistente virtual.
