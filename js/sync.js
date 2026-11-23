// Sincronización: tablets entre sí (a través de una carpeta en tu Google Drive),
// agenda con un calendario "Cuaderno" de Google Calendar y tareas con una lista "Cuaderno" de Google Tasks.
import { db, uid } from './db.js';
import { settings, saveSettings } from './settings.js';
import { api, hasToken, granted } from './google.js';
import { dkey, pad } from './ui.js';

const DRIVE = 'https://www.googleapis.com/drive/v3', UP = 'https://www.googleapis.com/upload/drive/v3';
const CAL = 'https://www.googleapis.com/calendar/v3', TASKS = 'https://tasks.googleapis.com/tasks/v1';
const FOLDER = 'Cuaderno (sincronización)';
const STORES = ['notebooks', 'events', 'todos', 'pages', 'blobs'];
const BIG = 4.5 * 1024 * 1024;
const enc = encodeURIComponent;
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid';

export const state = { status: 'off', last: settings.gLast, msg: '' }; // off | ok | busy | auth | error
export const hooks = { before: null };
const listeners = new Set();
export const onSync = f => { listeners.add(f); return () => listeners.delete(f); };
function emit(changed = new Set()) { for (const f of listeners) try { f(state, changed); } catch (e) { console.warn(e); } }

let running = null, again = false;
export function syncNow() {
  if (running) { again = true; return running; }
  running = run().finally(() => { running = null; if (again) { again = false; syncNow(); } });
  return running;
}

export function refreshState() {
  state.status = !settings.gConnected ? 'off' : hasToken() ? (state.status === 'auth' || state.status === 'off' ? 'ok' : state.status) : 'auth';
  emit();
}

async function run() {
  if (!settings.gConnected) { state.status = 'off'; emit(); return; }
  if (!hasToken()) { state.status = 'auth'; emit(); return; }
  state.status = 'busy'; emit();
  const changed = new Set();
  try {
    if (hooks.before) await hooks.before();
    const ctx = await openRemote();
    if (settings.gDrive) await mergeDrive(ctx, changed);
    let g = false;
    if (settings.gCal && granted('cal')) g = (await syncCalendar(ctx, changed)) || g;
    if (settings.gTasks && granted('tasks')) g = (await syncTasks(ctx, changed)) || g;
    if (g && settings.gDrive) await mergeDrive(ctx, changed);
    if (settings.gCalShow && granted('calRead')) await fetchExternal(ctx, changed);
    await saveIndex(ctx);
    state.status = 'ok'; state.msg = ''; state.last = Date.now();
    settings.gLast = state.last; saveSettings();
  } catch (e) {
    console.error('Sincronización', e);
    if (e.auth) state.status = 'auth';
    else { state.status = 'error'; state.msg = e.message || String(e); }
  }
  emit(changed);
}

// ---------------- Drive: archivos ----------------
async function find(q) {
  const r = await api(`${DRIVE}/files?q=${enc(q)}&fields=files(id,name,modifiedTime)&pageSize=20&spaces=drive`);
  return (await r.json()).files || [];
}

function multipart(meta, body, type) {
  const b = 'cuaderno' + Math.random().toString(36).slice(2);
  return {
    body: new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${type}\r\n\r\n`, body, `\r\n--${b}--`]),
    type: `multipart/related; boundary=${b}`
  };
}

async function resumable(url, method, meta, body, type) {
  const r = await api(url, { method, json: meta || {}, headers: { 'X-Upload-Content-Type': type } });
  const loc = r.headers.get('Location');
  if (!loc) throw new Error('Google no devolvió la dirección de subida');
  const up = await fetch(loc, { method: 'PUT', body });
  if (!up.ok) throw new Error('Fallo al subir un archivo grande (' + up.status + ')');
  return up.json();
}

export async function createFile(folder, name, body, type) {
  const meta = { name, parents: [folder], mimeType: type };
  if (body.size > BIG) return (await resumable(`${UP}/files?uploadType=resumable&fields=id`, 'POST', meta, body, type)).id;
  const mp = multipart(meta, body, type);
  const r = await api(`${UP}/files?uploadType=multipart&fields=id`, { method: 'POST', body: mp.body, headers: { 'Content-Type': mp.type } });
  return (await r.json()).id;
}

async function putContent(fid, body, type) {
  if (body.size > BIG) { await resumable(`${UP}/files/${fid}?uploadType=resumable`, 'PATCH', null, body, type); return true; }
  const r = await api(`${UP}/files/${fid}?uploadType=media`, { method: 'PATCH', body, headers: { 'Content-Type': type }, ok: [404] });
  return r.ok;
}

async function openRemote() {
  let folder = settings.gFolder;
  if (folder) {
    const r = await api(`${DRIVE}/files/${folder}?fields=id,trashed`, { ok: [404] });
    if (!r.ok || (await r.json()).trashed) folder = null;
  }
  if (!folder) {
    const f = await find(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    folder = f[0]?.id;
    if (!folder) {
      const r = await api(`${DRIVE}/files?fields=id`, { method: 'POST', json: { name: FOLDER, mimeType: 'application/vnd.google-apps.folder' } });
      folder = (await r.json()).id;
    }
    settings.gFolder = folder; saveSettings();
  }
  const f = await find(`name='indice.json' and '${folder}' in parents and trashed=false`);
  const ctx = { folder, indexId: f[0]?.id || null, mtime: f[0]?.modifiedTime || null, index: { v: 1, items: {} }, dirty: false };
  if (ctx.indexId) ctx.index = await (await api(`${DRIVE}/files/${ctx.indexId}?alt=media`)).json();
  ctx.index.items = ctx.index.items || {};
  return ctx;
}

async function saveIndex(ctx) {
  if (!ctx.dirty) return;
  if (ctx.indexId) {
    // Si otra tablet guardó el índice mientras tanto, se combinan los dos.
    const m = await (await api(`${DRIVE}/files/${ctx.indexId}?fields=modifiedTime`)).json();
    if (m.modifiedTime !== ctx.mtime) {
      const other = await (await api(`${DRIVE}/files/${ctx.indexId}?alt=media`)).json();
      for (const [k, v] of Object.entries(other.items || {})) if (!ctx.index.items[k] || ctx.index.items[k].u < v.u) ctx.index.items[k] = v;
      ctx.index.cal = ctx.index.cal || other.cal; ctx.index.tl = ctx.index.tl || other.tl;
    }
  }
  const body = new Blob([JSON.stringify(ctx.index)], { type: 'application/json' });
  if (!ctx.indexId || !(await putContent(ctx.indexId, body, 'application/json'))) ctx.indexId = await createFile(ctx.folder, 'indice.json', body, 'application/json');
  ctx.dirty = false;
}

async function pool(tasks, n = 4) {
  let i = 0;
  const worker = async () => { while (i < tasks.length) await tasks[i++](); };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
}

// ---------------- Drive: combinar tablet ↔ nube ----------------
async function upload(ctx, s, v, r) {
  if (s === 'pages' || s === 'blobs') {
    const isPage = s === 'pages';
    const type = isPage ? 'application/json' : (v.data?.type || 'application/octet-stream');
    const body = isPage ? new Blob([JSON.stringify(v)], { type }) : v.data;
    let fid = r?.f;
    if (fid && !(isPage ? await putContent(fid, body, type) : true)) fid = null;
    if (!fid) fid = await createFile(ctx.folder, (isPage ? 'p-' : 'b-') + v.id, body, type);
    if (isPage) return { u: v._u || 1, f: fid, nb: v.nb };
    const { data, ...meta } = v;
    return { u: v._u || 1, f: fid, m: { ...meta, mime: type } };
  }
  return { u: v._u || 1, data: v };
}

async function download(s, r) {
  const res = await api(`${DRIVE}/files/${r.f}?alt=media`);
  if (s === 'pages') return res.json();
  const b = await res.blob();
  const { mime, ...meta } = r.m;
  return { ...meta, data: new Blob([b], { type: mime || b.type }) };
}

async function mergeDrive(ctx, changed) {
  const tombs = (await db.get('kv', 'tombs'))?.v || {};
  const R = ctx.index.items, local = {};
  for (const s of STORES) for (const v of await db.all(s)) local[`${s}/${v.id}`] = v;
  const keys = new Set([...Object.keys(R), ...Object.keys(local), ...Object.keys(tombs)]);
  const tasks = [];
  for (const k of keys) {
    const s = k.slice(0, k.indexOf('/')), id = k.slice(k.indexOf('/') + 1);
    if (!STORES.includes(s)) continue;
    const r = R[k], l = local[k];
    const lu = l ? (l._u || 1) : (tombs[k] || 0), ru = r ? r.u : 0;
    if (ru > lu) {
      if (r.d) { if (l) tasks.push(async () => { await db.del(s, id, { remote: true }); changed.add(k); }); }
      else tasks.push(async () => {
        const v = (s === 'pages' || s === 'blobs') ? await download(s, r) : r.data;
        v._u = r.u;
        await db.put(s, v, { remote: true });
        changed.add(k);
      });
    } else if (lu > ru) {
      if (!l) tasks.push(async () => {
        if (r?.f) await api(`${DRIVE}/files/${r.f}`, { method: 'DELETE', ok: [404] });
        R[k] = { u: lu, d: 1 }; ctx.dirty = true;
      });
      else tasks.push(async () => { R[k] = await upload(ctx, s, l, r); ctx.dirty = true; });
    }
  }
  await pool(tasks);
  await repair(ctx, changed);
}

async function repair(ctx, changed) {
  // Páginas añadidas a la vez en dos tablets: que no se pierda ninguna.
  const nbs = new Map((await db.all('notebooks')).map(n => [n.id, n]));
  const touched = new Set();
  for (const [k, r] of Object.entries(ctx.index.items)) {
    if (!k.startsWith('pages/') || r.d || !r.nb) continue;
    const nb = nbs.get(r.nb), id = k.slice(6);
    if (nb && !nb.pages.includes(id) && await db.get('pages', id)) { nb.pages.push(id); touched.add(nb); }
  }
  for (const nb of touched) { await db.put('notebooks', nb); changed.add('notebooks/' + nb.id); }
  // Un mismo evento/tarea de Google traído por dos tablets: dejar solo uno.
  for (const s of ['events', 'todos']) {
    const seen = new Map();
    for (const v of (await db.all(s)).sort((a, b) => (b._u || 0) - (a._u || 0))) {
      if (!v.gid) continue;
      if (seen.has(v.gid)) { await db.del(s, v.id, { gdel: false }); changed.add(`${s}/${v.id}`); }
      else seen.set(v.gid, v);
    }
  }
}

// Imagen escrita a mano → archivo en Drive, para enlazarla desde Calendar/Tasks.
async function imgLink(ctx, rec) {
  if (!rec.img || rec.imgLink) return rec.imgLink || '';
  const b = await (await fetch(rec.img)).blob();
  const fid = await createFile(ctx.folder, 'letra-' + rec.id + '.png', b, b.type || 'image/png');
  rec.imgLink = `https://drive.google.com/file/d/${fid}/view`;
  return rec.imgLink;
}

async function popGdel(kind) {
  const all = (await db.get('kv', 'gdel'))?.v || [];
  await db.put('kv', { id: 'gdel', v: all.filter(d => d.s !== kind) });
  return all.filter(d => d.s === kind);
}

// ---------------- Google Calendar ----------------
async function ensureCal(ctx) {
  let id = ctx.index.cal;
  if (id) {
    const r = await api(`${CAL}/calendars/${enc(id)}`, { ok: [403, 404] });
    if (r.ok) return id;
  }
  const r = await api(`${CAL}/calendars`, { method: 'POST', json: { summary: 'Cuaderno', description: 'Agenda de la app Cuaderno', timeZone: TZ } });
  id = (await r.json()).id;
  ctx.index.cal = id; ctx.dirty = true;
  return id;
}

function toG(e, link) {
  const g = { summary: e.title || 'Evento escrito a mano' };
  if (link) g.description = 'Escrito a mano: ' + link;
  if (e.time) {
    const [y, m, d] = e.date.split('-').map(Number), [hh, mm] = e.time.split(':').map(Number);
    const s = new Date(y, m - 1, d, hh, mm), en = new Date(s.getTime() + (e.dur || 60) * 60000);
    const iso = x => `${dkey(x)}T${pad(x.getHours())}:${pad(x.getMinutes())}:00`;
    g.start = { dateTime: iso(s), timeZone: TZ }; g.end = { dateTime: iso(en), timeZone: TZ };
  } else {
    const [y, m, d] = e.date.split('-').map(Number);
    g.start = { date: e.date }; g.end = { date: dkey(new Date(y, m - 1, d + 1)) };
  }
  return g;
}

function fromG(g) {
  const o = { title: g.summary || '', rec: !!g.recurrence };
  if (g.start?.date) return { ...o, date: g.start.date, time: '' };
  const s = new Date(g.start.dateTime), en = new Date(g.end?.dateTime || s.getTime() + 3600e3);
  return { ...o, date: dkey(s), time: `${pad(s.getHours())}:${pad(s.getMinutes())}`, dur: Math.max(5, Math.round((en - s) / 60000)) };
}

async function syncCalendar(ctx, changed) {
  const cal = await ensureCal(ctx), base = `${CAL}/calendars/${enc(cal)}/events`;
  let local = false;
  for (const d of await popGdel('events')) await api(`${base}/${enc(d.gid)}`, { method: 'DELETE', ok: [404, 410] });
  // Subir cambios hechos en la tablet
  for (const e of await db.all('events')) {
    if (e.gid && e.gsync && (e._u || 0) <= e.gsync) continue;
    const link = await imgLink(ctx, e);
    let r = null;
    if (e.gid) { r = await api(`${base}/${enc(e.gid)}`, { method: 'PATCH', json: toG(e, link), ok: [404, 410] }); if (!r.ok) r = null; }
    if (!r) r = await api(base, { method: 'POST', json: toG(e, link) });
    const g = await r.json(), t = Date.parse(g.updated) || Date.now();
    e.gid = g.id; e.gsync = t;
    await db.put('events', e, { u: t });
    changed.add('events/' + e.id); local = true;
  }
  // Traer cambios hechos en Google Calendar
  const st = (await db.get('kv', 'gcal'))?.v || {};
  let token = st.cal === cal ? st.token : null, items = [], next = null, newToken = null;
  for (;;) {
    const url = `${base}?showDeleted=true&maxResults=250` + (token ? `&syncToken=${enc(token)}` : '') + (next ? `&pageToken=${enc(next)}` : '');
    const r = await api(url, { ok: [410] });
    if (r.status === 410) { token = null; next = null; items = []; continue; }
    const j = await r.json();
    items.push(...(j.items || []));
    next = j.nextPageToken;
    if (!next) { newToken = j.nextSyncToken; break; }
  }
  const byG = new Map((await db.all('events')).filter(e => e.gid).map(e => [e.gid, e]));
  for (const g of items) {
    const l = byG.get(g.id), gu = Date.parse(g.updated) || Date.now();
    if (g.status === 'cancelled') { if (l) { await db.del('events', l.id, { gdel: false }); changed.add('events/' + l.id); local = true; } continue; }
    if (l && (l.gsync || 0) >= gu) continue;
    const e = { ...(l || { id: uid(), img: null }), ...fromG(g), gid: g.id, gsync: gu };
    await db.put('events', e, { u: gu });
    changed.add('events/' + e.id); local = true;
  }
  await db.put('kv', { id: 'gcal', v: { cal, token: newToken } });
  return local;
}

// ---------------- Tus otros calendarios (solo lectura) ----------------
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

async function fetchExternal(ctx, changed) {
  const cl = await (await api(`${CAL}/users/me/calendarList?maxResults=250`)).json();
  const cals = (cl.items || []).filter(c => c.id !== ctx.index.cal && c.selected !== false && !c.hidden && !c.deleted);
  const now = new Date();
  const tmin = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString();
  const tmax = new Date(now.getFullYear(), now.getMonth() + 7, 1).toISOString();
  const out = [];
  for (const c of cals) {
    let next = null;
    do {
      const r = await api(`${CAL}/calendars/${enc(c.id)}/events?singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=${enc(tmin)}&timeMax=${enc(tmax)}` + (next ? `&pageToken=${enc(next)}` : ''), { ok: [403, 404] });
      if (!r.ok) break;
      const j = await r.json();
      for (const ev of j.items || []) {
        if (ev.status === 'cancelled' || !ev.start) continue;
        const o = { cal: c.id, calName: c.summaryOverride || c.summary || '', color: c.backgroundColor || '#7a7a7a', title: ev.summary || '(sin título)', loc: ev.location || '' };
        if (ev.start.date) Object.assign(o, { date: ev.start.date, endEx: ev.end?.date || dkey(addDays(new Date(ev.start.date + 'T00:00'), 1)), time: '' });
        else {
          const s = new Date(ev.start.dateTime), e = new Date(ev.end?.dateTime || s.getTime() + 3600e3);
          Object.assign(o, { date: dkey(s), endEx: dkey(addDays(new Date(Math.max(s.getTime(), e.getTime() - 1)), 1)), time: `${pad(s.getHours())}:${pad(s.getMinutes())}`, endTime: `${pad(e.getHours())}:${pad(e.getMinutes())}` });
        }
        out.push(o);
      }
      next = j.nextPageToken;
    } while (next);
  }
  const prev = JSON.stringify(await externalEvents());
  await db.put('kv', { id: 'gext', v: { at: Date.now(), events: out } });
  if (prev !== JSON.stringify(out)) changed.add('kv/gext');
}

export async function externalEvents() { return (await db.get('kv', 'gext'))?.v?.events || []; }
export const extOn = (list, key) => list.filter(e => key >= e.date && key < e.endEx).sort((a, b) => (a.time || '').localeCompare(b.time || ''));

// ---------------- Google Tasks ----------------
async function ensureList(ctx) {
  let id = ctx.index.tl;
  if (id) {
    const r = await api(`${TASKS}/users/@me/lists/${enc(id)}`, { ok: [404] });
    if (r.ok) return id;
  }
  const r = await api(`${TASKS}/users/@me/lists`, { method: 'POST', json: { title: 'Cuaderno' } });
  id = (await r.json()).id;
  ctx.index.tl = id; ctx.dirty = true;
  return id;
}

const PLACE = 'Tarea escrita a mano';
function toT(t, link) {
  return { title: t.text || PLACE, notes: link ? 'Escrita a mano: ' + link : undefined, due: t.date + 'T00:00:00.000Z', status: t.done ? 'completed' : 'needsAction', completed: t.done ? undefined : null };
}

async function syncTasks(ctx, changed) {
  const tl = await ensureList(ctx), base = `${TASKS}/lists/${enc(tl)}/tasks`;
  let local = false;
  for (const d of await popGdel('todos')) await api(`${base}/${enc(d.gid)}`, { method: 'DELETE', ok: [404] });
  for (const t of await db.all('todos')) {
    if (t.gid && t.gsync && (t._u || 0) <= t.gsync) continue;
    const link = await imgLink(ctx, t);
    let r = null;
    if (t.gid) { r = await api(`${base}/${enc(t.gid)}`, { method: 'PATCH', json: toT(t, link), ok: [404] }); if (!r.ok) r = null; }
    if (!r) r = await api(base, { method: 'POST', json: toT(t, link) });
    const g = await r.json(), u = Date.parse(g.updated) || Date.now();
    t.gid = g.id; t.gsync = u;
    await db.put('todos', t, { u });
    changed.add('todos/' + t.id); local = true;
  }
  const st = (await db.get('kv', 'gtasks'))?.v || {};
  const since = st.tl === tl ? st.since : null, started = new Date(Date.now() - 60000).toISOString();
  let items = [], next = null;
  do {
    const url = `${base}?showCompleted=true&showDeleted=true&showHidden=true&maxResults=100` + (since ? `&updatedMin=${enc(since)}` : '') + (next ? `&pageToken=${enc(next)}` : '');
    const j = await (await api(url)).json();
    items.push(...(j.items || []));
    next = j.nextPageToken;
  } while (next);
  const byG = new Map((await db.all('todos')).filter(t => t.gid).map(t => [t.gid, t]));
  for (const g of items) {
    const l = byG.get(g.id), gu = Date.parse(g.updated) || Date.now();
    if (g.deleted) { if (l) { await db.del('todos', l.id, { gdel: false }); changed.add('todos/' + l.id); local = true; } continue; }
    if (l && (l.gsync || 0) >= gu) continue;
    const text = (l?.img && g.title === PLACE) ? (l.text || '') : (g.title || '');
    const t = { ...(l || { id: uid(), img: null }), text, date: g.due ? g.due.slice(0, 10) : (l?.date || dkey()), done: g.status === 'completed', gid: g.id, gsync: gu };
    await db.put('todos', t, { u: gu });
    changed.add('todos/' + t.id); local = true;
  }
  await db.put('kv', { id: 'gtasks', v: { tl, since: started } });
  return local;
}
