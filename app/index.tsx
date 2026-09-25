import { Redirect } from 'expo-router';

import { useAppStore } from '@/store/appStore';

export default function Index() {
  const authenticationState = useAppStore((state) => state.authenticationState);

  if (authenticationState === 'authenticated') {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/(auth)/login" />;
}
