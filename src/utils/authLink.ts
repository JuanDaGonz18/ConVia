/**
 * Supabase email links (sign-up confirmation) come back to the app as
 * convia://callback?code=… on success, but report failures
 * (expired or reused links) in the URL fragment: #error=…&error_code=….
 * Expo Router params only include the query string, so both are read here.
 */
export type AuthLink = {
  code: string | null;
  errorCode: string | null;
  errorDescription: string | null;
};

function fragmentParams(url: string | null) {
  const hash = url?.split('#')[1];
  return new URLSearchParams(hash ?? '');
}

export function parseAuthLink(
  url: string | null,
  params: { code?: string; error?: string; error_code?: string; error_description?: string },
): AuthLink {
  const fragment = fragmentParams(url);
  const errorCode = params.error_code ?? fragment.get('error_code') ?? params.error ?? fragment.get('error');
  return {
    code: params.code ?? null,
    errorCode: errorCode || null,
    errorDescription: params.error_description ?? fragment.get('error_description'),
  };
}

/** A clear Spanish explanation for a failed confirmation link. */
export function authLinkErrorMessage(link: AuthLink) {
  const expired = link.errorCode === 'otp_expired' || /expired|invalid/i.test(link.errorDescription ?? '');
  return expired ? 'Este enlace de confirmación ya expiró o ya fue usado.' : 'No pudimos confirmar tu correo con este enlace.';
}

/** Reads code and error from a full redirect URL (query and fragment), e.g. after Microsoft sign-in. */
export function parseAuthUrl(url: string): AuthLink {
  const query = new URLSearchParams(url.split('#')[0].split('?')[1] ?? '');
  const get = (key: string) => query.get(key) ?? undefined;
  return parseAuthLink(url, { code: get('code'), error: get('error'), error_code: get('error_code'), error_description: get('error_description') });
}

/** A clear Spanish explanation for a failed Microsoft sign-in (the server never says more than needed). */
export function microsoftErrorMessage(link: Pick<AuthLink, 'errorCode' | 'errorDescription'>) {
  const text = `${link.errorCode ?? ''} ${link.errorDescription ?? ''}`;
  if (/TENANT_NO_AUTORIZADO|DOMINIO_NO_PERMITIDO|database error/i.test(text)) {
    return 'Tu cuenta de Microsoft no pertenece a una institución habilitada en ConVía. Entra con tu cuenta institucional.';
  }
  if (/access_denied|consent|AADSTS65001|AADSTS90094/i.test(text)) {
    return 'Microsoft no autorizó el acceso. Si tu universidad exige la aprobación de un administrador, pídele que habilite ConVía.';
  }
  return 'No pudimos iniciar sesión con Microsoft. Inténtalo de nuevo.';
}
