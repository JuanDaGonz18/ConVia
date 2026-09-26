import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';

import { authService } from '@/services/authService';
import { useAppStore } from '@/store/appStore';

export default function Index() {
  const authenticationState = useAppStore((state) => state.authenticationState);
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let isActive = true;

    void (async () => {
      try {
        const savedUser = await authService.getCurrentUser();
        if (isActive && savedUser) {
          setCurrentUser(savedUser);
        }
      } catch (error) {
        console.warn('[Auth] Could not restore the current session', error);
      }
      if (isActive) {
        setIsHydrated(true);
      }
    })();

    return () => {
      isActive = false;
    };
  }, [setCurrentUser]);

  if (!isHydrated) {
    return null;
  }

  if (authenticationState === 'authenticated') {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/(auth)/login" />;
}
