# ConVía

Carpooling app for university communities. Built with Expo (SDK 57) + Expo Router and a Supabase backend.

## Getting started

```bash
npm install
cp .env.example .env          # set EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY, EXPO_PUBLIC_USE_SUPABASE=true
npx expo run:android          # native modules (camera, maps, ML Kit) need a development build, not Expo Go
npx expo start                # later runs: just the dev server
```

With `EXPO_PUBLIC_USE_SUPABASE=false` the app runs on mock data (`src/data/mock`), and the login screen offers demo accounts.

Before committing:

```bash
npm run typecheck && npm run lint && npx expo-doctor
```

### Builds (EAS)

| Profile       | Output | Use                               |
| ------------- | ------ | --------------------------------- |
| `development` | APK    | Dev client connected to Metro     |
| `preview`     | APK    | Standalone install for testing    |
| `production`  | AAB    | Store submission                  |

```bash
npx eas-cli@latest build --profile preview --platform android
```

`.env` is not uploaded to EAS: the `EXPO_PUBLIC_*` variables for each profile live in EAS environment variables. Changes to `app.json` (permission texts, plugins) need a new native build; JS-only changes do not.

## Project layout

```
app/                 Screens (Expo Router). (auth) = login/registration, (tabs) = main tabs
src/components/      brand/ ui/ forms/ map/ trip/ chat/ face/ profile/ navigation/
src/constants/       Design tokens: colors, typography, spacing, radius, dimensions
src/services/        All Supabase access (one service per domain)
src/subscription/    FREE / ConVía+ plan model, usePlan() hook
src/maps/            Map abstraction (AppMap, MapMarker, MapLine) and its providers
src/store/appStore   Global state (zustand)
src/utils/           Pure helpers: formatting, password rules, trip ranking, auth links
src/dev/             Development-only tools (disabled outside __DEV__)
supabase/            SQL migrations (apply in order) and Edge Functions (notify, delete-account)
```

Screens never call Supabase directly; they go through `src/services`. User-facing errors go through `errorMessage()` in `src/utils/format.ts` so users never see raw technical text.

## Plans: FREE and ConVía+

The plan always comes from the backend; the app only reads it.

- **Database (source of truth):** `plans` holds what each tier includes (`limits` such as `{"vehicles": 1}`, where a missing key means unlimited, and `features` such as `{google_maps,map_traffic}`). `subscriptions` holds each user's tier, status, optional `current_period_end` and payment-provider ids; no row means FREE. Users can read their own row but never write it. Limits are enforced by triggers (`LIMITE_PLAN:<key>:<limit>` errors), so a modified client cannot bypass them.
- **App:** `src/subscription/plans.ts` lists the limit/feature keys, fallback values (mirror of the DB seed) and the copy that explains each feature. `usePlan()` gives `isPlus`, `has(feature)`, `limit(key)` and `atLimit(key, used)`. `<SubscriptionSync />` (root layout) loads the plan when the user changes.
- **Upsell:** call `requirePlus({ feature })` or `requirePlus({ limit })` to explain a ConVía+ feature; it opens one shared dialog that links to `/plus`. Never hide features silently or block unrelated actions.

Adding a premium feature: add the key to `PlanFeature` + `FEATURE_INFO`, add it to `plans.features` for `plus` in the database, and check it with `usePlan().has(...)`. Adding a new limit: add the key to `PlanLimit` + `LIMIT_INFO`, set it in `plans.limits`, and enforce it with a trigger that calls `private.plan_limit(user, '<key>')`.

Granting ConVía+ by hand (until a payment provider is connected), in the Supabase SQL editor:

```sql
insert into public.subscriptions (user_id, tier, status, provider, current_period_end)
select id, 'plus', 'active', 'manual', null from public.profiles where email = 'someone@unisabana.edu.co'
on conflict (user_id) do update set tier = 'plus', status = 'active', provider = 'manual', current_period_end = null;
-- Back to FREE: update public.subscriptions set status = 'canceled' where user_id = '<uuid>';
```

## Maps

Screens use `AppMap`, `MapMarker` and `MapLine` from `@/maps` and never import a map SDK. The provider is picked in one place (`useMapProviderId()`), from the plan:

| | FREE | ConVía+ |
| --- | --- | --- |
| Map rendering | MapLibre + OpenFreeMap (OpenStreetMap vector tiles) | Google Maps SDK via `react-native-maps` (Apple Maps on iOS) |
| Place search | Photon (OSM) + device geocoder | same |
| Reverse geocoding | device geocoder | same |
| Routes | OSRM | same |
| Traffic layer | – | yes |

The Google provider module is loaded with a lazy `require` the first time a ConVía+ user opens a map, so the Google Maps SDK is never initialized for FREE users. Search, routing and geocoding are already provider-independent (`src/services/locationService.ts`).

## External services and limits

| Service | Used for | Cost / limits | Notes |
| --- | --- | --- | --- |
| Supabase (Free plan) | Auth, DB, storage, Edge Functions | 500 MB DB, 1 GB storage, 50k MAU; projects pause after 1 week without activity | Upgrade to Pro (USD 25/mo) before a public launch |
| OpenFreeMap | FREE map tiles | Free, no key, no request limits | Community-funded, no SLA. Keep the attribution button visible (OpenStreetMap ODbL) |
| Google Maps SDK for Android | ConVía+ map | Mobile SDK map loads are free; requires a key with billing enabled | Restrict the key to the app package + SHA-1 and to "Maps SDK for Android" |
| Photon (komoot) | Place search | Free public instance, fair use, no SLA | Not suitable for heavy production traffic; self-host or use a paid geocoder later |
| OSRM demo server | Road routes | Free, demo only, no SLA | Same as above; the app falls back to a straight line when it fails |
| Device geocoder | Addresses / reverse geocoding | Free, no key | Quality depends on the phone (Google Play services on Android) |
| Expo push + Firebase Cloud Messaging | Push notifications | Free | — |
| EAS Build (Free plan) | APK builds | Limited monthly builds, queued | — |

## Brand

- The app, and its logo, is **ConVía**: "Con" in the text color and "Vía" in `colors.primary` (#006FFD). There is no separate symbol; the wordmark is the logo.
- In the UI use `<BrandLogo />` (standalone logo) or `<ConVia />` (inline in text) from `src/components/brand/Brand.tsx`; never type the colors by hand.
- App icons in `assets/` are the same wordmark on white. Internal identifiers (`wheelsapp://` scheme, Android package, EAS slug, storage keys) keep the old name on purpose: changing them would break sign-in links, installs and saved sessions.

## UI building blocks

Use these instead of ad-hoc styles so every screen feels the same:

| Component | Use it for |
| --- | --- |
| `ScreenHeader` | Back button + kicker + title on stack screens |
| `ButtonPrimary` / `ButtonSecondary` | Actions; support `loading`, `icon`, `tone="danger"` |
| `PressableScale` | Any tappable card (subtle press feedback) |
| `TextField`, `PasswordField`, `PlaceSearchField` | Form inputs with label, hint and inline error |
| `Notice` | Inline info / success / warning / error messages, with optional action |
| `toast.success/info/error()` | Short confirmation after an action succeeds |
| `ConfirmDialog` | Confirming actions; `tone="danger"` for destructive ones |
| `EmptyState` | Empty lists and recoverable errors (with an action) |
| `TripListSkeleton`, `RowSkeleton`, `Skeleton` | Loading placeholders instead of spinners |

Animations are subtle by design: native-driver springs and fades only.

## Passwords

Rules live in `src/utils/password.ts` (`PASSWORD_RULES`: at least 8 characters, one letter, one number). Any screen that creates or changes a password must:

1. Use two `PasswordField`s: "Contraseña" and "Confirmar contraseña" (both have the show/hide eye).
2. Show `PasswordChecklist` for live feedback.
3. Validate with `passwordProblems(password, confirm)` and show **all** problems at once.

Currently used in registration and in Profile → Edit profile → Change password. There is no password recovery by email (it needs custom SMTP in Supabase); if you add it, follow the same three steps.

"Recordarme" stores credentials only in the device's secure storage (`expo-secure-store`); never in plain text or in Supabase.

## Security notes

- Row Level Security is enabled on every table; sensitive actions go through `security definer` RPCs in the migrations.
- Face verification: the phone turns the selfie into a numeric embedding; the photo is never uploaded. The registered template is compared server-side (`submit_face_embedding`) and is never sent back to the client.
- Never commit `.env`, `google-services.json`, or Firebase Admin SDK keys (all are gitignored). The service role key belongs only in Edge Function secrets.
- `EXPO_PUBLIC_*` values are bundled into the app: only the Supabase URL and the publishable (anon) key belong there. The Google Maps key is injected at build time from the `GOOGLE_MAPS_API_KEY` EAS variable; Android map keys are inherently readable from the APK, so protect it with key restrictions, not secrecy.
- Plan limits and premium access are decided by the database (`plans`, `subscriptions`, triggers), never by the client.
