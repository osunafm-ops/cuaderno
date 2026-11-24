// Calendario de Office 365 / Outlook (solo lectura) con Microsoft Graph. Inicio de sesión OAuth con PKCE, sin secretos.
import { db } from './db.js';
import { settings, saveSettings } from './settings.js';
import { dkey, pad } from './ui.js';

// ID de aplicación registrada en Microsoft Entra (no es secreto). Se puede poner en Ajustes.
export const DEFAULT_CLIENT_ID = '';
const AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0', GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = 'https://graph.microsoft.com/Calendars.Read offline_access';

export const clientId = () => settings.msClientId || DEFAULT_CLIENT_ID;
export const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

const load = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const save = (k, v) => { try { v ? localStorage.setItem(k, JSON.stringify(v)) : localStorage.removeItem(k); } catch (e) { /* sin almacenamiento */ } };
let tok = load('mstok');

const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rnd = () => b64u(crypto.getRandomValues(new Uint8Array(32)));

export async function signIn() {
  if (!clientId()) throw new Error('Falta el ID de aplicación de Microsoft (ver la guía de Office 365).');
  const verifier = rnd(), state = rnd();
  save('mspkce', { verifier, state });
  const challenge = b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  location.assign(`${AUTH}/authorize?` + new URLSearchParams({ client_id: clientId(), response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query', scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' }));
}

async function token(params) {
  const r = await fetch(`${AUTH}/token`, { method: 'POST', body: new URLSearchParams({ client_id: clientId(), ...params }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error_description?.split('\n')[0].slice(0, 200) || 'Microsoft respondió ' + r.status); e.code = j.error; throw e; }
  tok = { t: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000, r: j.refresh_token || tok?.r };
  save('mstok', tok);
}

// Vuelta desde la página de Microsoft. Devuelve true si había un inicio de sesión que completar.
export async function finishSignIn() {
  const q = new URLSearchParams(location.search), pk = load('mspkce');
  if (!pk || !q.get('state') || q.get('state') !== pk.state) return false;
  save('mspkce', null);
  history.replaceState(null, '', redirectUri() + '#/ajustes');
  if (q.get('error')) throw new Error(q.get('error_description') || q.get('error'));
  await token({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri(), code_verifier: pk.verifier, scope: SCOPES });
  settings.msConnected = true; saveSettings();
  return true;
}

export async function signOut() {
  tok = null; save('mstok', null);
  settings.msConnected = false; settings.msLast = null; saveSettings();
  await db.put('kv', { id: 'mext', v: { events: [] } });
}

async function access() {
  if (tok && tok.exp > Date.now() + 30000) return tok.t;
  if (tok?.r) {
    try { await token({ grant_type: 'refresh_token', refresh_token: tok.r, scope: SCOPES }); return tok.t; }
    catch (e) { if (e.code !== 'invalid_grant' && e.code !== 'interaction_required') throw e; tok = null; save('mstok', null); }
  }
  const e = new Error('Hay que volver a conectar con Office 365'); e.auth = true; throw e;
}
export const needsLogin = () => settings.msConnected && !(tok && (tok.exp > Date.now() || tok.r));

async function get(url) {
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + await access() }, cache: 'no-store' });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(`Office 365 respondió ${r.status}: ${(j.error?.message || '').slice(0, 150)}`); }
  return r.json();
}
async function all(url) {
  const out = [];
  while (url) { const j = await get(url); out.push(...(j.value || [])); url = j['@odata.nextLink']; }
  return out;
}

const COL = { lightBlue: '#1565c0', lightGreen: '#2e7d32', lightOrange: '#ef6c00', lightGray: '#7a7a7a', lightYellow: '#b58900', lightTeal: '#00838f', lightPink: '#ad1457', lightBrown: '#6d4c41', lightRed: '#c62828' };
const next = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// Graph da las horas en UTC si no se pide otra zona.
const utc = s => new Date(s.slice(0, 19) + 'Z');

export function convert(ev, cal) {
  const o = { src: 'ms', cal: cal.id, calName: cal.name || 'Office 365', color: cal.hexColor || COL[cal.color] || '#0f6cbd', title: ev.subject || '(sin título)', loc: ev.location?.displayName || '' };
  if (ev.isAllDay) return { ...o, date: ev.start.dateTime.slice(0, 10), endEx: ev.end.dateTime.slice(0, 10), time: '' };
  const s = utc(ev.start.dateTime), e = utc(ev.end.dateTime), hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { ...o, date: dkey(s), endEx: dkey(next(new Date(Math.max(s.getTime(), e.getTime() - 1)), 1)), time: hm(s), endTime: hm(e) };
}

let running = null;
export function refresh() {
  if (!settings.msConnected) return Promise.resolve(false);
  return running = running || (async () => {
    const n = new Date(), a = new Date(n.getFullYear(), n.getMonth() - 2, 1).toISOString(), b = new Date(n.getFullYear(), n.getMonth() + 7, 1).toISOString();
    const out = [];
    for (const c of await all(`${GRAPH}/me/calendars?$top=50`)) {
      const evs = await all(`${GRAPH}/me/calendars/${encodeURIComponent(c.id)}/calendarView?startDateTime=${a}&endDateTime=${b}&$top=200&$select=subject,start,end,isAllDay,location,isCancelled`);
      for (const ev of evs) if (!ev.isCancelled) out.push(convert(ev, c));
    }
    const prev = JSON.stringify(await events());
    await db.put('kv', { id: 'mext', v: { at: Date.now(), events: out } });
    settings.msLast = Date.now(); saveSettings();
    return prev !== JSON.stringify(out);
  })().finally(() => { running = null; });
}

export async function events() { return settings.msConnected ? (await db.get('kv', 'mext'))?.v?.events || [] : []; }
