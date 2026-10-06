/**
 * Terms and Conditions + Privacy Policy shown in the app (app/legal.tsx).
 *
 * Written to match what the app actually does (see README > Security notes).
 * Before publishing in the stores, have a lawyer review it and fill in the
 * company details below. When the text changes materially, bump
 * LEGAL_VERSION: new sign-ups store the version they accepted.
 */

export const LEGAL_VERSION = '1.0';
export const LEGAL_UPDATED_AT = '30 de septiembre de 2026';

// TODO(legal): replace with the company's real details before release.
export const LEGAL_COMPANY = {
  name: 'ConVía',
  legalName: '[Razón social de ConVía]',
  taxId: '[NIT]',
  address: '[Dirección, ciudad]',
  email: '[correo de contacto para datos personales]',
};

export type LegalBlock = string | { bullets: string[] };
export type LegalSection = { id: string; title: string; body: LegalBlock[] };
export type LegalDocument = { title: string; summary: string[]; sections: LegalSection[] };

const company = `${LEGAL_COMPANY.legalName} (en adelante, "ConVía")`;

export const TERMS: LegalDocument = {
  title: 'Términos y Condiciones',
  summary: [
    'ConVía conecta a personas de una misma comunidad universitaria para compartir trayectos. No somos una empresa de transporte ni prestamos el servicio de viaje.',
    'El aporte que acuerdan pasajero y conductor es solo para compartir gastos del trayecto, no para obtener ganancia.',
    'Cada conductor responde por tener licencia, SOAT, revisión técnico-mecánica y su vehículo en regla.',
    'Debes ser mayor de edad, dar datos reales y tratar a los demás con respeto. Podemos suspender cuentas que incumplan estas reglas.',
  ],
  sections: [
    {
      id: 'aceptacion',
      title: '1. Aceptación',
      body: [
        `Estos Términos y Condiciones regulan el uso de la aplicación ConVía, ofrecida por ${company}. Al crear una cuenta y marcar la casilla de aceptación declaras que los leíste, los entiendes y los aceptas. Esa aceptación electrónica tiene la misma validez que una firma, conforme a la Ley 527 de 1999.`,
        'Si no estás de acuerdo con alguno de estos términos, no debes crear una cuenta ni usar la aplicación.',
      ],
    },
    {
      id: 'servicio',
      title: '2. Qué es ConVía',
      body: [
        'ConVía es una plataforma tecnológica que permite a miembros de una comunidad universitaria publicar trayectos que ya van a realizar en su vehículo particular y a otros miembros solicitar un cupo en ellos (carro compartido).',
        'ConVía no es una empresa de transporte, no presta el servicio de transporte, no es propietaria de los vehículos, no contrata a los conductores y no es parte del acuerdo entre pasajero y conductor. Nuestra función se limita a facilitar el contacto y la coordinación entre usuarios.',
        'La aplicación no debe usarse para prestar servicio público de transporte ni ninguna actividad de transporte con fines comerciales o de lucro.',
      ],
    },
    {
      id: 'requisitos',
      title: '3. Requisitos para usar ConVía',
      body: [
        {
          bullets: [
            'Ser mayor de 18 años.',
            'Pertenecer a una institución habilitada en ConVía y registrarte con tu correo institucional.',
            'Suministrar información veraz, completa y actualizada, y mantenerla así.',
            'Tener una sola cuenta, personal e intransferible.',
            'Completar la verificación de identidad cuando la aplicación la solicite.',
          ],
        },
      ],
    },
    {
      id: 'cuenta',
      title: '4. Tu cuenta y tu contraseña',
      body: [
        'Eres responsable de mantener la confidencialidad de tu contraseña y de toda la actividad realizada desde tu cuenta. Si sospechas un uso no autorizado, cambia tu contraseña de inmediato y avísanos.',
        'La opción "Recordarme" guarda tus credenciales únicamente en el almacenamiento seguro de tu teléfono. No la uses en dispositivos compartidos.',
      ],
    },
    {
      id: 'conductores',
      title: '5. Obligaciones de los conductores',
      body: [
        'Si publicas viajes como conductor, declaras y garantizas que:',
        {
          bullets: [
            'Tienes licencia de conducción vigente y válida para la categoría del vehículo.',
            'El vehículo cuenta con SOAT vigente, revisión técnico-mecánica al día (cuando aplique) y está en buenas condiciones mecánicas y de seguridad.',
            'Estás autorizado para usar el vehículo que registras y los datos del vehículo (placa, color, fotos, cupos) son reales.',
            'No transportarás más pasajeros de los permitidos para el vehículo ni de los cupos publicados.',
            'Conducirás respetando las normas de tránsito, sin haber consumido alcohol ni sustancias psicoactivas y sin usar el teléfono mientras manejas.',
            'Solo publicarás trayectos que realmente vas a realizar, y cancelarás con anticipación si no puedes cumplirlos.',
          ],
        },
        'La verificación de conductor de ConVía compara tu rostro con la foto de tu licencia para confirmar que eres su titular. Esta verificación no confirma que la licencia sea auténtica, esté vigente o esté registrada ante las autoridades (por ejemplo, el RUNT); esa responsabilidad es exclusivamente del conductor.',
      ],
    },
    {
      id: 'pasajeros',
      title: '6. Obligaciones de los pasajeros',
      body: [
        {
          bullets: [
            'Llegar a tiempo al punto de recogida acordado y avisar por el chat si no podrás viajar.',
            'Mostrar tu código QR de abordaje al subir al vehículo.',
            'Usar el cinturón de seguridad y respetar el vehículo y las indicaciones razonables del conductor.',
            'No llevar objetos peligrosos, ilegales o que pongan en riesgo a los demás ocupantes.',
          ],
        },
      ],
    },
    {
      id: 'aportes',
      title: '7. Aportes y pagos',
      body: [
        'El valor que el conductor indica en un viaje es un aporte voluntario para compartir los gastos del trayecto (combustible, peajes, parqueadero), no una tarifa ni el precio de un servicio de transporte. Los conductores no deben fijar valores que generen ganancia.',
        'ConVía no procesa pagos ni cobra comisiones. El aporte se entrega directamente entre usuarios, y el registro de "pagado" en la aplicación es solo una ayuda para el conductor. ConVía no responde por pagos no realizados, ni por reclamaciones entre usuarios relacionadas con ellos.',
      ],
    },
    {
      id: 'conducta',
      title: '8. Reglas de convivencia',
      body: [
        'No está permitido:',
        {
          bullets: [
            'Acosar, amenazar, discriminar o insultar a otros usuarios, por el chat o en persona.',
            'Publicar contenido sexual, violento, engañoso o ilegal, o compartir datos personales de terceros.',
            'Suplantar a otra persona o usar fotos que no sean tuyas.',
            'Usar ConVía para fines comerciales, publicidad o actividades distintas a compartir trayectos.',
            'Intentar vulnerar la seguridad de la aplicación, acceder a cuentas ajenas o manipular las calificaciones.',
          ],
        },
        'Las calificaciones y comentarios deben ser honestos y referirse a la experiencia del viaje.',
      ],
    },
    {
      id: 'seguridad',
      title: '9. Seguridad y emergencias',
      body: [
        'Antes de subir, verifica que el conductor, la placa y el vehículo coincidan con lo que muestra la aplicación. Si algo no coincide o no te sientes seguro, no inicies el viaje.',
        'ConVía no presta servicios de emergencia. Ante cualquier emergencia comunícate con la Línea 123.',
      ],
    },
    {
      id: 'responsabilidad',
      title: '10. Limitación de responsabilidad',
      body: [
        'Los viajes se realizan bajo la responsabilidad exclusiva de los usuarios que participan en ellos. En la medida permitida por la ley, ConVía no responde por accidentes, daños, pérdidas, retrasos, cancelaciones ni por la conducta de los usuarios durante o con ocasión de un viaje, ni por la veracidad de la información que ellos suministran.',
        'La aplicación se ofrece "tal como está". Hacemos esfuerzos razonables para que funcione correctamente, pero no garantizamos que esté libre de errores o interrupciones. Las rutas, distancias, direcciones y tiempos son aproximados y provienen de servicios de mapas de terceros.',
        'Nada de lo aquí dispuesto limita los derechos que la ley colombiana reconoce de forma irrenunciable.',
      ],
    },
    {
      id: 'suspension',
      title: '11. Suspensión y cierre de la cuenta',
      body: [
        'Podemos suspender o cancelar cuentas que incumplan estos términos, que presenten reportes graves de otros usuarios o que representen un riesgo para la comunidad.',
        'Puedes eliminar tu cuenta en cualquier momento desde Perfil > Eliminar mi cuenta, siempre que no tengas un viaje en curso.',
      ],
    },
    {
      id: 'propiedad',
      title: '12. Propiedad intelectual',
      body: [
        'La marca ConVía, el diseño y el software de la aplicación pertenecen a ConVía o a sus licenciantes. Conservas los derechos sobre el contenido que publicas (fotos, mensajes, comentarios) y nos autorizas a usarlo únicamente para operar la aplicación.',
      ],
    },
    {
      id: 'cambios',
      title: '13. Cambios a estos términos',
      body: [
        'Podemos actualizar estos términos. Si el cambio es importante, te lo informaremos en la aplicación antes de que entre en vigor. Si sigues usando ConVía después de esa fecha, entenderemos que aceptas la nueva versión.',
      ],
    },
    {
      id: 'ley',
      title: '14. Ley aplicable',
      body: [
        'Estos términos se rigen por las leyes de la República de Colombia. Las diferencias se intentarán resolver primero de forma directa a través de nuestro canal de contacto.',
      ],
    },
  ],
};

export const PRIVACY: LegalDocument = {
  title: 'Política de Tratamiento de Datos Personales',
  summary: [
    'Usamos tus datos solo para que puedas compartir viajes de forma segura dentro de tu comunidad.',
    'Tu ubicación se usa mientras usas la aplicación (buscar lugares y viajes cercanos); no te rastreamos en segundo plano.',
    'Para verificar tu identidad convertimos tu rostro en una representación numérica. No guardamos fotos de tu cara ni de tu licencia.',
    'No vendemos tus datos. Puedes consultarlos, corregirlos o eliminar tu cuenta cuando quieras.',
  ],
  sections: [
    {
      id: 'responsable',
      title: '1. Responsable del tratamiento',
      body: [
        `${LEGAL_COMPANY.legalName}, NIT ${LEGAL_COMPANY.taxId}, con domicilio en ${LEGAL_COMPANY.address}. Correo de contacto para asuntos de datos personales: ${LEGAL_COMPANY.email}.`,
        'Esta política se expide en cumplimiento de la Ley 1581 de 2012, el Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015) y demás normas colombianas sobre protección de datos personales.',
      ],
    },
    {
      id: 'datos',
      title: '2. Datos que recolectamos',
      body: [
        {
          bullets: [
            'Identificación y contacto: nombre, correo institucional, teléfono (opcional) y foto de perfil.',
            'Cuenta: contraseña (la administra nuestro proveedor de autenticación de forma cifrada; ConVía no puede verla), rol (pasajero o conductor) e institución.',
            'Vehículo (conductores): marca, color, placa, número de cupos y fotos del vehículo.',
            'Viajes: origen, destino, ruta, fecha, hora, aporte, cupos, solicitudes, puntos de recogida, abordaje con código QR y estado del viaje.',
            'Comunicaciones: mensajes del chat de cada viaje, calificaciones y comentarios, y registro de aportes pagados.',
            'Ubicación: la posición de tu teléfono cuando usas funciones como "Usar mi ubicación", el mapa o los viajes cercanos.',
            'Datos biométricos: la representación numérica de tu rostro y el resultado de cada verificación (ver sección 4).',
            'Datos técnicos: identificador para notificaciones push y datos básicos del dispositivo necesarios para que la aplicación funcione.',
          ],
        },
      ],
    },
    {
      id: 'finalidades',
      title: '3. Para qué usamos tus datos',
      body: [
        {
          bullets: [
            'Crear y administrar tu cuenta y confirmar que perteneces a una institución habilitada.',
            'Verificar tu identidad y la de los conductores, y prevenir suplantaciones y fraudes.',
            'Publicar, buscar, solicitar y coordinar viajes, mostrar viajes cercanos o relevantes y calcular rutas.',
            'Mostrar a los participantes de un viaje la información necesaria: nombre, foto, calificación, vehículo, placa, ruta y punto de recogida.',
            'Permitir el chat entre participantes de un mismo viaje y enviarte notificaciones sobre tus viajes y solicitudes.',
            'Atender tus consultas y reclamos, hacer cumplir los Términos y Condiciones y colaborar con autoridades cuando la ley lo exija.',
            'Mejorar la seguridad y el funcionamiento de la aplicación.',
          ],
        },
        'No vendemos ni alquilamos tus datos personales, ni los usamos para publicidad de terceros.',
      ],
    },
    {
      id: 'biometricos',
      title: '4. Datos sensibles: verificación facial',
      body: [
        'Los datos biométricos son datos sensibles según la ley. Te informamos que no estás obligado a autorizar su tratamiento.',
        'Cómo funciona: tu teléfono toma una selfie y la convierte en una representación numérica de tu rostro. La foto no sale de tu teléfono ni se guarda. Solo la representación numérica se envía a nuestros servidores, donde se compara con la de tu registro (y, para conductores, con la obtenida de la foto de tu licencia, que tampoco se guarda). Esa representación nunca se devuelve a la aplicación ni se comparte con otros usuarios.',
        'Finalidad: confirmar que quien pide o publica un viaje es realmente el titular de la cuenta, para la seguridad de todos los usuarios.',
        'Si no autorizas este tratamiento, podrás tener una cuenta, pero no podrás solicitar ni publicar viajes, porque la verificación es una medida de seguridad necesaria para ello. Puedes revocar la autorización eliminando tu cuenta.',
      ],
    },
    {
      id: 'ubicacion',
      title: '5. Ubicación',
      body: [
        'Solo accedemos a tu ubicación con tu permiso y mientras usas la aplicación. No hacemos seguimiento en segundo plano. Puedes retirar el permiso en cualquier momento desde los ajustes de tu teléfono; seguirás pudiendo escribir las direcciones manualmente.',
        'Los puntos de origen, destino, ruta y recogida de un viaje sí se guardan, porque son necesarios para coordinarlo y los ven los participantes del viaje.',
      ],
    },
    {
      id: 'terceros',
      title: '6. Con quién compartimos datos',
      body: [
        'Compartimos datos únicamente con:',
        {
          bullets: [
            'Otros usuarios, solo en la medida necesaria para el viaje (por ejemplo, el conductor ve tu nombre, foto y punto de recogida cuando solicitas un cupo).',
            'Proveedores tecnológicos que actúan como encargados del tratamiento: Supabase (base de datos, autenticación y almacenamiento de archivos), Google (mapas en Android y Firebase Cloud Messaging para notificaciones), Apple (mapas y notificaciones en iPhone) y Expo (envío de notificaciones).',
            'Servicios de mapas basados en OpenStreetMap (búsqueda de lugares y cálculo de rutas), a los que se envían las búsquedas y coordenadas necesarias, sin tu nombre ni tu correo.',
            'Autoridades competentes, cuando exista una orden o una obligación legal.',
          ],
        },
        'Algunos de estos proveedores almacenan o procesan información en servidores ubicados fuera de Colombia. Al aceptar esta política autorizas esa transferencia o transmisión internacional, que se realiza con proveedores que ofrecen niveles adecuados de protección.',
      ],
    },
    {
      id: 'derechos',
      title: '7. Tus derechos',
      body: [
        'Como titular de los datos tienes derecho a:',
        {
          bullets: [
            'Conocer, actualizar y rectificar tus datos personales.',
            'Solicitar prueba de la autorización que nos diste.',
            'Ser informado sobre el uso que les damos a tus datos.',
            'Revocar la autorización y solicitar la supresión de tus datos, cuando no exista un deber legal o contractual de conservarlos.',
            'Acceder gratuitamente a tus datos personales.',
            'Presentar quejas ante la Superintendencia de Industria y Comercio (SIC) por infracciones a la ley, después de haber agotado el trámite ante ConVía.',
          ],
        },
        'Puedes actualizar tu nombre, teléfono y foto en Perfil > Información personal, y eliminar tu cuenta en Perfil > Eliminar mi cuenta.',
      ],
    },
    {
      id: 'procedimiento',
      title: '8. Consultas y reclamos',
      body: [
        `Escríbenos a ${LEGAL_COMPANY.email} desde el correo registrado en tu cuenta, indicando tu nombre, tu solicitud y los documentos que quieras hacer valer.`,
        'Las consultas se responden en un máximo de diez (10) días hábiles y los reclamos en un máximo de quince (15) días hábiles, prorrogables en los términos de la Ley 1581 de 2012. Si el plazo debe ampliarse, te informaremos el motivo.',
      ],
    },
    {
      id: 'conservacion',
      title: '9. Conservación y eliminación',
      body: [
        'Conservamos tus datos mientras tengas una cuenta activa. Cuando eliminas tu cuenta, se borran tu perfil, fotos, vehículos, viajes, solicitudes, mensajes y representaciones faciales, salvo la información que debamos conservar por obligación legal o para atender reclamaciones pendientes.',
        'Los mensajes y datos que otros usuarios ya recibieron durante un viaje pueden permanecer en sus dispositivos (por ejemplo, en capturas de pantalla), fuera del control de ConVía.',
      ],
    },
    {
      id: 'seguridad-datos',
      title: '10. Seguridad',
      body: [
        'Aplicamos medidas técnicas y administrativas razonables: comunicaciones cifradas, reglas de acceso que impiden que un usuario vea datos que no le corresponden, contraseñas cifradas y almacenamiento seguro en el dispositivo. Ningún sistema es infalible; si detectamos un incidente que afecte tus datos, te lo informaremos y lo reportaremos a la autoridad según la ley.',
      ],
    },
    {
      id: 'menores',
      title: '11. Menores de edad',
      body: [
        'ConVía está dirigida a personas mayores de 18 años. No recolectamos conscientemente datos de menores de edad; si detectamos una cuenta de un menor, la eliminaremos.',
      ],
    },
    {
      id: 'vigencia',
      title: '12. Vigencia y cambios',
      body: [
        `Esta política rige desde el ${LEGAL_UPDATED_AT}. Si la modificamos de forma sustancial, te lo informaremos en la aplicación y, cuando la ley lo exija, pediremos nuevamente tu autorización. Tus datos se tratarán mientras sea necesario para las finalidades descritas.`,
      ],
    },
  ],
};
