# Capturas de la landing

Las imágenes de `web-landing/img/` salen de la app real (export web) conectada a un
**backend falso local**: Playwright intercepta todas las llamadas a
`http://demo.localhost:8092` y responde con `fixtures.mjs`. No se contacta Supabase y
todos los datos son ficticios (nombres inventados, correos `@example.com`, placas `DEM-00x`).

Las herramientas (Playwright, sharp) no son dependencias del proyecto; instálalas aparte:

```bash
# 1. App web apuntando al backend falso
EXPO_PUBLIC_USE_SUPABASE=true EXPO_PUBLIC_SUPABASE_URL=http://demo.localhost:8092 \
EXPO_PUBLIC_SUPABASE_ANON_KEY=demo-anon-key \
  npx expo export --platform web --output-dir ../fake-dist

# 2. Herramientas en una carpeta aparte
mkdir ../shot-tools && cd ../shot-tools && npm init -y && npm i playwright sharp @fontsource-variable/inter
npx playwright install chromium
cp ../wheelsapp/scripts/landing-shots/*.mjs .

# 3. Servir la app (SPA) y capturar 390×844 @3x, tema claro, español
node serve.mjs ../fake-dist 8093 spa &
node capture.mjs ../raw

# 4. WebP optimizados, og-image, favicons y la fuente Inter
node images.mjs ../raw ../wheelsapp/web-landing ../wheelsapp/assets/icon.png \
  node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2
```
