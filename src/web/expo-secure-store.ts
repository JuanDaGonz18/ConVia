/**
 * Web stand-in for expo-secure-store (which has no web implementation).
 * metro.config.js points `expo-secure-store` here for web builds only.
 *
 * Browsers have no keychain, so values go to localStorage — the same place
 * Supabase keeps its session in any web app. Passwords are never stored on
 * web: see credentialStore.web.ts.
 */
const PREFIX = 'convia.secure.';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const WHEN_UNLOCKED = 0;
export const AFTER_FIRST_UNLOCK = 1;
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 2;
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 3;
export const WHEN_PASSCODE_SET_THIS_DEVICE_ONLY = 4;

export async function isAvailableAsync() {
  return storage() !== null;
}

export async function getItemAsync(key: string): Promise<string | null> {
  return storage()?.getItem(PREFIX + key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  storage()?.setItem(PREFIX + key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  storage()?.removeItem(PREFIX + key);
}

export function getItem(key: string): string | null {
  return storage()?.getItem(PREFIX + key) ?? null;
}

export function setItem(key: string, value: string): void {
  storage()?.setItem(PREFIX + key, value);
}

export function canUseBiometricAuthentication() {
  return false;
}
