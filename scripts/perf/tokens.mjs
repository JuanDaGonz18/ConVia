// Firma los JWT de los 300 usuarios "de carga" de scripts/perf/seed.sql con el
// secreto del stack LOCAL (npx supabase status). Nunca imprime claves ni tokens.
//
//   node scripts/perf/tokens.mjs <archivo de salida>   (por defecto ./perf-users.json)
//
// Se firman en vez de iniciar sesión porque Auth limita los inicios de sesión
// por IP (30 cada 5 min en supabase/config.toml) y la prueba usa 300 cuentas.
import { execSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'perf-users.json';
const status = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const API = status.API_URL ?? 'http://127.0.0.1:54321';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(API)) {
  throw new Error('Solo el stack local (127.0.0.1): esta prueba nunca se corre contra un proyecto alojado.');
}
const SECRET = status.JWT_SECRET;
if (!SECRET || !status.ANON_KEY) throw new Error('`supabase status` no devolvió JWT_SECRET / ANON_KEY.');

const b64url = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const md5uuid = (text) => {
  const h = createHash('md5').update(text).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

function sign(n) {
  const now = Math.floor(Date.now() / 1000);
  const email = `perf.${String(n).padStart(4, '0')}@prueba${Math.floor(n / 400) + 1}.example.test`;
  const payload = {
    iss: `${API}/auth/v1`, aud: 'authenticated', role: 'authenticated',
    sub: md5uuid(`convia-perf-user-${n}`), email, aal: 'aal1',
    iat: now, exp: now + 3 * 3600, session_id: md5uuid(`convia-perf-session-${n}`),
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {},
  };
  const head = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}`;
  return `${head}.${createHmac('sha256', SECRET).update(head).digest('base64url')}`;
}

// 60 conductores (local 0..11) y 240 pasajeros (local 80..127), 12 + 48 por institución.
const users = [];
for (let inst = 0; inst < 5; inst += 1) {
  for (let local = 0; local < 12; local += 1) users.push({ n: inst * 400 + local, role: 'driver' });
  for (let local = 80; local < 128; local += 1) users.push({ n: inst * 400 + local, role: 'passenger' });
}
// Intercalados para que cada tramo de VUs tenga conductores y pasajeros.
users.sort((a, b) => (a.n % 400 < 80 ? (a.n % 400) * 4 : a.n % 400 - 80) - (b.n % 400 < 80 ? (b.n % 400) * 4 : b.n % 400 - 80) || a.n - b.n);
for (const user of users) {
  user.id = md5uuid(`convia-perf-user-${user.n}`);
  user.token = sign(user.n);
}

// Comprobación: el token sirve y el usuario existe.
const probe = await fetch(`${API}/rest/v1/rpc/get_my_plan`, {
  method: 'POST',
  headers: { apikey: status.ANON_KEY, Authorization: `Bearer ${users[0].token}`, 'Content-Type': 'application/json' },
  body: '{}',
});
if (probe.status !== 200) throw new Error(`El token firmado no funciona contra el stack local (HTTP ${probe.status}).`);

writeFileSync(out, JSON.stringify({ api: API, anon: status.ANON_KEY, users }));
console.log(`${users.length} usuarios de carga (${users.filter((u) => u.role === 'driver').length} conductores) → ${out}`);
