/**
 * TEMPORARY — development/testing only.
 *
 * Keeps a list of accounts that signed in on this device so testers can switch
 * accounts quickly. Only emails, names and roles are listed here (in secure
 * storage); passwords live in credentialStore and only when "Recordarme" was
 * checked. Disabled outside development builds.
 *
 * To remove: delete the src/dev/ folder and the <SavedUsersPanel /> and
 * `savedUsers.add(...)` lines in app/(auth)/login.tsx.
 */
import * as SecureStore from 'expo-secure-store';

import { UserRole } from '@/types';

export const SAVED_USERS_ENABLED = __DEV__;

const LIST_KEY = 'wheelsapp.dev.savedUsers';
const MAX_USERS = 10;

export type SavedUser = {
  email: string;
  name: string;
  role: UserRole;
  lastUsedAt: string;
};

async function read(): Promise<SavedUser[]> {
  try {
    const raw = await SecureStore.getItemAsync(LIST_KEY);
    return raw ? (JSON.parse(raw) as SavedUser[]) : [];
  } catch {
    return [];
  }
}

async function write(users: SavedUser[]) {
  try {
    await SecureStore.setItemAsync(LIST_KEY, JSON.stringify(users.slice(0, MAX_USERS)));
  } catch {
    // Testing helper only: ignore storage problems.
  }
}

export const savedUsers = {
  async list(): Promise<SavedUser[]> {
    if (!SAVED_USERS_ENABLED) return [];
    return (await read()).sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  },

  /** Called after every successful sign-in; most recent first. */
  async add(user: Omit<SavedUser, 'lastUsedAt'>) {
    if (!SAVED_USERS_ENABLED) return;
    const email = user.email.trim().toLowerCase();
    const others = (await read()).filter((item) => item.email !== email);
    await write([{ ...user, email, lastUsedAt: new Date().toISOString() }, ...others]);
  },

  async remove(email: string) {
    if (!SAVED_USERS_ENABLED) return;
    await write((await read()).filter((item) => item.email !== email));
  },
};
