/**
 * Assembles the public site that GitHub Pages serves:
 *
 *   site/            ← web-landing/ (download page for Android + iPhone)
 *   site/app/        ← `expo export -p web` output (the app iPhone users open in Safari)
 *
 * and turns the web app into an installable PWA ("Agregar a pantalla de inicio"):
 * icon, manifest, iOS meta tags and an SPA fallback so deep links such as
 * /app/callback (e-mail confirmation) load the app instead of a 404.
 *
 * Usage: node scripts/prepare-web.mjs <expo-export-dir> <site-dir> <app-base-url>
 */
import { copyFileSync, cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [exportDir = 'dist', siteDir = 'site', baseUrl = '/app'] = process.argv.slice(2);
const root = resolve(import.meta.dirname, '..');
const site = resolve(root, siteDir);
const app = join(site, 'app');

rmSync(site, { recursive: true, force: true });
cpSync(join(root, 'web-landing'), site, { recursive: true });
cpSync(resolve(root, exportDir), app, { recursive: true });

// Icons for the home screen and the manifest.
copyFileSync(join(root, 'assets/icon.png'), join(app, 'apple-touch-icon.png'));
copyFileSync(join(root, 'assets/icon.png'), join(app, 'icon-1024.png'));
copyFileSync(join(root, 'assets/icon.png'), join(site, 'apple-touch-icon.png'));

const manifest = {
  name: 'ConVía',
  short_name: 'ConVía',
  description: 'Carpooling verificado para la comunidad universitaria de Chía y la Sabana.',
  lang: 'es',
  start_url: `${baseUrl}/`,
  scope: `${baseUrl}/`,
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#FFFFFF',
  theme_color: '#006FFD',
  icons: [{ src: `${baseUrl}/icon-1024.png`, sizes: '1024x1024', type: 'image/png', purpose: 'any' }],
};
writeFileSync(join(app, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

const indexPath = join(app, 'index.html');
let html = readFileSync(indexPath, 'utf8');
html = html.replace(
  /<meta name="viewport"[^>]*>/,
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
);
html = html.replace(
  '</head>',
  [
    `<link rel="manifest" href="${baseUrl}/manifest.webmanifest">`,
    `<link rel="apple-touch-icon" href="${baseUrl}/apple-touch-icon.png">`,
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-title" content="ConVía">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
    '</head>',
  ].join('\n'),
);
writeFileSync(indexPath, html);

// GitHub Pages serves the root 404.html for unknown paths: hand those to the app router.
writeFileSync(join(site, '404.html'), html);
writeFileSync(join(site, '.nojekyll'), '');

console.log(`Site ready in ${site} (app at ${baseUrl}/)`);
