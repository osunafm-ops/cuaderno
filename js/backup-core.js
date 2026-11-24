// Copia de seguridad local. Lo usan la app y el service worker (por eso no es un módulo con import/export).
// La copia se guarda en el almacén privado de la app dentro de la tablet (carpeta «copias»).
(function (S) {
  const STORES = ['notebooks', 'pages', 'events', 'todos', 'kv'], KEEP = 3;
  const SECRET_KV = ['bk', 'gext', 'mext']; // lo que no hace falta copiar

  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('cuaderno');
    r.onupgradeneeded = () => r.transaction.abort(); // aún no hay datos
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const store = (d, s, m) => d.transaction(s, m || 'readonly').objectStore(s);
  const b64 = b => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = () => rej(f.error); f.readAsDataURL(b); });
  const pad = n => String(n).padStart(2, '0');

  async function build() {
    const d = await open();
    try {
      let parts = [`{"app":"cuaderno","v":1,"date":${Date.now()}`];
      for (const s of STORES) {
        parts.push(`,"${s}":[`);
        const keys = await req(store(d, s).getAllKeys());
        let first = true;
        for (const k of keys) {
          let v = await req(store(d, s).get(k));
          if (!v || (s === 'kv' && SECRET_KV.includes(v.id))) continue;
          // Las claves personales no viajan en la copia.
          if (s === 'kv' && v.id === 'settings') v = { ...v, v: { ...v.v, aiKey: '' } };
          parts.push((first ? '' : ',') + JSON.stringify(v)); first = false;
        }
        parts.push(']');
      }
      parts.push(',"blobs":[');
      let first = true;
      for (const k of await req(store(d, 'blobs').getAllKeys())) {
        const v = await req(store(d, 'blobs').get(k));
        if (!v || !v.data) continue;
        const { data, ...meta } = v;
        parts = [new Blob(parts), (first ? '' : ',') + JSON.stringify(meta).slice(0, -1) + ',"data":"' + await b64(data) + '"}'];
        first = false;
      }
      parts.push(']}');
      return new Blob(parts, { type: 'application/json' });
    } finally { d.close(); }
  }

  async function getState() { const d = await open(); try { return (await req(store(d, 'kv').get('bk')))?.v || {}; } finally { d.close(); } }
  async function setState(ch) {
    const d = await open();
    try {
      const st = store(d, 'kv', 'readwrite');
      const v = (await req(st.get('bk')))?.v || {};
      await req(st.put({ id: 'bk', v: { ...v, ...ch } }));
    } finally { d.close(); }
  }

  const dir = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('copias', { create: true });
  async function list() {
    const out = [];
    try { for await (const [name, f] of (await dir()).entries()) if (name.endsWith('.json')) { const x = await f.getFile(); if (x.size) out.push({ name, size: x.size, date: x.lastModified, file: x }); } } catch (e) { /* sin almacén privado */ }
    return out.sort((a, b) => b.date - a.date);
  }

  async function local(tag) {
    const blob = await build(), n = new Date();
    const name = `cuaderno-${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}${tag ? '-' + tag : ''}.json`;
    const D = await dir(), w = await (await D.getFileHandle(name, { create: true })).createWritable();
    await w.write(blob); await w.close();
    await setState({ local: Date.now() });
    const l = await list();
    for (const f of l.filter(f => /^cuaderno-\d{4}-\d\d-\d\d\.json$/.test(f.name)).slice(KEEP)) await D.removeEntry(f.name);
    for (const f of l.filter(f => f.name.includes('-antes')).slice(2)) await D.removeEntry(f.name);
    return { name, blob };
  }

  // Última hora a la que tocaba copia (por defecto, las 3 de la madrugada).
  function slot(hour) {
    const t = new Date(); t.setHours(hour, 0, 0, 0);
    if (t > Date.now()) t.setDate(t.getDate() - 1);
    return t.getTime();
  }

  // Solo desde el service worker (app cerrada): copia local si toca.
  async function nightly() {
    const d = await open();
    let cfg; try { cfg = (await req(store(d, 'kv').get('settings')))?.v || {}; } finally { d.close(); }
    if (cfg.bkOn === false) return;
    if (((await getState()).local || 0) < slot(cfg.bkHour ?? 3)) await local();
  }

  S.cuadernoBackup = { build, local, list, slot, getState, setState, nightly };
})(self);
