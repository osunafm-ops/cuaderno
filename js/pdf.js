// Lectura de PDF con pdf.js (se descarga la primera vez y queda guardado para usar sin conexión).
import { db } from './db.js';
import { W, H } from './ink.js';
import { loadScript } from './ui.js';

const BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
let lib;
async function L() {
  if (!lib) {
    await loadScript(BASE + 'pdf.min.js');
    lib = window.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.js';
  }
  return lib;
}

const docs = new Map();
export async function getDoc(id, buf) {
  if (docs.has(id)) return docs.get(id);
  const p = (async () => {
    const l = await L();
    let data = buf;
    if (!data) { const r = await db.get('blobs', id); data = await r.data.arrayBuffer(); }
    return l.getDocument({ data: new Uint8Array(data) }).promise;
  })();
  docs.set(id, p);
  p.catch(() => docs.delete(id));
  return p;
}

const cache = new Map();
export function pdfBitmap(id, num, q = 1.5) {
  const k = id + ':' + num + ':' + q;
  if (cache.has(k)) return cache.get(k);
  const pr = (async () => {
    const doc = await getDoc(id);
    const pg = await doc.getPage(num);
    const v0 = pg.getViewport({ scale: 1 });
    const s = Math.min(W * q / v0.width, H * q / v0.height);
    const vp = pg.getViewport({ scale: s });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: x, viewport: vp }).promise;
    return c;
  })();
  cache.set(k, pr);
  pr.catch(() => cache.delete(k));
  if (cache.size > 8) cache.delete(cache.keys().next().value);
  return pr;
}

export function fitRect(w, h) {
  const s = Math.min(W / w, H / h);
  return { w: w * s, h: h * s, x: (W - w * s) / 2, y: (H - h * s) / 2 };
}
