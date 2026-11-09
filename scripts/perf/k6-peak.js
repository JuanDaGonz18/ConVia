/* global __ENV, __VU */
/* eslint-disable import/no-unresolved -- módulos de k6, no de Node */
/**
 * ConVía — pico de la mañana (6–7 a. m.): 300 usuarios simultáneos, 10 min.
 * SOLO contra el stack local con los datos de scripts/perf/seed.sql.
 *
 *   node scripts/perf/tokens.mjs perf-users.json
 *   k6 run -e USERS_FILE=perf-users.json -e OUT_DIR=. scripts/perf/k6-peak.js
 *
 * Cada usuario virtual es una cuenta sintética distinta (240 pasajeros y
 * 60 conductores) y hace lo mismo que la app (mismas consultas de
 * src/services/tripService.ts y chatService.ts):
 *   pasajero: buscar viajes → abrir uno → pedir cupo → ver sus solicitudes →
 *             cancelar (para poder pedir otro sin choque de horario) → chat
 *             (lista, mensajes, enviar) → plan
 *   conductor: buscar viajes → solicitudes de sus viajes → chat → plan
 * Metas: p95 < 500 ms y < 1 % de errores en todas las peticiones.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

const config = JSON.parse(open(__ENV.USERS_FILE || './perf-users.json'));
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(config.api)) {
  throw new Error('Esta prueba solo se ejecuta contra el stack local.');
}
const BASE = config.api;
const ANON = config.anon;
const users = new SharedArray('users', () => JSON.parse(open(__ENV.USERS_FILE || './perf-users.json')).users);

const VUS = Number(__ENV.VUS || 300);
export const options = {
  scenarios: {
    pico_manana: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: VUS },   // 6:00 – la gente va abriendo la app
        { duration: '7m', target: VUS },   // pico sostenido
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    // Solo para ver el p95 de cada paso en el resumen (no hacen fallar la prueba).
    'http_req_duration{name:search}': ['p(95)<60000'],
    'http_req_duration{name:trip_details}': ['p(95)<60000'],
    'http_req_duration{name:request_seat}': ['p(95)<60000'],
    'http_req_duration{name:my_trip_requests}': ['p(95)<60000'],
    'http_req_duration{name:cancel_request}': ['p(95)<60000'],
    'http_req_duration{name:driver_trip_requests}': ['p(95)<60000'],
    'http_req_duration{name:chat_trips}': ['p(95)<60000'],
    'http_req_duration{name:chat_messages}': ['p(95)<60000'],
    'http_req_duration{name:chat_send}': ['p(95)<60000'],
    'http_req_duration{name:get_my_plan}': ['p(95)<60000'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const DAY = 24 * 3600 * 1000;

function headers(token, extra = {}) {
  return {
    apikey: ANON,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept-Encoding': 'gzip',
    ...extra,
  };
}

const think = (min, max) => sleep(min + Math.random() * (max - min));

function rpc(token, name, body = {}) {
  return http.post(`${BASE}/rest/v1/rpc/${name}`, JSON.stringify(body), { headers: headers(token), tags: { name } });
}

function search(token, uid) {
  const res = http.get(`${BASE}/rest/v1/available_trips?select=*&driver_id=neq.${uid}&order=salida_at`, {
    headers: headers(token), tags: { name: 'search' },
  });
  check(res, { 'search 200': (r) => r.status === 200 });
  return res.status === 200 ? res.json() : [];
}

function chat(token, uid) {
  const trips = rpc(token, 'my_chat_trips');
  check(trips, { 'chat_trips 200': (r) => r.status === 200 });
  if (trips.status !== 200) return;
  const ids = trips.json().map((t) => t.trip_id);
  if (!ids.length) return;
  const msgs = http.get(
    `${BASE}/rest/v1/messages?select=id,trip_id,sender_id,body,created_at&trip_id=in.(${ids.join(',')})&order=created_at.asc`,
    { headers: headers(token), tags: { name: 'chat_messages' } },
  );
  check(msgs, { 'chat_messages 200': (r) => r.status === 200 });
  think(1, 3);
  if (Math.random() < 0.5) {
    const sent = http.post(`${BASE}/rest/v1/messages?select=id,trip_id,sender_id,body,created_at`,
      JSON.stringify({ trip_id: ids[0], sender_id: uid, body: `Mensaje de prueba k6 ${Date.now()}` }),
      { headers: headers(token, { Prefer: 'return=representation' }), tags: { name: 'chat_send' } });
    check(sent, { 'chat_send 201': (r) => r.status === 201 });
  }
}

function passenger(user, uid) {
  const trips = search(user.token, uid);
  think(2, 5);

  // Solo viajes de los próximos 15 días: el chat de la prueba es el día +20,
  // así pedir cupo nunca choca con el horario de ese viaje.
  const limit = Date.now() + 15 * DAY;
  const candidates = trips.filter((t) => Date.parse(t.salida_at) < limit && t.cupos_disponibles > 0);
  if (candidates.length) {
    const trip = candidates[Math.floor(Math.random() * candidates.length)];
    const detail = http.get(`${BASE}/rest/v1/available_trips?select=*&id=in.(${trip.id})&order=salida_at`, {
      headers: headers(user.token), tags: { name: 'trip_details' },
    });
    check(detail, { 'trip_details 200': (r) => r.status === 200 });
    think(2, 4);

    const req = http.post(`${BASE}/rest/v1/trip_requests?select=id`, JSON.stringify({
      trip_id: trip.id, passenger_id: uid,
      direccion: 'Calle 1 # 2-3, Chía', recogida_nombre: 'Parque Principal de Chía',
      lat: 4.8616, lng: -74.0587,
      destino_nombre: trip.destino_nombre, destino_lat: trip.destino_lat, destino_lng: trip.destino_lng,
    }), { headers: headers(user.token, { Prefer: 'return=representation' }), tags: { name: 'request_seat' } });
    const ok = check(req, { 'request_seat 201': (r) => r.status === 201 });
    think(1, 2);

    const mine = rpc(user.token, 'my_trip_requests');
    check(mine, { 'my_trip_requests 200': (r) => r.status === 200 });
    think(1, 3);

    if (ok) {
      const id = req.json()[0].id;
      const cancel = rpc(user.token, 'cancel_trip_request', { p_request_id: id });
      check(cancel, { 'cancel_request 200': (r) => r.status === 200 });
    }
  }
  think(1, 3);
  chat(user.token, uid);
}

function driver(user, uid) {
  search(user.token, uid);
  think(2, 4);
  const reqs = rpc(user.token, 'driver_trip_requests');
  check(reqs, { 'driver_trip_requests 200': (r) => r.status === 200 });
  think(2, 4);
  chat(user.token, uid);
}

export default function () {
  const user = users[(__VU - 1) % users.length];
  const uid = user.id;
  if (user.role === 'driver') driver(user, uid);
  else passenger(user, uid);
  const plan = rpc(user.token, 'get_my_plan');
  check(plan, { 'get_my_plan 200': (r) => r.status === 200 });
  think(3, 6);
}

export function handleSummary(data) {
  const dir = __ENV.OUT_DIR || '.';
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: false }),
    [`${dir}/k6-summary.json`]: JSON.stringify(data, null, 2),
    [`${dir}/k6-summary.txt`]: textSummary(data, { indent: ' ', enableColors: false }),
  };
}
