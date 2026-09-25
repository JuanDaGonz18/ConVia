# WHEELSAPP - Project Analysis

## Source Of Truth

Figma file: private project document (URL intentionally omitted).

The Figma file is the visual source of truth. The provided URL targets the document page (`0:1`). In this environment, Figma metadata could list the page, but detailed render/context calls rejected that page node as an invalid code target. Phase 1 therefore implements the architecture, design tokens, and reusable component foundation from the provided product brief and observed token list. Pixel-level screen implementation should be validated against concrete frame node URLs or direct frame selections before each later phase.

## Screen Map

### Auth

- Onboarding: hero image, pagination dots, title, description, primary CTA.
- Login: top image, "Iniciar Sesion", email field, password field, forgot password action, login CTA, registration option.
- Register: progress bar, "Registrar", "Crea una cuenta", fields, terms checkbox, continue CTA.
- Select role: "Personaliza tu experiencia", "Escoge tu rol:", Client and Driver choices.
- Register vehicle: "Registra tu carro", vehicle data fields, vehicle photo upload.

### Client

- Home / Map: full-screen map, search bar, location pins, plus action, trip information, bottom navigation.
- Search: search bar and recent searches.
- Search Results: search bar, filters, vertical trip cards.
- Filters: trip filter controls and fixed bottom apply button.
- Trip Details / Request / Status: driver info, trip drawer, status progression, request and cancellation actions.
- Trips: current and past trips.
- Profile: centered avatar, name, role, settings list, logout action.

### Driver

- Driver Home: map with driver location and available trips.
- Available / Requests / Accepted Trips: split pending and accepted rides.
- Trip Details: trip and passenger information.
- Passengers: passenger cards with avatar, address, rating, status, and actions.
- QR Scanner: mock-ready QR scan flow for passenger validation.
- Profile: conductor profile and settings.

### Modal

- Logout: overlay with two-button confirmation dialog.
- Future face verification: verification screen with idle, processing, verified, failed, retry states.

## Navigation

- Expo Router route groups:
  - `app/(auth)`
  - `app/(client)`
  - `app/(driver)`
  - `app/modal`
- Initial demo route should start at onboarding/login, then branch by selected role.
- Bottom navigation options stay role-aware but structurally identical:
  - Inicio / Mapa
  - Viajes
  - Perfil

## Components

Base UI:

- `ButtonPrimary`
- `ButtonSecondary`
- `TextField`
- `SearchBar`
- `FilterButton`
- `ListItem`
- `Avatar`
- `Rating`
- `StarRating`
- `Divider`
- `StatusBadge`
- `ProgressBar`
- `Checkbox`
- `ConfirmDialog`
- `AppModal`
- `Drawer`
- `PaginationDots`
- `EmptyState`
- `LoadingState`

Navigation:

- `BottomNavigation`
- `TopNavigation`

Map / trip / profile:

- `MapContainer`
- `LocationPin`
- `TripCard`
- `DriverCard`
- `PassengerCard`
- `VehicleCard`

## Design Tokens

### Colors

- Primary Blue: `#006FFD`
- Dark Text: `#1F2024`
- Border / Secondary Gray: `#C5C6CC`
- Light Gray: `#E8E9F1`
- Very Light Blue: `#EAF2FF`
- White: `#FFFFFF`

Tokens are implemented in `src/constants/colors.ts` and should be imported from there instead of using raw hex values in screens.

### Typography

The app should use Inter where available and a system fallback with an iOS-like feel. Tokens:

- `headingXL`
- `headingL`
- `headingM`
- `body`
- `bodyMedium`
- `bodySmall`
- `caption`
- `button`
- `label`

### Spacing

The spacing scale is `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`. Main mobile content targets `327px` inside `375px` view width.

### Radius

- `radiusSmall`
- `radiusMedium`
- `radiusLarge`
- `radiusXL`
- `radiusFull`

## States

- Auth: unauthenticated, authenticated, onboarding, selecting role.
- User role: client, driver.
- Trip status: pending, accepted, driver_arriving, started, completed, cancelled.
- Face verification: idle, processing, verified, failed, retry.
- Component states: default, pressed, disabled, loading, error, selected.

## Entities

- User
- Driver
- Passenger
- Vehicle
- Trip
- Location
- Rating
- Notification

## User Flows

### Client

Register -> Login -> Select role -> Client map -> Search destination -> Search results -> Filters -> Trip details -> Request trip -> Pending -> Accepted -> Driver arriving -> Started -> Completed.

### Driver

Register -> Register vehicle -> Driver map -> View available trips -> Accept request -> View passengers -> Scan QR -> Start trip -> Complete trip.

### Shared

Profile -> Settings -> Logout confirmation.

## Dependencies

- React Native
- Expo
- TypeScript
- Expo Router
- React Native Maps
- React Native Reanimated
- React Native Gesture Handler
- React Native Safe Area Context
- Expo Camera
- Expo Image Picker
- Expo Location
- Expo Secure Store
- Zustand
- Expo Vector Icons

## Architecture

```
app/
src/
  components/
    ui/
    navigation/
    map/
    trip/
    profile/
    forms/
  constants/
  data/mock/
  hooks/
  services/
  store/
  types/
  utils/
```

Services initially return mock data and should preserve API-shaped boundaries for later backend integration. Screens must not import mock arrays directly.

## Phase Plan

1. Project setup, theme, tokens, base components.
2. Authentication flow.
3. Client flow.
4. Driver flow.
5. Profile.
6. Map.
7. Complete trip flow.
8. QR.
9. Face verification preparation.
10. Testing and visual refinement.
