// Service worker: la app funciona sin conexión una vez abierta la primera vez.
// Con internet siempre carga la última versión publicada; sin internet usa la copia guardada.
importScripts('js/backup-core.js');
const V = 'cuaderno-v14';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/ui.js', 'js/icons.js', 'js/settings.js', 'js/store.js',
  'js/ink.js', 'js/templates.js', 'js/render.js', 'js/pdf.js', 'js/editor.js',
  'js/google.js', 'js/sync.js', 'js/ai.js', 'js/richtext.js', 'js/folders.js',
  'js/checklist.js', 'js/table.js', 'js/tasks.js', 'js/reading.js', 'js/backup.js', 'js/backup-core.js', 'js/ms.js',
  'icons/icon-192.png', 'icons/icon-512.png'
];
const SHARE = 'cuaderno-compartir';
// Solo se guardan copias de la propia app y de sus librerías; nunca de las APIs de Google.
const CACHE_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== SHARE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Copia de seguridad de cada noche con la app cerrada (solo si está instalada y Chrome lo permite).
self.addEventListener('periodicsync', e => { if (e.tag === 'copia-noche') e.waitUntil(self.cuadernoBackup.nightly()); });

// Fotos compartidas desde Google Fotos, la galería u otra app: se guardan un momento y la app las recoge.
async function receiveShare(req) {
  const c = await caches.open(SHARE);
  let n = 0;
  try {
    for (const f of (await req.formData()).getAll('fotos')) {
      if (!f || !f.size) continue;
      await c.put('compartido/' + Date.now() + '-' + n++, new Response(f, { headers: { 'Content-Type': f.type || 'image/jpeg' } }));
    }
  } catch (err) { /* sin archivos */ }
  return Response.redirect('./#/compartir', 303);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/compartir')) { e.respondWith(receiveShare(req)); return; }
  if (req.method !== 'GET' || !req.url.startsWith('http')) return;
  const url = new URL(req.url);
  const own = url.origin === self.location.origin;
  if (!own && !CACHE_HOSTS.includes(url.hostname)) return;
  e.respondWith(caches.open(V).then(async cache => {
    const opts = { ignoreSearch: req.mode === 'navigate' };
    if (own) {
      // Archivos de la app: primero internet (sin caché del navegador), si falla, la copia guardada.
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        return (await cache.match(req, opts)) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
      }
    }
    // Librerías y fuentes externas: copia guardada al instante y se actualiza en segundo plano.
    const hit = await cache.match(req);
    const net = fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
