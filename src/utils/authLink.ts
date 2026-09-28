/**
 * Supabase email links (sign-up confirmation) come back to the app as
 * wheelsapp://callback?code=… on success, but report failures
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
