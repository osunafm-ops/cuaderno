// Copia de seguridad de cada noche: en la tablet y, cuando hay conexión con Google, también en Drive.
import './backup-core.js';
import { settings } from './settings.js';
import { api, hasToken } from './google.js';
import { createFile, hooks as syncHooks } from './sync.js';
import { dkey, pad } from './ui.js';

const core = self.cuadernoBackup;
const DRIVE = 'https://www.googleapis.com/drive/v3', FOLDER = 'Cuaderno (copias de seguridad)', KEEP = 14;
const enc = encodeURIComponent;

export const list = core.list, getState = core.getState;

async function folder() {
  const q = `name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const j = await (await api(`${DRIVE}/files?q=${enc(q)}&fields=files(id)&spaces=drive`)).json();
  if (j.files?.[0]) return j.files[0].id;
  return (await (await api(`${DRIVE}/files?fields=id`, { method: 'POST', json: { name: FOLDER, mimeType: 'application/vnd.google-apps.folder' } })).json()).id;
}

export async function listDrive() {
  if (!settings.gConnected || !hasToken()) return [];
  const f = await folder();
  return (await (await api(`${DRIVE}/files?q=${enc(`'${f}' in parents and trashed=false`)}&orderBy=createdTime desc&fields=files(id,name,size,createdTime)&pageSize=50&spaces=drive`)).json()).files || [];
}
export const fetchDrive = async id => (await api(`${DRIVE}/files/${id}?alt=media`)).blob();

async function toDrive(blob) {
  const n = new Date(), f = await folder();
  await createFile(f, `cuaderno-${dkey(n)}-${pad(n.getHours())}${pad(n.getMinutes())}-${settings.deviceName || 'tablet'}.json`, blob, 'application/json');
  await core.setState({ drive: Date.now(), error: '' });
  // Se conservan las 14 últimas de esta tablet; las anteriores van a la papelera de Drive.
  const mine = (await listDrive()).filter(x => x.name.endsWith(`-${settings.deviceName || 'tablet'}.json`));
  for (const x of mine.slice(KEEP)) await api(`${DRIVE}/files/${x.id}`, { method: 'PATCH', json: { trashed: true } });
}

let busy = null;
export function run(force = false) {
  if (busy) return busy;
  busy = (async () => {
    if (!force && !settings.bkOn) return 'off';
    const st = await core.getState(), due = core.slot(settings.bkHour ?? 3);
    const needL = force || (st.local || 0) < due;
    const needD = settings.bkDrive && settings.gConnected && hasToken() && (force || (st.drive || 0) < due);
    if (!needL && !needD) return 'none';
    if (syncHooks.before) await syncHooks.before();
    let err = '', blob = null;
    if (needL) try { blob = (await core.local()).blob; } catch (e) { err = 'En la tablet: ' + (e.message || e); }
    if (needD) try { await toDrive(blob || await core.build()); } catch (e) { err = (err ? err + ' · ' : '') + 'En Drive: ' + (e.message || e); }
    await core.setState({ error: err });
    if (err) throw new Error(err);
    return needD ? 'drive' : 'local';
  })().finally(() => { busy = null; });
  return busy;
}

export const safety = () => core.local('antes-de-restaurar');

// Copia con la app cerrada (Chrome la lanza cuando la tablet está en uso o cargando, si la app está instalada).
export async function registerBackground() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.periodicSync) await reg.periodicSync.register('copia-noche', { minInterval: 12 * 3600e3 });
  } catch (e) { /* sin permiso: la copia se hace al abrir la app */ }
}

export function start() {
  const tick = () => run().catch(e => console.warn('Copia', e));
  setTimeout(tick, 15000);
  setInterval(tick, 5 * 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(tick, 5000); });
  registerBackground();
}
