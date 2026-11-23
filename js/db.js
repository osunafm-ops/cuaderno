// Almacenamiento local en el propio navegador (IndexedDB).
// Cada cambio queda marcado con su hora (_u) para poder sincronizar entre tablets.
const NAME = 'cuaderno', VER = 1;
const STORES = ['notebooks', 'pages', 'blobs', 'events', 'todos', 'kv'];
export const SYNCED = new Set(['notebooks', 'pages', 'events', 'todos', 'blobs']);
export const hooks = { change: null };
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

const get = (s, id) => tx(s, 'readonly', st => st.get(id));

function stamp(s, v, opt) {
  if (!SYNCED.has(s) || opt.remote) return false;
  v._u = opt.u ?? Date.now();
  return opt.u === undefined; // los cambios que vienen de la propia sincronización no vuelven a lanzarla
}
function changed() { if (hooks.change) try { hooks.change(); } catch (e) { console.warn(e); } }

async function kvList(id) { return (await get('kv', id))?.v; }

export const db = {
  get,
  async put(s, v, opt = {}) {
    const local = stamp(s, v, opt);
    await tx(s, 'readwrite', st => st.put(v));
    if (local) changed();
  },
  async putMany(s, arr, opt = {}) {
    let local = false;
    for (const v of arr) local = stamp(s, v, opt) || local;
    await tx(s, 'readwrite', st => { for (const v of arr) st.put(v); });
    if (local) changed();
  },
  async del(s, id, opt = {}) {
    if (SYNCED.has(s) && !opt.remote) {
      if ((s === 'events' || s === 'todos') && opt.gdel !== false) {
        const r = await get(s, id);
        if (r?.gid) {
          const g = (await kvList('gdel')) || [];
          g.push({ s, gid: r.gid });
          await tx('kv', 'readwrite', st => st.put({ id: 'gdel', v: g }));
        }
      }
      const t = (await kvList('tombs')) || {};
      t[`${s}/${id}`] = Date.now();
      await tx('kv', 'readwrite', st => st.put({ id: 'tombs', v: t }));
    }
    await tx(s, 'readwrite', st => st.delete(id));
    if (SYNCED.has(s) && !opt.remote) changed();
  },
  all: s => tx(s, 'readonly', st => st.getAll()),
  clear: s => tx(s, 'readwrite', st => st.clear()),
  STORES
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
