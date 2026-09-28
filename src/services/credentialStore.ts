import * as SecureStore from 'expo-secure-store';

/**
 * "Recordarme": saves the email and password in the platform's secure storage
 * (Android Keystore / iOS Keychain, via expo-secure-store). Nothing is sent to
 * Supabase and nothing is kept in plain text.
 */

const LAST_KEY = 'wheelsapp.remember.last';

/** SecureStore keys may only contain letters, numbers, ".", "-" and "_". */
function passwordKey(email: string) {
  return `wheelsapp.remember.pw.${email.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_')}`;
}

async function safely<T>(action: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await action();
  } catch {
    // Secure storage can be unavailable (e.g. keystore reset); the login still works without it.
    return fallback;
  }
}

export const credentialStore = {
  /** The account saved with "Recordarme", if any. */
  async getRemembered(): Promise<{ email: string; password: string } | null> {
    return safely(async () => {
      const email = await SecureStore.getItemAsync(LAST_KEY);
      if (!email) return null;
      const password = await SecureStore.getItemAsync(passwordKey(email));
      return password ? { email, password } : null;
    }, null);
  },

  /** Saved password for a specific email (used to fill the form). */
  async getPassword(email: string): Promise<string | null> {
    return safely(() => SecureStore.getItemAsync(passwordKey(email)), null);
  },

  async remember(email: string, password: string): Promise<void> {
    await safely(async () => {
      await SecureStore.setItemAsync(passwordKey(email), password);
      await SecureStore.setItemAsync(LAST_KEY, email.trim().toLowerCase());
    }, undefined);
  },

  /** Deletes the saved password for this email (and the "last account" pointer if it matches). */
  async forget(email: string): Promise<void> {
    await safely(async () => {
      await SecureStore.deleteItemAsync(passwordKey(email));
      const last = await SecureStore.getItemAsync(LAST_KEY);
      if (last === email.trim().toLowerCase()) await SecureStore.deleteItemAsync(LAST_KEY);
    }, undefined);
  },
};
