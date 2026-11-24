// Operaciones con cuadernos, páginas y copias de seguridad.
import { db, uid } from './db.js';
import { W, H } from './ink.js';
import { settings } from './settings.js';
import { fmtDate, fromKey, cap } from './ui.js';

export function newPage(nbId, tpl = 'blanco', extra = {}) {
  return {
    id: uid(), nb: nbId, tpl,
    layers: [{ id: uid(), name: 'Capa 1', vis: true, objs: [] }],
    al: 0, locked: false, mark: false, thumb: null, updated: Date.now(), ...extra
  };
}

export async function newNotebook(kind, title, o = {}) {
  const now = Date.now();
  const nb = {
    id: uid(), kind, title, folder: o.folder || '', tags: o.tags || [], tpl: o.tpl || 'blanco',
    created: now, updated: now, pages: [], cover: o.cover || null, last: 0, ...(o.extra || {})
  };
  const pg = newPage(nb.id, nb.tpl, o.page || {});
  if (o.objs) pg.layers[0].objs.push(...o.objs);
  nb.pages.push(pg.id);
  await db.put('pages', pg);
  await db.put('notebooks', nb);
  return nb;
}

export async function deleteNotebook(nb) {
  for (const id of nb.pages) await db.del('pages', id);
  if (nb.blob) await db.del('blobs', nb.blob);
  for (const r of nb.recs || []) await db.del('blobs', r);
  await db.del('notebooks', nb.id);
  const r = (await getRecent()).filter(x => x !== nb.id);
  await db.put('kv', { id: 'recent', v: r });
}

export async function duplicateNotebook(nb) {
  const c = { ...JSON.parse(JSON.stringify(nb)), id: uid(), title: nb.title + ' (copia)', created: Date.now(), updated: Date.now(), pages: [], recs: [] };
  if (nb.blob) {
    const b = await db.get('blobs', nb.blob);
    if (b) { c.blob = uid(); await db.put('blobs', { ...b, id: c.blob }); }
  }
  const pages = [];
  for (const pid of nb.pages) {
    const p = await db.get('pages', pid);
    if (!p) continue;
    const q = { ...p, id: uid(), nb: c.id };
    pages.push(q); c.pages.push(q.id);
  }
  await db.putMany('pages', pages);
  await db.put('notebooks', c);
  return c;
}

export async function getRecent() { return (await db.get('kv', 'recent'))?.v || []; }
export async function touchRecent(id) {
  const r = (await getRecent()).filter(x => x !== id);
  r.unshift(id);
  await db.put('kv', { id: 'recent', v: r.slice(0, 12) });
}

export function imageObj(src, w, h, { max = 0.8 } = {}) {
  const s = Math.min(W * max / w, H * max / h, 2);
  const ow = w * s, oh = h * s;
  return { t: 'i', x: (W - ow) / 2, y: (H - oh) / 2, w: ow, h: oh, src };
}

export async function fileToImage(file, max = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = url; });
    const s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return { src: c.toDataURL('image/webp', 0.9), w: c.width, h: c.height };
  } finally { URL.revokeObjectURL(url); }
}

export async function newPicking(img, title) {
  const o = imageObj(img.src, img.w, img.h, { max: 0.9 });
  const t = title || 'Recorte · ' + new Date().toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return newNotebook('picking', t, { tpl: 'blanco', objs: [o], cover: img.src });
}

export async function dailyNotebook(key) {
  const all = await db.all('notebooks');
  let nb = all.find(n => n.kind === 'daily' && n.date === key);
  if (!nb) nb = await newNotebook('daily', cap(fmtDate(fromKey(key), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })), { tpl: 'dia', extra: { date: key } });
  return nb;
}

const blobToDataURL = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });

export async function exportAll() {
  const out = { app: 'cuaderno', v: 1, date: Date.now() };
  for (const s of ['notebooks', 'pages', 'events', 'todos', 'kv']) out[s] = await db.all(s);
  const bl = await db.all('blobs');
  out.blobs = [];
  for (const b of bl) out.blobs.push({ ...b, data: await blobToDataURL(b.data) });
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}

// La copia no lleva claves: se conservan las de esta tablet.
async function saveSettingsAfter() {
  const r = await db.get('kv', 'settings');
  if (r?.v && !r.v.aiKey && settings.aiKey) { r.v.aiKey = settings.aiKey; await db.put('kv', r); }
}

export async function importAll(file) {
  const o = JSON.parse(await file.text());
  if (o.app !== 'cuaderno') throw new Error('El archivo no es una copia de Cuaderno');
  for (const s of ['notebooks', 'pages', 'events', 'todos', 'kv']) { await db.clear(s); await db.putMany(s, o[s] || []); }
  await db.clear('blobs');
  for (const b of o.blobs || []) await db.put('blobs', { ...b, data: await (await fetch(b.data)).blob() });
  await saveSettingsAfter();
}
