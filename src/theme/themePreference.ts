import { Appearance, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Display theme: light, dark or the phone's setting ("Sistema", the default).
 *
 * Read synchronously when the app starts (SecureStore.getItem on phones, localStorage on the
 * web), because every StyleSheet is created once from `colors`: the palette is chosen before
 * the first screen loads and does not change while the app runs. A new choice is applied by
 * reloading (immediately on the web, the next time the app opens on a phone).
 */
export type ThemePreference = 'system' | 'light' | 'dark';
export type ColorScheme = 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

const KEY = 'convia.theme';

function isPreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

// expo-secure-store has no web implementation: the web build keeps the choice in localStorage.
function readRaw(): string | null {
  if (Platform.OS === 'web') return typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
  return SecureStore.getItem(KEY);
}

export function readThemePreference(): ThemePreference {
  try {
    const saved = readRaw();
    return isPreference(saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

export function saveThemePreference(preference: ThemePreference) {
  if (Platform.OS === 'web') localStorage.setItem(KEY, preference);
  else SecureStore.setItem(KEY, preference);
}

/** The scheme a preference resolves to right now ('system' follows the phone or browser). */
export function resolveColorScheme(preference: ThemePreference): ColorScheme {
  if (preference !== 'system') return preference;
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}

/** Chosen once, when the app starts; `colors` uses it. */
export const startupPreference = readThemePreference();
export const activeColorScheme: ColorScheme = resolveColorScheme(startupPreference);
