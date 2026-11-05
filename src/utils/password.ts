import i18n from '@/i18n';
import { errorMessage, rawErrorMessage } from '@/utils/format';

/**
 * One password policy for the whole app (sign-up, profile, password reset).
 * Supabase requires at least 6 characters; ConVía asks for a bit more.
 * Labels come from the current language (password.rules.* in src/i18n/locales).
 */
const rule = (id: 'length' | 'letter' | 'number', test: (value: string) => boolean) => ({
  id,
  get label() {
    return i18n.t(`password.rules.${id}`);
  },
  test,
});

export const PASSWORD_RULES = [
  rule('length', (value) => value.length >= 8),
  rule('letter', (value) => /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(value)),
  rule('number', (value) => /\d/.test(value)),
] as const;

export function passwordMeetsRules(value: string) {
  return PASSWORD_RULES.every((item) => item.test(value));
}

/** Labels of the rules a password still breaks, lowercased to go inside a sentence. */
export function missingPasswordRules(password: string) {
  return PASSWORD_RULES.filter((item) => !item.test(password)).map((item) => item.label.toLowerCase());
}

/**
 * Every problem with a new password and its confirmation, at once
 * (empty list = valid). Used to show all missing requirements together.
 */
export function passwordProblems(password: string, confirm: string): string[] {
  return Object.values(passwordFieldErrors(password, confirm)).filter((problem): problem is string => !!problem);
}

/** The same checks, split by field so each message shows under its own field. */
export function passwordFieldErrors(password: string, confirm: string): { password?: string; confirm?: string } {
  const errors: { password?: string; confirm?: string } = {};
  if (!password) errors.password = i18n.t('password.errors.empty');
  else {
    const failing = missingPasswordRules(password);
    if (failing.length) errors.password = i18n.t('password.errors.missing', { rules: failing.join(', ') });
  }
  if (!confirm) errors.confirm = i18n.t('password.errors.confirmEmpty');
  else if (password && confirm !== password) errors.confirm = i18n.t('password.errors.mismatch');
  return errors;
}

/** Supabase errors when setting a new password, in words the user can act on. */
export function passwordErrorMessage(error: unknown) {
  const raw = rawErrorMessage(error);
  if (/different from the old/i.test(raw)) return i18n.t('password.errors.sameAsOld');
  if (/reauthentication|recent/i.test(raw)) return i18n.t('password.errors.reauthenticate');
  if (/weak|at least|characters/i.test(raw)) return i18n.t('password.errors.weak');
  return errorMessage(error, i18n.t('password.errors.changeFailed'));
}
