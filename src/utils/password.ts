/**
 * One password policy for the whole app (sign-up, profile, any future reset).
 * Supabase requires at least 6 characters; WheelsApp asks for a bit more.
 */
export const PASSWORD_RULES = [
  { id: 'length', label: 'Al menos 8 caracteres', test: (value: string) => value.length >= 8 },
  { id: 'letter', label: 'Al menos una letra', test: (value: string) => /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(value) },
  { id: 'number', label: 'Al menos un número', test: (value: string) => /\d/.test(value) },
] as const;

export function passwordMeetsRules(value: string) {
  return PASSWORD_RULES.every((rule) => rule.test(value));
}

/**
 * Every problem with a new password and its confirmation, at once
 * (empty list = valid). Used to show all missing requirements together.
 */
export function passwordProblems(password: string, confirm: string): string[] {
  const problems: string[] = [];
  if (!password) {
    problems.push('Escribe una contraseña.');
  } else {
    const failing = PASSWORD_RULES.filter((rule) => !rule.test(password)).map((rule) => rule.label.toLowerCase());
    if (failing.length) problems.push(`La contraseña necesita: ${failing.join(', ')}.`);
  }
  if (!confirm) problems.push('Confirma la contraseña escribiéndola de nuevo.');
  else if (password && confirm !== password) problems.push('Las dos contraseñas no coinciden.');
  return problems;
}
