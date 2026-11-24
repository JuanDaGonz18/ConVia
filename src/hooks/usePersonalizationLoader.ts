import { useEffect } from 'react';

import { personalizationService } from '@/services/personalizationService';
import { useAppStore } from '@/store/appStore';

/**
 * Loads saved places, favorite drivers, routes and preferences once per signed-in user. Lives in
 * the root layout so screens opened directly (a link, a web reload, a notification) have them too,
 * not only after the tabs mounted. They personalize trip lists and are optional.
 */
export function usePersonalizationLoader() {
  const userId = useAppStore((state) => state.currentUser?.id);
  const setSavedPlaces = useAppStore((state) => state.setSavedPlaces);
  const setFavoriteDriverIds = useAppStore((state) => state.setFavoriteDriverIds);
  const setSavedRoutes = useAppStore((state) => state.setSavedRoutes);
  const setPreferences = useAppStore((state) => state.setPreferences);

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
}
