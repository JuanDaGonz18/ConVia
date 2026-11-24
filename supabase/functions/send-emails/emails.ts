/**
 * ConVía e-mails that are not about the account itself (those are supabase/templates): the welcome
 * after the e-mail is confirmed and the thank-you for the first ConVía+ payment. Same look as the
 * auth templates. No Deno globals, so Node can test it.
 */

export type EmailKind = 'welcome' | 'plus_first';

export type EmailInput = {
  kind: EmailKind;
  email: string;
  /** Profile name; may be empty. */
  nombre: string | null;
  /** End of the current ConVía+ period, when there is one (ISO). */
  plusUntil: string | null;
  /** Whether the current ConVía+ is the launch promotion. */
  promo: boolean;
  /** Months paid in the first payment (plus_first). */
  months: number | null;
};

export type RenderedEmail = { subject: string; html: string; text: string };

export const APP_URL = 'https://juandagonz18.github.io/ConVia/app/';

const FONT = "font-family:'Segoe UI', Arial, Helvetica, sans-serif;";
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** "14 de febrero de 2027", in Bogotá time. */
export function fechaEs(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 5 * 3600_000); // Colombia: UTC-5, no DST
  return `${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

/** First name only, cleaned; null when there is nothing usable. */
export function firstName(nombre: string | null): string | null {
  const first = (nombre ?? '').trim().split(/\s+/)[0] ?? '';
  return first.length >= 2 && first.length <= 30 ? first : null;
}

type Tip = { title: string; text: string };

function tipsTable(tips: Tip[]): string {
  return tips.map((tip, i) => `
        <tr>
          <td style="padding:12px 32px 0 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="36" valign="top" style="${FONT} font-size:15px; line-height:28px; font-weight:bold; color:#FFFFFF;">
                  <div style="width:28px; height:28px; border-radius:14px; background-color:#006FFD; text-align:center;">${i + 1}</div>
                </td>
                <td valign="top" style="${FONT} font-size:15px; line-height:22px; color:#1F2024;">
                  <strong>${escapeHtml(tip.title)}</strong><br>${escapeHtml(tip.text)}
                </td>
              </tr>
            </table>
          </td>
        </tr>`).join('');
}

function layout(opts: { preheader: string; title: string; intro: string; tips?: Tip[]; tipsTitle?: string; box?: string; button: string; closing: string }): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0; padding:0; background-color:#F8F9FE;">
<div style="display:none; max-height:0; overflow:hidden;">${escapeHtml(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8F9FE;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px; background-color:#FFFFFF; border:1px solid #C5C6CC; border-radius:16px;">
        <tr>
          <td style="padding:32px 32px 8px 32px; ${FONT} font-size:32px; line-height:40px; font-weight:bold; color:#1F2024;">
            Con<span style="color:#006FFD;">Vía</span>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px 0 32px; ${FONT} font-size:22px; line-height:30px; font-weight:bold; color:#1F2024;">${escapeHtml(opts.title)}</td>
        </tr>
        <tr>
          <td style="padding:12px 32px 0 32px; ${FONT} font-size:16px; line-height:24px; color:#1F2024;">${opts.intro}</td>
        </tr>${opts.tipsTitle ? `
        <tr>
          <td style="padding:24px 32px 0 32px; ${FONT} font-size:17px; line-height:24px; font-weight:bold; color:#1F2024;">${escapeHtml(opts.tipsTitle)}</td>
        </tr>` : ''}${tipsTable(opts.tips ?? [])}${opts.box ? `
        <tr>
          <td style="padding:24px 32px 0 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EAF2FF; border-radius:12px;">
              <tr>
                <td style="padding:16px; ${FONT} font-size:14px; line-height:21px; color:#1F2024;">${opts.box}</td>
              </tr>
            </table>
          </td>
        </tr>` : ''}
        <tr>
          <td align="center" style="padding:28px 32px;">
            <a href="${APP_URL}" style="display:inline-block; background-color:#006FFD; color:#FFFFFF; ${FONT} font-size:17px; line-height:52px; font-weight:bold; text-decoration:none; text-align:center; width:300px; border-radius:10px;">${escapeHtml(opts.button)}</a>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px; ${FONT} font-size:16px; line-height:24px; color:#1F2024;">${opts.closing}</td>
        </tr>
        <tr>
          <td style="padding:24px 32px 32px 32px; ${FONT} font-size:12px; line-height:18px; color:#71727A;">
            Recibes este correo porque tienes una cuenta en ConVía. Si tienes una pregunta o algo no funciona, respóndelo o usa «Reportar un problema» en tu perfil.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

const SIGNATURE = 'Gracias por confiar en ConVía,<br><strong>El equipo de ConVía</strong>';

const WELCOME_TIPS: Tip[] = [
  { title: 'Verifica tu institución', text: 'Con tu correo institucional es automático; si no, con tu carné. Solo así ves y pides viajes de tu comunidad.' },
  { title: 'Guarda tus lugares', text: 'Agrega tu casa y tu universidad o trabajo en Mis lugares: la app te muestra primero los viajes que pasan cerca.' },
  { title: 'Pon una foto de perfil', text: 'Los conductores aceptan más rápido a quien pueden reconocer en el punto de encuentro.' },
  { title: '¿Conduces? Publica tu ruta', text: 'Registra tu vehículo y tu licencia, publica el horario, los cupos y el aporte. Si vas igual todas las semanas, usa los viajes recurrentes.' },
  { title: '¿Vas de pasajero? Pide tu cupo', text: 'Busca tu destino, pide el cupo y coordina por el chat del viaje, sin dar tu número. Al subir, el conductor escanea tu código QR.' },
  { title: 'Califica al terminar', text: 'Las calificaciones mantienen la comunidad segura y ayudan a los demás a elegir.' },
];

export function renderEmail(input: EmailInput): RenderedEmail {
  const name = firstName(input.nombre);
  const hola = name ? `¡Hola, ${escapeHtml(name)}!` : '¡Hola!';

  if (input.kind === 'welcome') {
    const promo = input.promo && input.plusUntil
      ? `<strong>Tienes ConVía+ de regalo hasta el ${fechaEs(input.plusUntil)}</strong> por ser de los primeros: viajes recurrentes, varios vehículos, más lugares y rutas guardadas, y avisos cuando aparece un viaje que te sirve. Al terminar sigues con el plan gratis, sin perder nada.`
      : null;
    const intro = `${hola} Te damos la bienvenida a ConVía. Gracias por confiar en nosotros para moverte con tu comunidad: compartir el carro con gente de tu universidad o empresa ahorra plata, tiempo y trancón.`;
    return {
      subject: name ? `${name}, te damos la bienvenida a ConVía` : 'Te damos la bienvenida a ConVía',
      html: layout({
        preheader: 'Gracias por unirte. Así le sacas el máximo provecho a ConVía.',
        title: '¡Qué bueno tenerte en ConVía!',
        intro,
        tipsTitle: 'Así le sacas el máximo provecho',
        tips: WELCOME_TIPS,
        box: promo ?? '<strong>Tu seguridad primero:</strong> verifica que el carro que llega sea el del viaje (placa, color y foto) y comparte tu viaje con alguien de confianza.',
        button: 'Abrir ConVía',
        closing: SIGNATURE,
      }),
      text: [
        `${name ? `¡Hola, ${name}!` : '¡Hola!'} Te damos la bienvenida a ConVía. Gracias por confiar en nosotros.`,
        '',
        'Así le sacas el máximo provecho:',
        ...WELCOME_TIPS.map((tip, i) => `${i + 1}. ${tip.title}: ${tip.text}`),
        ...(input.promo && input.plusUntil ? ['', `Tienes ConVía+ de regalo hasta el ${fechaEs(input.plusUntil)}.`] : []),
        '',
        `Abrir ConVía: ${APP_URL}`,
        '',
        'Gracias por confiar en ConVía. El equipo de ConVía',
      ].join('\n'),
    };
  }

  const period = input.months === 12 ? '12 meses' : input.months && input.months > 1 ? `${input.months} meses` : '1 mes';
  const until = input.plusUntil ? ` Tu ConVía+ está activo hasta el <strong>${fechaEs(input.plusUntil)}</strong>.` : '';
  const plusTips: Tip[] = [
    { title: 'Publica tu semana una sola vez', text: 'Con los viajes recurrentes, ConVía publica tus viajes de cada semana por ti.' },
    { title: 'Recibe avisos de viajes', text: 'Guarda tus rutas y te avisamos cuando aparezca un viaje que te sirve.' },
    { title: 'Ten varios vehículos', text: 'Registra todos los carros que usas y elige con cuál vas en cada viaje.' },
    { title: 'Filtra y repite', text: 'Usa los filtros avanzados y repite un viaje anterior con un toque.' },
  ];
  return {
    subject: '¡Gracias por pasarte a ConVía+!',
    html: layout({
      preheader: 'Tu ConVía+ ya está activo. Gracias por apoyar a ConVía.',
      title: 'Gracias por pasarte a ConVía+',
      intro: `${hola} Recibimos tu pago de ${period} y tu ConVía+ ya está activo.${until} Gracias por apoyar a ConVía: tu pago nos ayuda a mantener la app funcionando y a seguir mejorándola para toda la comunidad.`,
      tipsTitle: 'Lo que puedes hacer ahora',
      tips: plusTips,
      box: '<strong>No se renueva solo:</strong> te avisamos 3 días antes de que venza. Si quieres seguir, renuévalo desde la pantalla ConVía+ de la app.',
      button: 'Abrir ConVía',
      closing: SIGNATURE,
    }),
    text: [
      `${name ? `¡Hola, ${name}!` : '¡Hola!'} Recibimos tu pago de ${period} y tu ConVía+ ya está activo${input.plusUntil ? ` hasta el ${fechaEs(input.plusUntil)}` : ''}.`,
      'Gracias por apoyar a ConVía.',
      '',
      ...plusTips.map((tip, i) => `${i + 1}. ${tip.title}: ${tip.text}`),
      '',
      'No se renueva solo: te avisamos 3 días antes de que venza.',
      `Abrir ConVía: ${APP_URL}`,
    ].join('\n'),
  };
}
