/**
 * ConVía+ paid by direct bank transfer (Bre-B), without a payment gateway (migration 047).
 *
 * The server decides everything: whether payments are on (app_config.payments_enabled plus a
 * key and payee), the price, the unique reference, the 3-pending limit and, after the team
 * checks the bank, the ConVía+ period. This file only parses what the server sends and turns
 * its error codes into Spanish messages. No React Native imports, so Node can test it.
 */

export type PaymentPeriod = 'monthly' | 'yearly';
export type PaymentStatus = 'draft' | 'pending' | 'granted' | 'rejected';

export type PaymentPrice = { period: PaymentPeriod; months: number; amountCop: number };

export type PaymentInfo =
  | { enabled: false }
  | { enabled: true; breBKey: string; payeeName: string; maxPending: number; prices: PaymentPrice[] };

/** What start_plus_payment returns: everything the person needs to make the transfer. */
export type PaymentInstructions = {
  reference: string;
  period: PaymentPeriod;
  months: number;
  amountCop: number;
  breBKey: string;
  payeeName: string;
};

export type PaymentRequest = {
  reference: string;
  period: PaymentPeriod;
  amountCop: number;
  status: PaymentStatus;
  rejectReason: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  periodEnd: string | null;
};

export const PAYMENTS_OFF: PaymentInfo = { enabled: false };

/** Same alphabet as private.new_payment_reference(): no 0/O or 1/I/L. */
export const REFERENCE_PATTERN = /^CV-[2-9A-HJKMNP-Z]{4}$/;

export function isValidReference(value: string) {
  return REFERENCE_PATTERN.test(value.trim().toUpperCase());
}

const isPeriod = (value: unknown): value is PaymentPeriod => value === 'monthly' || value === 'yearly';
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const positive = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null);

/** Anything unexpected (old server, payments off, missing key) means "off": the screen stays as before. */
export function parsePaymentInfo(raw: unknown): PaymentInfo {
  if (!raw || typeof raw !== 'object') return PAYMENTS_OFF;
  const row = raw as Record<string, unknown>;
  if (row.enabled !== true) return PAYMENTS_OFF;
  const breBKey = text(row.bre_b_key);
  const payeeName = text(row.payee_name);
  const prices = (Array.isArray(row.prices) ? row.prices : [])
    .map((item) => {
      const price = (item ?? {}) as Record<string, unknown>;
      const amountCop = positive(price.amount_cop);
      const months = positive(price.months);
      return isPeriod(price.period) && amountCop && months ? { period: price.period, months, amountCop } : null;
    })
    .filter((price): price is PaymentPrice => price !== null)
    .sort((a, b) => a.months - b.months);
  if (!breBKey || !payeeName || !prices.length) return PAYMENTS_OFF;
  return { enabled: true, breBKey, payeeName, maxPending: positive(row.max_pending) ?? 3, prices };
}

export function parseInstructions(raw: unknown): PaymentInstructions {
  const row = (raw ?? {}) as Record<string, unknown>;
  const reference = text(row.reference);
  const amountCop = positive(row.amount_cop);
  const months = positive(row.months);
  if (!isValidReference(reference) || !isPeriod(row.period) || !amountCop || !months) throw new Error('PAYMENT_START_FAILED');
  return { reference, period: row.period, months, amountCop, breBKey: text(row.bre_b_key), payeeName: text(row.payee_name) };
}

export function parsePaymentRequest(row: {
  reference: string;
  period: string;
  amount_cop: number;
  status: string;
  reject_reason: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  period_end: string | null;
}): PaymentRequest {
  const status = (['draft', 'pending', 'granted', 'rejected'].includes(row.status) ? row.status : 'pending') as PaymentStatus;
  return {
    reference: row.reference,
    period: row.period === 'yearly' ? 'yearly' : 'monthly',
    amountCop: row.amount_cop,
    status,
    rejectReason: row.reject_reason,
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
    periodEnd: row.period_end,
  };
}

/** "$12.000" — Colombian pesos without decimals, dot as thousands separator (no Intl needed). */
export function formatCop(amount: number) {
  const digits = String(Math.round(Math.abs(amount)));
  return `${amount < 0 ? '-' : ''}$${digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

export const PERIOD_LABEL: Record<PaymentPeriod, string> = { monthly: 'Mensual', yearly: 'Anual' };
export const PERIOD_SUFFIX: Record<PaymentPeriod, string> = { monthly: 'por 1 mes', yearly: 'por 12 meses' };

/** What the yearly price saves against paying monthly for 12 months; 0 if nothing. */
export function yearlySaving(prices: PaymentPrice[]) {
  const monthly = prices.find((price) => price.period === 'monthly');
  const yearly = prices.find((price) => price.period === 'yearly');
  if (!monthly || !yearly) return 0;
  return Math.max(0, monthly.amountCop * yearly.months - yearly.amountCop);
}

export function pendingCount(requests: PaymentRequest[]) {
  return requests.filter((request) => request.status === 'pending').length;
}

const ERRORS: Record<string, string> = {
  PAYMENTS_DISABLED: 'Los pagos de ConVía+ no están disponibles en este momento.',
  PAYMENTS_NOT_CONFIGURED: 'Los pagos de ConVía+ no están disponibles en este momento.',
  PAYMENT_PERIOD_INVALID: 'Elige el plan mensual o el anual.',
  PAYMENT_PENDING_LIMIT: 'Ya tienes 3 pagos esperando revisión. Te avisamos apenas los revisemos.',
  PAYMENT_NOT_FOUND: 'No encontramos esa referencia. Vuelve a empezar el pago.',
  PAYMENT_ALREADY_DECIDED: 'Ese pago ya fue revisado. Mira el estado abajo.',
  PAYMENT_RECEIPT_INVALID: 'No pudimos adjuntar el comprobante. Intenta de nuevo o envía el pago sin él.',
  PAYMENT_RECEIPT_UPLOAD_FAILED: 'No pudimos subir el comprobante. Intenta de nuevo o envía el pago sin él.',
  PAYMENT_START_FAILED: 'No pudimos generar tu referencia. Intenta de nuevo.',
};

/** Spanish message for a payment error code from the server, or null if it is not one. */
export function paymentErrorMessage(message: string | null | undefined): string | null {
  const code = /\b(PAYMENTS?_[A-Z_]+)\b/.exec(message ?? '')?.[1];
  return code && ERRORS[code] ? ERRORS[code] : null;
}
