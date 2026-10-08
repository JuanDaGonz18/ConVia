import { Redirect, Tabs } from 'expo-router';
import { useEffect, useState } from 'react';

import { BottomNavigation } from '@/components/navigation/BottomNavigation';
import { authService } from '@/services/authService';
import { personalizationService } from '@/services/personalizationService';
import { useAppStore } from '@/store/appStore';

export default function TabsLayout() {
  const currentUser = useAppStore((state) => state.currentUser);
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const setSavedPlaces = useAppStore((state) => state.setSavedPlaces);
  const setFavoriteDriverIds = useAppStore((state) => state.setFavoriteDriverIds);
  const setSavedRoutes = useAppStore((state) => state.setSavedRoutes);
  const setPreferences = useAppStore((state) => state.setPreferences);
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

  // Saved places, favorite drivers, routes and preferences personalize trip lists; they are optional.
  const userId = currentUser?.id;
  useEffect(() => {
    if (!userId) return;
    let active = true;
    void Promise.all([
      personalizationService.getSavedPlaces(),
      personalizationService.getFavoriteDrivers(),
      personalizationService.getSavedRoutes(),
      personalizationService.getPreferences(),
    ])
      .then(([places, drivers, routes, preferences]) => {
        if (!active) return;
        setSavedPlaces(places);
        setFavoriteDriverIds(drivers.map((driver) => driver.id));
        setSavedRoutes(routes);
        setPreferences(preferences);
      })
      .catch((error) => console.warn('[personalization] Could not load saved places', error));
    return () => { active = false; };
  }, [setFavoriteDriverIds, setPreferences, setSavedPlaces, setSavedRoutes, userId]);

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
              { key: 'home', label: 'Inicio', icon: 'home-outline' },
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
