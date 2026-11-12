// Raw 1170×2532 PNG captures → optimized WebP (+ og-image and favicons) in web-landing/.
import sharp from 'sharp'; import { mkdirSync, copyFileSync } from 'node:fs'; import { join } from 'node:path';
const [raw, site, icon, font] = process.argv.slice(2);
const img = join(site, 'img'); mkdirSync(img, { recursive: true });
for (const n of ['inicio', 'viaje', 'qr', 'chat', 'perfil']) {
  for (const w of [400, 828]) await sharp(join(raw, `${n}.png`)).resize(w).webp({ quality: 80, effort: 6, smartSubsample: true }).toFile(join(img, `${n}-${w}.webp`));
}
// Open Graph image: 1200×630, copy on the left, the Inicio screenshot in a phone on the right.
const phoneW = 300, phoneH = Math.round(phoneW * 844 / 390), pad = 12, r = 40;
const screen = await sharp(join(raw, 'inicio.png')).resize(phoneW - pad*2).png().toBuffer();
const sh = Math.round((phoneW - pad*2) * 844 / 390);
const mask = Buffer.from(`<svg width="${phoneW-pad*2}" height="${sh}"><rect width="100%" height="100%" rx="${r-pad}" fill="#fff"/></svg>`);
const screenR = await sharp(screen).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
const phone = await sharp({ create: { width: phoneW, height: phoneH, channels: 4, background: { r:0,g:0,b:0,alpha:0 } } })
  .composite([{ input: Buffer.from(`<svg width="${phoneW}" height="${phoneH}"><rect width="100%" height="100%" rx="${r}" fill="#1F2024"/></svg>`) }, { input: screenR, left: pad, top: pad }]).png().toBuffer();
const text = Buffer.from(`<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
<style>text{font-family:Inter,'Segoe UI',Arial,sans-serif}</style>
<rect width="1200" height="630" fill="#FFFFFF"/><rect x="760" y="0" width="440" height="630" fill="#EAF2FF"/>
<text x="72" y="140" font-size="44" font-weight="800" fill="#1F2024">Con<tspan fill="#0062E0">Vía</tspan></text>
<text x="72" y="262" font-size="58" font-weight="800" fill="#1F2024" letter-spacing="-1.5">Ya vas para el</text>
<text x="72" y="330" font-size="58" font-weight="800" fill="#1F2024" letter-spacing="-1.5">mismo lado.</text>
<text x="72" y="398" font-size="58" font-weight="800" fill="#0062E0" letter-spacing="-1.5">Vayan juntos.</text>
<text x="72" y="470" font-size="26" fill="#55565D">Carpooling verificado con tu universidad o empresa.</text>
<text x="72" y="540" font-size="22" font-weight="600" fill="#0050B8">Gratis · Android y web</text></svg>`);
await sharp(text).composite([{ input: await sharp(phone).extract({ left: 0, top: 0, width: phoneW, height: 630 - 60 }).toBuffer(), left: 830, top: 60 }]).flatten({ background: '#FFFFFF' }).jpeg({ quality: 86, mozjpeg: true }).toFile(join(img, 'og-image.jpg'));
// Favicons from the app icon.
await sharp(icon).resize(48).png().toFile(join(site, 'favicon-48.png'));
await sharp(icon).resize(180).png().toFile(join(site, 'apple-touch-icon.png'));
await sharp(icon).resize(32).png().toFile(join(site, 'favicon.ico.png'));
mkdirSync(join(site, 'fonts'), { recursive: true });
copyFileSync(font, join(site, 'fonts', 'inter-latin-wght-normal.woff2'));
console.log('ok');
