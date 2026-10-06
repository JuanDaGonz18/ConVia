/**
 * Web version of "Recordarme": browsers have no secure keychain, so the
 * password is never saved. The browser's own password manager can still
 * offer to save it. The session itself stays open (Supabase keeps it).
 */
export const credentialStore = {
  async getRemembered(): Promise<{ email: string; password: string } | null> {
    return null;
  },

  async getPassword(_email: string): Promise<string | null> {
    return null;
  },

  async remember(_email: string, _password: string): Promise<void> {
    // Intentionally a no-op on web.
  },

  async forget(_email: string): Promise<void> {
    // Nothing is stored on web.
  },
};
