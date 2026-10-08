// End-to-end auth and privacy check against the real Supabase project, with the
// same public key and calls the app makes (register, profile, notifications,
// session restore, logout/login, password change, direct reads of other
// users' data). Creates ONE throwaway @unisabana.edu.co account and deletes it
// at the end through the app's own delete-account Edge Function.
//
// Run: node --env-file=.env supabase/tests/auth_e2e.mjs
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const results = [];
const check = (ok, label, detail = '') => results.push(`${ok ? 'OK ' : 'BAD'} ${label}${detail ? ` → ${detail}` : ''}`);

const email = `zz.authtest.${Date.now()}@unisabana.edu.co`;
const password = `Prueba-${randomBytes(9).toString('hex')}9`;
const newPassword = `Nueva-${randomBytes(9).toString('hex')}7`;
let app = createClient(url, key, opts);
let created = false;

try {
  // Registration (register screen → authService.register)
  const { data: domains, error: domainError } = await app.rpc('check_email_domain', { p_email: email });
  check(!domainError && domains?.length === 1, 'registration: institutional domain accepted (anon)', domainError?.message);
  const { data: signUp, error: signUpError } = await app.auth.signUp({
    email, password, options: { data: { nombre: 'ZZ Auth Test', rol: 'usuario', terms_accepted: true, terms_version: '1.0' } },
  });
  created = !signUpError;
  check(!signUpError && !!signUp.session, 'registration: account created with a session', signUpError?.message);

  // Profile immediately after registration (getCurrentUser → get_my_profile)
  let { data: me, error: meError } = await app.rpc('get_my_profile');
  check(!meError && me?.email === email && me?.rol === 'usuario' && me?.driver_status === null,
    'profile right after registration (own email, role, driver status)', meError?.message ?? JSON.stringify(me && { email: me.email, rol: me.rol }));

  // Notifications (notificationService.register / setEnabled)
  const userId = signUp.user.id;
  let { error: tokenError } = await app.from('profiles').update({ expo_push_token: 'ExponentPushToken[convia-test]' }).eq('id', userId);
  check(!tokenError, 'notifications: own push token saved', tokenError?.message);
  ({ error: tokenError } = await app.from('profiles').update({ notifications_enabled: false, expo_push_token: null }).eq('id', userId));
  ({ data: me } = await app.rpc('get_my_profile'));
  check(!tokenError && me?.notifications_enabled === false, 'notifications: toggle off saved and read back', tokenError?.message);

  // Profile edit (profileService.updateProfile / getProfile)
  const { error: editError } = await app.from('profiles').update({ nombre: 'ZZ Auth Test 2', telefono: '3001234567' }).eq('id', userId);
  ({ data: me } = await app.rpc('get_my_profile'));
  check(!editError && me?.telefono === '3001234567' && me?.nombre === 'ZZ Auth Test 2', 'profile edit: name and phone saved, phone readable by its owner', editError?.message);

  // Privacy from a real session
  const { error: emailLeak } = await app.from('profiles').select('email').neq('id', userId).limit(1);
  check(!!emailLeak, 'privacy: other users\' email not readable', emailLeak ? emailLeak.code : 'readable!');
  const { error: phoneLeak } = await app.from('profiles').select('telefono').limit(1);
  check(!!phoneLeak, 'privacy: phone column not readable directly (not even own row)', phoneLeak ? phoneLeak.code : 'readable!');
  const { data: names, error: namesError } = await app.from('profiles').select('id, nombre').limit(3);
  check(!namesError && Array.isArray(names), 'privacy: public profile fields (name) still readable', namesError?.message);
  const { data: otherTrips } = await app.from('trips').select('id, origen_lat').neq('driver_id', userId).limit(5);
  check((otherTrips ?? []).length === 0, 'privacy: other users\' trips not readable directly', `${(otherTrips ?? []).length} rows`);
  const { data: plates } = await app.from('vehicles').select('placa').limit(5);
  check((plates ?? []).length === 0, 'privacy: other users\' plates not readable directly', `${(plates ?? []).length} rows`);
  const { error: pickupLeak } = await app.from('trip_requests').select('direccion').limit(1);
  check(!!pickupLeak, 'privacy: request addresses not readable directly', pickupLeak ? pickupLeak.code : 'readable!');
  const { data: avail, error: availError } = await app.from('available_trips').select('id, vehicle_placa, origen_lat').limit(5);
  check(!availError, 'available trips list loads', availError?.message ?? `${avail.length} visible`);
  const masked = (avail ?? []).every((trip) => !trip.vehicle_placa || trip.vehicle_placa.includes('•'));
  check(masked, 'available trips: plates masked');
  const { error: planError } = await app.rpc('get_my_plan');
  check(!planError, 'plan loads (get_my_plan)', planError?.message);
  const { error: chatError } = await app.rpc('my_chat_trips');
  check(!chatError, 'chats load (my_chat_trips)', chatError?.message);
  const { error: reqError } = await app.rpc('my_trip_requests');
  check(!reqError, 'passenger requests load (my_trip_requests)', reqError?.message);

  // Session restoration (app restart: stored tokens → new client)
  const session = (await app.auth.getSession()).data.session;
  const restored = createClient(url, key, opts);
  const { error: restoreError } = await restored.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  ({ data: me } = await restored.rpc('get_my_profile'));
  check(!restoreError && me?.email === email, 'session restoration: profile loads from stored session', restoreError?.message);

  // Logout and login again
  const { error: outError } = await app.auth.signOut();
  const { data: afterOut } = await app.rpc('get_my_profile');
  check(!outError && afterOut === null, 'logout: no profile without a session', outError?.message);
  app = createClient(url, key, opts);
  const { error: loginError } = await app.auth.signInWithPassword({ email, password });
  ({ data: me } = await app.rpc('get_my_profile'));
  check(!loginError && me?.email === email, 'login again: profile loads', loginError?.message);

  // Password change (profile → Cambiar contraseña), then login with it
  const { error: pwError } = await app.auth.updateUser({ password: newPassword });
  check(!pwError, 'password change accepted', pwError?.message);
  await app.auth.signOut();
  app = createClient(url, key, opts);
  const { error: newLoginError } = await app.auth.signInWithPassword({ email, password: newPassword });
  check(!newLoginError, 'login with the new password', newLoginError?.message);
  const { error: oldLoginError } = await createClient(url, key, opts).auth.signInWithPassword({ email, password });
  check(!!oldLoginError, 'old password rejected', oldLoginError ? 'rejected' : 'still works!');
} finally {
  // Cleanup through the app's own delete-account function.
  if (created) {
    const { error: deleteError } = await app.functions.invoke('delete-account', { method: 'POST' });
    const { error: goneError } = await createClient(url, key, opts).auth.signInWithPassword({ email, password: newPassword });
    check(!deleteError && !!goneError, 'cleanup: test account deleted', deleteError?.message ?? '');
  }
  const bad = results.filter((line) => line.startsWith('BAD')).length;
  console.log(results.join('\n'));
  console.log(`\n${results.length - bad} OK, ${bad} BAD`);
  if (bad) process.exitCode = 1;
}
