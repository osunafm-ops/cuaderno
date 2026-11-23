// Conexión con la cuenta de Google (Drive, Calendar y Tasks) desde el navegador.
import { settings, saveSettings } from './settings.js';
import { loadScript } from './ui.js';

// ID de cliente de la app registrada en Google Cloud (no es secreto). Se puede cambiar en Ajustes.
export const DEFAULT_CLIENT_ID = '';

export const SCOPE = {
  drive: 'https://www.googleapis.com/auth/drive.file',
  cal: 'https://www.googleapis.com/auth/calendar.app.created',
  tasks: 'https://www.googleapis.com/auth/tasks'
};

export class AuthNeeded extends Error {
  constructor() { super('Hay que volver a conectar con Google'); this.auth = true; }
}

export const clientId = () => settings.gClientId || DEFAULT_CLIENT_ID;

let tok = null;
try {
  const s = JSON.parse(localStorage.getItem('gtok') || 'null');
  if (s && s.exp > Date.now()) tok = s;
} catch (e) { /* sin almacenamiento */ }

export const hasToken = () => !!(tok && tok.exp > Date.now() + 30000);
export const granted = k => (settings.gScopes || []).includes(SCOPE[k]);
export function _setToken(t, ms = 3600e3) { tok = t ? { t, exp: Date.now() + ms } : null; } // para pruebas

let client = null, clientFor = '';
// Carga anticipada: la ventana de Google tiene que abrirse justo al tocar un botón.
export async function prepare() {
  if (!clientId()) return null;
  await loadScript('https://accounts.google.com/gsi/client');
  if (!client || clientFor !== clientId()) {
    client = google.accounts.oauth2.initTokenClient({ client_id: clientId(), scope: Object.values(SCOPE).join(' '), callback: () => {} });
    clientFor = clientId();
  }
  return client;
}

export function signIn() {
  return new Promise((res, rej) => {
    if (!clientId()) return rej(new Error('Falta el ID de cliente de Google (Ajustes → Sincronización).'));
    const go = c => {
      c.callback = r => {
        if (r.error) return rej(new Error(r.error_description || r.error));
        tok = { t: r.access_token, exp: Date.now() + (r.expires_in - 60) * 1000 };
        try { localStorage.setItem('gtok', JSON.stringify(tok)); } catch (e) {}
        settings.gScopes = (r.scope || '').split(' ');
        if (!granted('drive')) return rej(new Error('Hace falta el permiso de Google Drive para sincronizar.'));
        settings.gConnected = true;
        saveSettings();
        res();
      };
      c.error_callback = e => rej(new Error(e.type === 'popup_closed' ? 'Se cerró la ventana de Google' : e.type === 'popup_failed_to_open' ? 'El navegador bloqueó la ventana de Google. Vuelve a pulsar.' : (e.message || e.type)));
      c.requestAccessToken({ prompt: settings.gConnected ? '' : 'consent' });
    };
    if (client && clientFor === clientId()) go(client);
    else prepare().then(go, rej);
  });
}

export function signOut() {
  try { if (tok && window.google) google.accounts.oauth2.revoke(tok.t, () => {}); } catch (e) {}
  tok = null;
  try { localStorage.removeItem('gtok'); } catch (e) {}
  settings.gConnected = false; settings.gScopes = []; settings.gFolder = null;
  saveSettings();
}

// Llamada a una API de Google. opt: {method, json, body, headers, ok:[códigos aceptados]}
export async function api(url, opt = {}) {
  if (!hasToken()) throw new AuthNeeded();
  const headers = { Authorization: 'Bearer ' + tok.t, ...(opt.json ? { 'Content-Type': 'application/json' } : {}), ...(opt.headers || {}) };
  const r = await fetch(url, { method: opt.method || 'GET', headers, body: opt.json ? JSON.stringify(opt.json) : opt.body, cache: 'no-store' });
  if (r.status === 401) { tok = null; try { localStorage.removeItem('gtok'); } catch (e) {} throw new AuthNeeded(); }
  if (!r.ok && !(opt.ok || []).includes(r.status)) {
    let t = ''; try { t = await r.text(); } catch (e) {}
    throw new Error(`Google respondió ${r.status}: ${t.slice(0, 180)}`);
  }
  return r;
}
