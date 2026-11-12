// Fictional data only: names, emails and plates are invented for the screenshots.
import { ME } from './fake.mjs';
export const INST = { id: 'inst-demo', nombre: 'Universidad Demo', nombre_corto: 'U. Demo', ciudad: 'Chía' };
const profile = { id: ME, nombre: 'Laura Pasajera', email: 'laura.demo@example.com', rol: 'usuario', avatar_url: null, verification_status: 'verificado', verified_at: '2026-08-01T12:00:00Z', driver_status: null };
export const NOW = new Date('2026-11-11T06:10:00-05:00');
const at = (min) => { const d = new Date(NOW.getTime() + min*60000); d.setSeconds(0,0); d.setMinutes(Math.round(d.getMinutes()/5)*5); return d.toISOString(); };
// Autopista Norte, Portal Norte → Puente del Común (Chía): [lng, lat]
const ROUTE = [[-74.0462,4.7546],[-74.0447,4.7650],[-74.0436,4.7760],[-74.0427,4.7880],[-74.0418,4.8000],[-74.0405,4.8120],[-74.0392,4.8240],[-74.0378,4.8360],[-74.0362,4.8470],[-74.0346,4.8560],[-74.0333,4.8615]];
const ROUTE2 = [[-74.0530,4.7380],[-74.0490,4.7460],[-74.0462,4.7546],...ROUTE.slice(1)];
const trip = (id, o) => ({ id, driver_id: o.driver, driver_nombre: o.name, driver_avatar_url: null, driver_rating: o.rating, vehicle_id: 'veh-'+id,
  origen_nombre: o.from, origen_lat: o.route[0][1], origen_lng: o.route[0][0], destino_nombre: 'Campus Puente del Común', destino_lat: 4.8615, destino_lng: -74.0333,
  salida_at: at(o.inMin), precio: o.price, cupos_disponibles: o.seats, descripcion: o.desc, estado: 'por_empezar', vehicle_marca: o.car, vehicle_color: o.color, vehicle_placa: o.plate, vehicle_foto_url: null,
  ruta: { coords: o.route, km: o.km, minutes: o.minutes, via: [] }, driver_is_plus: false, total_cupos: 4, cupos_totales: 4 });
export const TRIPS = [
  trip('trip-demo-1', { driver:'drv-sofia', name:'Sofía Pérez', rating:4.9, from:'Portal Norte', route: ROUTE, inMin: 45, price: 6000, seats: 2, desc:'Salgo puntual. Recojo sobre la Autopista Norte.', car:'Mazda 2', color:'Gris', plate:'DEM-001', km: 14.2, minutes: 28 }),
  trip('trip-demo-2', { driver:'drv-andres', name:'Andrés Peña', rating:4.8, from:'Calle 170', route: ROUTE.slice(1), inMin: 95, price: 5000, seats: 3, desc:'Voy directo al campus.', car:'Renault Sandero', color:'Blanco', plate:'DEM-002', km: 12.9, minutes: 25 }),
  trip('trip-demo-3', { driver:'drv-camila', name:'Camila Rojas', rating:5.0, from:'Mazurén', route: ROUTE2, inMin: 140, price: 7000, seats: 1, desc:'Música tranquila, sin afán.', car:'Chevrolet Onix', color:'Azul', plate:'DEM-003', km: 16.8, minutes: 33 }),
];
const places = [
  { id:'pl-home', kind:'home', label:'Casa', address:'Portal Norte, Bogotá', lat:4.7550, lng:-74.0458 },
  { id:'pl-uni', kind:'university', label:'Universidad', address:'Campus Puente del Común, Chía', lat:4.8612, lng:-74.0336 },
];
export const REQUEST = { id:'req-demo-1', trip_id:'trip-demo-1', passenger_id: ME, direccion:'Portal Norte', estado:'aceptado', qr_token:'convia-demo-qr-token-0001',
  created_at: at(-30), responded_at: at(-20), destino_nombre:'Campus Puente del Común', destino_viaje:'Campus Puente del Común', origen_viaje:'Portal Norte', salida_at: TRIPS[0].salida_at,
  recogida_nombre:'Portal Norte', last_changes: null, last_change_at: null };
const M = (id, sender, text, minAgo) => ({ id, trip_id:'trip-demo-1', sender_id: sender, body: text, created_at: at(-minAgo) });
export const MESSAGES = [
  M('m1','drv-sofia','¡Hola Laura! Te acepté el cupo. Salgo a la hora del viaje.',22),
  M('m2', ME,'¡Gracias, Sofía! Te espero en el Portal Norte, salida de la Autopista.',20),
  M('m3','drv-sofia','Perfecto. Voy en un Mazda 2 gris, placa DEM-001.',18),
  M('m4', ME,'Listo, llevo chaqueta azul 🙌',17),
  M('m5','drv-sofia','Estoy a 5 minutos. Al subir te escaneo el QR.',2),
];
export function fixtures(method, path, q, body) {
  const rpc = path.startsWith('/rest/v1/rpc/') ? path.slice(13) : null;
  const table = !rpc && path.startsWith('/rest/v1/') ? path.slice(9) : null;
  if (rpc === 'get_my_profile') return profile;
  if (rpc === 'my_institution') return { status: 'verified', method: 'institutional_email', institution: INST, has_microsoft: false, request: null, last_check: null };
  if (rpc === 'my_accepted_legal_version') return '1.3';
  if (rpc === 'my_trip_requests') return [REQUEST];
  if (rpc === 'my_chat_trips') return [{ trip_id:'trip-demo-1', driver_id:'drv-sofia', driver_nombre:'Sofía Pérez', driver_avatar_url:null, origen_nombre:'Portal Norte', destino_nombre:'Campus Puente del Común', viewer_is_driver:false }];
  if (table === 'saved_places') return places;
  if (table === 'available_trips') { const id = q.get('id'); if (id) { const ids = id.replace(/^(eq|in)\.\(?|\)$/g,'').split(','); return TRIPS.filter(t=>ids.includes(t.id)); } return TRIPS; }
  if (table === 'messages') return MESSAGES;
  if (table === 'profiles') return [{ id: ME, nombre: 'Laura Pasajera' }, { id: 'drv-sofia', nombre: 'Sofía Pérez' }];
  return undefined;
}
