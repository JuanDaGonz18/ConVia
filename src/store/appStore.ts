import { create } from 'zustand';

import {
  FaceVerificationState,
  Location,
  Notification,
  Trip,
  User,
  UserRole,
  Vehicle,
} from '@/types';

type AuthState = 'anonymous' | 'authenticated';

type AppStore = {
  authenticationState: AuthState;
  currentUser: User | null;
  role: UserRole | null;
  currentLocation: Location | null;
  selectedDestination: Location | null;
  selectedTrip: Trip | null;
  currentTrip: Trip | null;
  vehicle: Vehicle | null;
  notifications: Notification[];
  // ── Face Verification ────────────────────────────────
  /** Estado del flujo de verificación facial en curso */
  faceVerificationState: FaceVerificationState;
  /** sessionId de Liveness activo */
  activeLivenessSessionId: string | null;
  /** Setters */
  setCurrentUser: (user: User | null) => void;
  setRole: (role: UserRole) => void;
  setSelectedTrip: (trip: Trip | null) => void;
  setCurrentTrip: (trip: Trip | null) => void;
  setVehicle: (vehicle: Vehicle | null) => void;
  setFaceVerificationState: (state: FaceVerificationState) => void;
  setActiveLivenessSessionId: (id: string | null) => void;
  /** Marca al usuario actual como verificado facialmente */
  markUserFaceVerified: (faceReferenceId: string) => void;
  logout: () => void;
};

export const useAppStore = create<AppStore>((set) => ({
  authenticationState: 'anonymous',
  currentUser: null,
  role: null,
  currentLocation: null,
  selectedDestination: null,
  selectedTrip: null,
  currentTrip: null,
  vehicle: null,
  notifications: [],
  faceVerificationState: 'IDLE',
  activeLivenessSessionId: null,

  setCurrentUser: (user) =>
    set({
      currentUser: user,
      role: user?.role ?? null,
      authenticationState: user ? 'authenticated' : 'anonymous',
    }),

  setRole: (role) => set({ role }),
  setSelectedTrip: (trip) => set({ selectedTrip: trip }),
  setCurrentTrip: (trip) => set({ currentTrip: trip }),
  setVehicle: (vehicle) => set({ vehicle }),

  setFaceVerificationState: (faceVerificationState) =>
    set({ faceVerificationState }),

  setActiveLivenessSessionId: (activeLivenessSessionId) =>
    set({ activeLivenessSessionId }),

  markUserFaceVerified: (faceReferenceId) =>
    set((state) => ({
      currentUser: state.currentUser
        ? {
            ...state.currentUser,
            faceVerified: true,
            faceReferenceId,
            faceVerifiedAt: new Date().toISOString(),
          }
        : null,
    })),

  logout: () =>
    set({
      authenticationState: 'anonymous',
      currentUser: null,
      role: null,
      selectedDestination: null,
      selectedTrip: null,
      currentTrip: null,
      vehicle: null,
      notifications: [],
      faceVerificationState: 'IDLE',
      activeLivenessSessionId: null,
    }),
}));
