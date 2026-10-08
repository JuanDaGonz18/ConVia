import { create } from 'zustand';

import type { TimePreference } from '@/services/tripMatching';
import { FaceVerificationState, Location, SavedPlace, Trip, User } from '@/types';

type AuthState = 'anonymous' | 'authenticated';

type AppStore = {
  authenticationState: AuthState;
  currentUser: User | null;
  /** Trip opened from a list, shown by the trip-details screen. */
  selectedTrip: Trip | null;
  /** Step of the face verification flow currently on screen. */
  faceVerificationState: FaceVerificationState;
  /** Optional places used to prioritize trips (loaded after sign-in). */
  savedPlaces: SavedPlace[];
  favoriteDriverIds: string[];
  /** The passenger's current search, reused by the map and when requesting a seat. */
  tripSearch: { destination: Location | null; time: TimePreference };
  setTripSearch: (search: Partial<AppStore['tripSearch']>) => void;
  setCurrentUser: (user: User | null) => void;
  setSavedPlaces: (places: SavedPlace[]) => void;
  setFavoriteDriverIds: (ids: string[]) => void;
  setSelectedTrip: (trip: Trip | null) => void;
  setFaceVerificationState: (state: FaceVerificationState) => void;
  /** The server confirmed the user's face (registration or a later check). */
  markFaceVerified: () => void;
  logout: () => void;
};

export const useAppStore = create<AppStore>((set) => ({
  authenticationState: 'anonymous',
  currentUser: null,
  selectedTrip: null,
  faceVerificationState: 'IDLE',
  savedPlaces: [],
  favoriteDriverIds: [],
  tripSearch: { destination: null, time: 'any' },

  setTripSearch: (search) => set((state) => ({ tripSearch: { ...state.tripSearch, ...search } })),

  setSavedPlaces: (savedPlaces) => set({ savedPlaces }),
  setFavoriteDriverIds: (favoriteDriverIds) => set({ favoriteDriverIds }),

  setCurrentUser: (user) =>
    set((state) => {
      // Another account (or none) must not see the previous user's places.
      const sameUser = !!user && state.currentUser?.id === user.id;
      return {
        currentUser: user,
        authenticationState: user ? 'authenticated' : 'anonymous',
        savedPlaces: sameUser ? state.savedPlaces : [],
        favoriteDriverIds: sameUser ? state.favoriteDriverIds : [],
      };
    }),

  setSelectedTrip: (trip) => set({ selectedTrip: trip }),

  setFaceVerificationState: (faceVerificationState) => set({ faceVerificationState }),

  markFaceVerified: () =>
    set((state) => ({
      currentUser: state.currentUser
        ? { ...state.currentUser, faceVerified: true, faceVerifiedAt: new Date().toISOString() }
        : null,
    })),

  logout: () =>
    set({
      authenticationState: 'anonymous',
      currentUser: null,
      selectedTrip: null,
      faceVerificationState: 'IDLE',
      savedPlaces: [],
      favoriteDriverIds: [],
      tripSearch: { destination: null, time: 'any' },
    }),
}));
