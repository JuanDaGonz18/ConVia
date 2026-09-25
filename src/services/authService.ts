import * as SecureStore from 'expo-secure-store';

import { User, UserRole } from '@/types';

const SESSION_KEY = 'wheelsapp.demo.session';

export const authService = {
  async login(email: string): Promise<User> {
    const user: User = {
      id: 'mock-user-current',
      name: 'Merchito',
      email,
      role: 'client',
    };

    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify({ userId: user.id }));
    return user;
  },
  async register(name: string, email: string, role: UserRole): Promise<User> {
    return {
      id: 'mock-user-registered',
      name,
      email,
      role,
    };
  },
  async logout(): Promise<void> {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  },
};
