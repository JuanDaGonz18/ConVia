// verify-vehicle in MOCK mode against the LOCAL stack only (never production):
// ownership, photo deletion, the three outcomes, RLS and the hourly limit.
// Creates throwaway @unisabana.edu.co users in the local database.
//
// Run:
//   npx supabase start
//   npx supabase functions serve verify-vehicle      (no MODEL_API_KEY → mock)
//   npm run test:verify-vehicle
import { createClient } from '@supabase/supabase-js';

const URL = 'http://127.0.0.1:54321';
const ANON = process.env.LOCAL_ANON;
const SERVICE = process.env.LOCAL_SERVICE;
if (!ANON || !SERVICE) {
  console.error('Faltan LOCAL_ANON / LOCAL_SERVICE (usa npm run test:verify-vehicle).');
  process.exit(1);
}
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`); };

async function makeUser(email) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test-12345!', email_confirm: true, user_metadata: { nombre: 'ZZ Prueba', rol: 'usuario', terms_accepted: true, terms_version: '1.0' } });
  if (error) throw error;
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: 'Test-12345!' });
  if (signInError) throw signInError;
  return { id: data.user.id, client };
}

// Minimal valid JPEG (1x1).
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

async function upload(user) {
  const path = `${user.id}/verify-${crypto.randomUUID()}.jpg`;
  const { error } = await user.client.storage.from('vehicle-photos').upload(path, JPEG, { contentType: 'image/jpeg' });
  if (error) throw error;
  return path;
}

async function invoke(user, body) {
  const { data, error } = await user.client.functions.invoke('verify-vehicle', { body });
  if (error) return { httpStatus: error.context?.status, data: null };
  return { httpStatus: 200, data };
}

const stamp = Date.now();
const driver = await makeUser(`zz.driver${stamp}@unisabana.edu.co`);
const other = await makeUser(`zz.other${stamp}@unisabana.edu.co`);

const plate = `TST${String(stamp % 1000).padStart(3, '0').slice(0, 2)}1`; // ends in 1 → verified by default
const { data: vehicle, error: vehicleError } = await driver.client
  .from('vehicles').insert({ driver_id: driver.id, placa: plate, marca: 'Chevrolet Spark', color: 'Gris', puestos: 4 }).select('*').single();
if (vehicleError) throw vehicleError;
console.log('vehicle', vehicle.placa);

// Default outcome by plate digit
{
  const path = await upload(driver);
  const r = await invoke(driver, { vehicle_id: vehicle.id, photo_path: path });
  check('default (plate ends in 1) → verified', r.data?.status === 'verified' && r.data?.mock === true && r.data?.plate_read === plate, JSON.stringify(r.data));
  const { data: left } = await admin.storage.from('vehicle-photos').list(driver.id);
  check('photo deleted after verification', !left?.some((f) => path.endsWith(f.name)));
}
for (const outcome of ['verified', 'failed', 'retry']) {
  const path = await upload(driver);
  const r = await invoke(driver, { vehicle_id: vehicle.id, photo_path: path, mock_outcome: outcome });
  check(`mock_outcome=${outcome}`, r.data?.status === outcome && !!r.data?.message, `${r.data?.reason}: ${r.data?.message}`);
}

// Security
{
  const path = await upload(other);
  const r = await invoke(other, { vehicle_id: vehicle.id, photo_path: path });
  check("someone else's vehicle → 404", r.httpStatus === 404);
}
{
  const r = await invoke(driver, { vehicle_id: vehicle.id, photo_path: `${other.id}/verify-${crypto.randomUUID()}.jpg` });
  check("someone else's photo path → 400", r.httpStatus === 400);
  const r2 = await invoke(driver, { vehicle_id: vehicle.id, photo_path: `${driver.id}/${vehicle.id}.jpg` });
  check('non-verification photo (public listing photo) → 400', r2.httpStatus === 400);
}
{
  const res = await fetch(`${URL}/functions/v1/verify-vehicle`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: '{}' });
  check('no JWT → 401', res.status === 401);
}

// Stored rows + RLS
{
  const { data: rows } = await driver.client.from('vehicle_verifications').select('status, reason, plate_expected, plate_read, confidence, mock').eq('vehicle_id', vehicle.id);
  check('driver reads own results (4 saved)', rows?.length === 4, JSON.stringify(rows?.map((row) => row.status)));
  const { data: foreign } = await other.client.from('vehicle_verifications').select('id').eq('vehicle_id', vehicle.id);
  check("other user can't read them", (foreign ?? []).length === 0);
  const { error: insertError } = await driver.client.from('vehicle_verifications').insert({
    vehicle_id: vehicle.id, driver_id: driver.id, status: 'verified', reason: 'fake', message: 'fake', plate_expected: plate,
  });
  check("driver can't self-insert a verified row", !!insertError, insertError?.message);
}

// Rate limit: 10 per hour (4 already + loop)
{
  let last;
  for (let i = 0; i < 7; i++) {
    const path = await upload(driver);
    last = await invoke(driver, { vehicle_id: vehicle.id, photo_path: path });
  }
  check('11th attempt in an hour → retry too_many_attempts', last.data?.status === 'retry' && last.data?.reason === 'too_many_attempts', last.data?.reason);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
