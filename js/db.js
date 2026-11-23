// Almacenamiento local en el propio navegador (IndexedDB). Nada sale de la tablet.
const NAME = 'cuaderno', VER = 1;
const STORES = ['notebooks', 'pages', 'blobs', 'events', 'todos', 'kv'];
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

export const db = {
  get: (s, id) => tx(s, 'readonly', st => st.get(id)),
  put: (s, v) => tx(s, 'readwrite', st => st.put(v)),
  del: (s, id) => tx(s, 'readwrite', st => st.delete(id)),
  all: s => tx(s, 'readonly', st => st.getAll()),
  clear: s => tx(s, 'readwrite', st => st.clear()),
  putMany: (s, arr) => tx(s, 'readwrite', st => { for (const v of arr) st.put(v); }),
  STORES
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
