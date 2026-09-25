import { Tabs } from 'expo-router';

import { BottomNavigation } from '@/components/navigation/BottomNavigation';

export default function TabsLayout() {
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
