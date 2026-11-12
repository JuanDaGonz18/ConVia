// Fake Supabase backend for screenshots: fixture data only, nothing leaves the machine.
export const ME = 'demo-user-laura';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now()/1000) + 3600*24;
const user = { id: ME, aud: 'authenticated', role: 'authenticated', email: 'laura.demo@example.com', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata:{provider:'email'}, user_metadata:{}, created_at:'2026-01-01T00:00:00Z' };
const jwt = `${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:ME,role:'authenticated',aud:'authenticated',exp,email:user.email,session_id:'demo'})}.c2ln`;
export const session = { access_token: jwt, token_type:'bearer', expires_in: 86400, expires_at: exp, refresh_token:'demo-refresh', user };
export const log = [];
export async function install(page, fixtures) {
  await page.route(/demo\.localhost:8092/, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname;
    const body = req.postData();
    if (path.startsWith('/auth/v1/token')) return route.fulfill({ json: session });
    if (path === '/auth/v1/user') return route.fulfill({ json: user });
    if (path.startsWith('/auth/v1/logout')) return route.fulfill({ status: 204 });
    const hit = fixtures(req.method(), path, url.searchParams, body, req);
    log.push(`${req.method()} ${path}?${url.searchParams} ${body ? body.slice(0,150) : ''} -> ${hit === undefined ? 'DEFAULT' : 'fixture'}`);
    if (hit === undefined) {
      const single = (req.headers()['accept']||'').includes('vnd.pgrst.object');
      return route.fulfill({ json: single ? null : (path.startsWith('/rest/v1/rpc/') ? null : []) });
    }
    if (hit && hit.__status) return route.fulfill({ status: hit.__status, json: hit.json ?? {} });
    return route.fulfill({ json: hit });
  });
}
