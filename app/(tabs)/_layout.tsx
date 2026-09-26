import { Redirect, Tabs } from 'expo-router';
import { useEffect, useState } from 'react';

import { BottomNavigation } from '@/components/navigation/BottomNavigation';
import { authService } from '@/services/authService';
import { useAppStore } from '@/store/appStore';

export default function TabsLayout() {
  const currentUser = useAppStore((state) => state.currentUser);
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    void authService.getCurrentUser().then((user) => {
      if (!active) return;
      if (user) setCurrentUser(user);
      setIsHydrated(true);
    }).catch(() => {
      if (active) setIsHydrated(true);
    });
    return () => { active = false; };
  }, [setCurrentUser]);

  if (!isHydrated) return null;
  if (!currentUser) return <Redirect href="/(auth)/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
      }}
      tabBar={({ navigation, state }) => {
        const routeName = state.routes[state.index].name;
        const activeKey = routeName === 'index' ? 'home' : routeName;

        return (
          <BottomNavigation
            activeKey={activeKey}
            items={[
              { key: 'home', label: 'Inicio', icon: 'map-outline' },
              { key: 'trips', label: 'Viajes', icon: 'car-outline' },
              { key: 'chats', label: 'Chats', icon: 'chatbubbles-outline' },
              { key: 'profile', label: 'Perfil', icon: 'person-outline' },
            ]}
            onPress={(key) => {
              const targetRoute = key === 'home' ? 'index' : key;
              navigation.navigate(targetRoute);
            }}
          />
        );
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Inicio' }} />
      <Tabs.Screen name="trips" options={{ title: 'Viajes' }} />
      <Tabs.Screen name="chats" options={{ title: 'Chats' }} />
      <Tabs.Screen name="profile" options={{ title: 'Perfil' }} />
    </Tabs>
  );
}
