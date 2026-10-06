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
src/store/appStore   Global state (zustand)
src/utils/           Pure helpers: formatting, password rules, trip ranking, auth links
src/dev/             Development-only tools (disabled outside __DEV__)
supabase/            SQL migrations (apply in order) and Edge Functions (notify, delete-account)
```

Screens never call Supabase directly; they go through `src/services`. User-facing errors go through `errorMessage()` in `src/utils/format.ts` so users never see raw technical text.

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
