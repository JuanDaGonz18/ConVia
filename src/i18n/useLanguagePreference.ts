import { useSyncExternalStore } from 'react';

import { getLanguagePreference, setLanguagePreference, subscribeLanguagePreference } from './index';

/** The language choice for selectors: [preference, change]. Kept on this device only. */
export function useLanguagePreference() {
  const preference = useSyncExternalStore(subscribeLanguagePreference, getLanguagePreference, getLanguagePreference);
  return [preference, setLanguagePreference] as const;
}
