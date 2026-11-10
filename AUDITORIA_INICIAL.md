# Auditoría inicial — ConVía (Brandon Merchán)

Fecha: 2026-11-10. Repositorio: https://github.com/JuanDaGonz18/ConVia.git (rama `main`, commit a337d6b). Trabajo en la rama `feat/brandon-capstone-deliverables`.

Nota: la carpeta local `WheelsApp` es una copia anterior (SDK 57, sin CI ni pruebas, 19 migraciones). La auditoría y los cambios se hicieron sobre ConVia.

## Stack
Expo SDK 58 + Expo Router, React Native 0.88, TypeScript, Zustand, i18next (es/en), Supabase (Auth, Postgres con RLS, Storage, Edge Functions en Deno), MapLibre/Leaflet, ONNX/SFace + ML Kit para rostro en el dispositivo. Versión web publicada con GitHub Pages (`.github/workflows/web.yml`). Node 24 en CI.

## Estado por responsabilidad
| Responsabilidad | Clasificación | Evidencia |
|---|---|---|
| Wireframes y prototipo | Implementada parcialmente | Pantallas en `app/`; demo web compila y carga (`Evidencias/captura_web_*.png`). Figma no abierto; sin pruebas con usuarios. |
| Seguridad y autenticación | Implementada parcialmente | RLS y privilegios en `supabase/migrations/*003, 005, 030, 039, 040`; pruebas SQL en `supabase/tests/` (no ejecutadas: Docker inactivo). Recuperación de contraseña en `app/(auth)/forgot-password.tsx`, `reset-password.tsx`. |
| Entorno de desarrollo | Implementada y verificada (parcial en CI/Supabase local) | `npm ci`, `npx tsc --noEmit`, `npx expo lint`, `expo export -p web` correctos. `npm test` fallaba en Node 22.14. |
| Pruebas unitarias | Implementada parcialmente | 89 pruebas de app + 161 de funciones existentes, pasan con `--experimental-strip-types`. Sin pruebas de contraseñas ni de `errorMessage`. |
| Canal de retroalimentación | Pendiente al inicio | Sin formulario, tabla ni función (búsqueda en `app/`, `src/`, migraciones). |

## Hallazgos
1. `npm test` en Node 22.14.0: 12 de 12 archivos fallan con `ERR_UNKNOWN_FILE_EXTENSION` (`Evidencias/npm_test_node22.log`). Causa: Node < 22.18 no ejecuta `.ts` sin `--experimental-strip-types`.
2. README decía SDK 57; `package.json` usa SDK 58.
3. No existe canal de reportes.
4. Opción "Recordarme" guarda la contraseña en SecureStore (opt-in).
5. Pruebas SQL y E2E dependen de Docker/Supabase local; no ejecutadas en esta auditoría.
6. No verificable con los recursos disponibles: Figma, proyecto Supabase alojado, despliegue real de Pages, dispositivos.
