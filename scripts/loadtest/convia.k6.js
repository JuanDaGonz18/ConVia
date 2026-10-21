/**
 * ConVía — prueba de carga con k6 (https://k6.io), SOLO en un proyecto de
 * staging con datos sintéticos. Ver docs/OPERACION.md → "Prueba de carga".
 *
 *   k6 run -e SUPABASE_URL=https://<staging>.supabase.co -e ANON_KEY=<clave publicable de staging> \
 *          -e USERS_FILE=./users.json scripts/loadtest/convia.k6.js
 *
 * users.json: [{ "email": "...", "password": "..." }, ...] — cuentas sintéticas
 * de staging (nunca personas reales). El script se niega a correr contra
 * producción.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const PRODUCTION_REF = 'hfnsgeunskbkapjavcao';
const BASE = __ENV.SUPABASE_URL;
const KEY = __ENV.ANON_KEY;
if (!BASE || !KEY) throw new Error('Faltan SUPABASE_URL y ANON_KEY (de staging).');
if (BASE.includes(PRODUCTION_REF)) throw new Error('Esta prueba no se ejecuta contra producción.');

const users = new SharedArray('users', () => JSON.parse(open(__ENV.USERS_FILE || './users.json')));

// Escalones: 20 → 100 → 200 usuarios virtuales (≈ el tope de 200 conexiones Realtime del plan Free).
export const options = {
  scenarios: {
    pasajeros: {
      executor: 'ramping-vus',
      stages: [
        { duration: '2m', target: 20 },
        { duration: '5m', target: 100 },
        { duration: '5m', target: 200 },
        { duration: '2m', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:available_trips}': ['p(95)<800'],
    'http_req_duration{name:login}': ['p(95)<1500'],
  },
};

const json = (token) => ({
  headers: { apikey: KEY, Authorization: `Bearer ${token ?? KEY}`, 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip' },
});

export default function () {
  const user = users[__VU % users.length];
  // 1. Iniciar sesión (Supabase Auth).
  const login = http.post(`${BASE}/auth/v1/token?grant_type=password`, JSON.stringify(user), { ...json(), tags: { name: 'login' } });
  if (!check(login, { 'login 200': (r) => r.status === 200 })) return;
  const token = login.json('access_token');

  for (let i = 0; i < 5; i += 1) {
    // 2. Buscar viajes (lo más frecuente en la app).
    const trips = http.get(`${BASE}/rest/v1/available_trips?select=*&order=salida_at`, { ...json(token), tags: { name: 'available_trips' } });
    check(trips, { 'trips 200': (r) => r.status === 200 });
    // 3. Mis solicitudes y mi plan (pantallas de inicio).
    http.post(`${BASE}/rest/v1/rpc/my_trip_requests`, '{}', { ...json(token), tags: { name: 'my_trip_requests' } });
    http.post(`${BASE}/rest/v1/rpc/get_my_plan`, '{}', { ...json(token), tags: { name: 'get_my_plan' } });
    sleep(3 + Math.random() * 4);
  }
}
