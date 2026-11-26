// Estructura principal: barra lateral, pantallas y botones inferiores.
import { db, uid } from './db.js';
import { settings, loadSettings, saveSettings } from './settings.js';
import { h, icon, esc, toast, modal, prompt, confirm, menu, pickFiles, download, flash, closePop, dkey, fromKey, fmtDate, fmtTime, fmtDur, cap, pad } from './ui.js';
import * as store from './store.js';
import { Editor } from './editor.js';
import { TEMPLATES, drawTemplate } from './templates.js';
import { W, H } from './ink.js';
import { getDoc, pdfBitmap, fitRect } from './pdf.js';
import { notebookPDF, safeName } from './render.js';
import { hooks as dbHooks } from './db.js';
import * as G from './google.js';
import * as sync from './sync.js';
import * as AI from './ai.js';
import * as FD from './folders.js';
import * as BK from './backup.js';
import * as MS from './ms.js';
import * as TK from './tasks.js';
import * as RDG from './reading.js';

const app = document.getElementById('app');
let editor = null, panes = [], reader = null, timer = null, installEvt = null;

const NAV = [
  ['home', 'Inicio', 'home'], ['papel', 'Cuadernos', 'notebook'], ['agenda', 'Agenda', 'calendar'], ['tareas', 'Tareas', 'task'],
  ['reuniones', 'Reuniones', 'mic'], ['biblioteca', 'Biblioteca', 'library'], ['lectura', 'Lectura', 'book'], ['recortes', 'Recortes', 'picking'], ['notas', 'Notas', 'memo']
];
const KIND_ROUTE = { paper: 'papel', meeting: 'reuniones', book: 'biblioteca', picking: 'recortes', memo: 'notas', daily: 'agenda', reading: 'lectura' };
const KIND_NAME = { paper: 'Cuaderno', meeting: 'Reunión', book: 'Libro', picking: 'Recorte', memo: 'Nota', daily: 'Página del día', reading: 'Lectura' };

app.innerHTML = `<div class="shell" id="main">
    <nav class="side">${NAV.map(([r, n, i]) => `<a href="#/${r}" data-r="${r}">${icon(i)}<span>${n}</span></a>`).join('')}
      <div class="sp"></div><a href="#/ajustes" data-r="ajustes">${icon('settings')}<span>Ajustes</span></a></nav>
    <main class="content" id="view"></main>
  </div>
  <div id="edroot" hidden></div>
  <div class="bezel">
    <button data-b="back" title="Atrás">${icon('back')}</button>
    <button data-b="home" title="Inicio (mantén pulsado: recientes)">${icon('home')}</button>
    <button data-b="memo" title="Nota rápida">${icon('note')}</button>
    <button class="cloud" data-b="sync" title="Sincronización con Google" hidden>${icon('cloud')}<span></span></button>
  </div>`;
const main = document.getElementById('main'), edroot = document.getElementById('edroot'), view = document.getElementById('view');

// ---------------- botones inferiores (como los de la tableta) ----------------
const bez = app.querySelector('.bezel');
let lpT = null, lpFired = false;
let swipe0 = null;
bez.addEventListener('pointerdown', e => { swipe0 = { x: e.clientX, t: Date.now() }; });
bez.addEventListener('pointerup', e => {
  if (!swipe0) return;
  const dx = e.clientX - swipe0.x; swipe0 = null;
  if (Math.abs(dx) > 70 && editor) { lpFired = true; clearTimeout(lpT); editor.go(dx < 0 ? 1 : -1); setTimeout(() => { lpFired = false; }, 50); }
});
bez.addEventListener('pointerdown', e => {
  const b = e.target.closest('[data-b=home]'); if (!b) return;
  lpFired = false;
  lpT = setTimeout(() => { lpFired = true; recentsMenu(b); }, 550);
});
bez.addEventListener('pointerup', () => clearTimeout(lpT));
bez.addEventListener('pointerleave', () => clearTimeout(lpT));
bez.addEventListener('click', async e => {
  const b = e.target.closest('[data-b]'); if (!b) return;
  if (lpFired && b.dataset.b !== 'home') return;
  if (b.dataset.b === 'back') history.length > 1 ? history.back() : go('#/home');
  if (b.dataset.b === 'home' && !lpFired) go('#/home');
  if (b.dataset.b === 'memo') quickMemo();
  if (b.dataset.b === 'sync') cloudTap();
});

// ---------------- sincronización con Google ----------------
async function connectGoogle() {
  try {
    await G.signIn();
    toast('Conectado con Google. Sincronizando…');
    await sync.syncNow();
    if (sync.state.status === 'ok') toast('Sincronizado');
    BK.run().catch(e => console.warn('Copia', e));
  } catch (e) { toast(e.message || 'No se pudo conectar', 5000); sync.refreshState(); }
}
async function cloudTap() {
  if (!settings.gConnected) return go('#/ajustes');
  if (!G.hasToken()) return connectGoogle();
  await sync.syncNow();
  const s = sync.state;
  toast(s.status === 'ok' ? 'Sincronizado' : s.status === 'error' ? 'Error: ' + s.msg : 'Hay que volver a conectar', s.status === 'error' ? 6000 : 2400);
}
function paintCloud() {
  const b = bez.querySelector('.cloud'), s = sync.state;
  b.hidden = !settings.gConnected;
  b.className = 'cloud ' + s.status;
  b.querySelector('span').textContent =
    s.status === 'busy' ? 'Sincronizando…' : s.status === 'auth' ? 'Toca para sincronizar' : s.status === 'error' ? 'Error · reintentar' :
    s.last ? 'Sincronizado ' + fmtTime(s.last) : 'Sincronizar';
}
sync.onSync((s, changed) => {
  paintCloud();
  if (changed && changed.size && !editor && !document.querySelector('.modal-bg,.pop') && !main.hidden && !(document.activeElement && document.activeElement.matches('input,textarea'))) route();
});
let syncT = null;
dbHooks.change = () => {
  if (!settings.gConnected || !G.hasToken()) return;
  clearTimeout(syncT);
  syncT = setTimeout(() => sync.syncNow(), 15000);
};
setInterval(() => { if (settings.gConnected && G.hasToken()) sync.syncNow(); else if (settings.gConnected) sync.refreshState(); }, 180000);
document.addEventListener('visibilitychange', () => {
  if (settings.gConnected && G.hasToken()) { if (document.visibilityState === 'visible') sync.syncNow(); else if (syncT) { clearTimeout(syncT); sync.syncNow(); } }
});

async function recentsMenu(anchor) {
  const ids = await store.getRecent();
  const nbs = (await Promise.all(ids.slice(0, 8).map(id => db.get('notebooks', id)))).filter(Boolean);
  if (!nbs.length) return toast('Aún no hay recientes');
  menu(anchor, nbs.map(n => ({ icon: KIND_ICON[n.kind], label: `${n.title} · ${KIND_NAME[n.kind]}`, run: () => openNb(n) })), { side: 'below' });
}
const KIND_ICON = { paper: 'notebook', meeting: 'mic', book: 'library', picking: 'picking', memo: 'memo', daily: 'calendar', reading: 'book' };

const go = hash => { if (location.hash === hash) route(); else location.hash = hash; };
const openNb = (nb, page) => nb.kind === 'reading' ? RDG.open(nb, ctxR) : go(`#/ed/${nb.id}${page !== undefined ? '/' + page : ''}`);

async function quickMemo() {
  const nb = await store.newNotebook('memo', 'Nota · ' + new Date().toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), { tpl: 'rayas_f' });
  openNb(nb);
}

// ---------------- navegación ----------------
async function doRoute() {
  clearInterval(timer); timer = null;
  closePop();
  document.querySelectorAll('.modal-bg').forEach(m => m.remove());
  const old = panes; panes = []; editor = null;
  if (reader) { const x = reader; reader = null; await x.destroy(); }
  for (const e of old) await e.destroy();
  const [, r, a, b, c, d] = location.hash.split('/');
  if (r !== 'ed' && !(r === 'lectura' && a)) setZen(false);
  if (r === 'lectura' && a) {
    const b = await db.get('notebooks', a);
    if (!b || b.kind !== 'reading') return go('#/lectura');
    main.hidden = true; edroot.hidden = false; edroot.classList.remove('two');
    const rd = await RDG.reader(edroot, b, ctxR);
    if (location.hash.startsWith('#/lectura/' + a)) reader = rd; else await rd.destroy();
    return;
  }
  if (r === 'ed') {
    const nb = await db.get('notebooks', a);
    if (!nb) return go('#/home');
    if (nb.kind === 'reading') return go('#/lectura/' + nb.id);
    main.hidden = true; edroot.hidden = false;
    const nb2 = c ? (c === a ? nb : await db.get('notebooks', c)) : null;
    edroot.innerHTML = ''; edroot.classList.toggle('two', !!nb2);
    const mk = async (n, i, right) => {
      const host = h('<div class="edpane"></div>');
      edroot.append(host);
      const e = new Editor(host, n, i !== undefined ? +i : undefined, { split: !!nb2, right: nb2 ? right : undefined, onSplit: splitMenu, onClose: closePane, onFull: toggleFull, onActive: setActive });
      panes.push(e);
      await e.init();
      return e;
    };
    editor = await mk(nb, b, false);
    if (nb2) { await mk(nb2, d, true); setActive(editor); }
    flash();
    return;
  }
  main.hidden = false; edroot.hidden = true; edroot.innerHTML = '';
  const key = VIEWS[r] ? r : 'home';
  app.querySelectorAll('.side a').forEach(x => x.classList.toggle('on', x.dataset.r === key));
  view.scrollTop = 0;
  await VIEWS[key](view, a);
  flash();
}
// Los cambios de pantalla van de uno en uno, para no mezclar dos aperturas a la vez.
let routing = Promise.resolve();
const route = () => (routing = routing.then(doRoute).catch(e => console.error(e)));
addEventListener('hashchange', route);

const ctxR = { route: () => route(), go: h => go(h), toggleFull: () => toggleFull(), importPdf: () => importPdf() };

// ---------------- dos páginas a la vez y pantalla completa ----------------
function setActive(e) {
  editor = e;
  for (const p of panes) p.root.classList.toggle('act', p === e && panes.length > 1);
}
const setHash = hash => { history.replaceState(null, '', hash); return route(); };
const refOf = e => `${e.nb.id}/${e.idx}`;

function closePane(e) {
  const keep = panes.find(p => p !== e);
  if (keep) setHash('#/ed/' + refOf(keep));
}

async function splitMenu(e, btn) {
  const other = panes.find(p => p !== e), nb = e.nb;
  const open = (id, i) => setHash(other
    ? '#/ed/' + (panes[0] === e ? `${id}/${i}/${refOf(other)}` : `${refOf(other)}/${id}/${i}`)
    : `#/ed/${refOf(e)}/${id}/${i}`);
  const word = other ? 'Poner aquí' : 'Abrir al lado';
  menu(btn, [
    { icon: 'pages', label: `${word} otra página de este cuaderno`, run: () => pickPage(nb, i => open(nb.id, i), e.idx) },
    { icon: 'notebook', label: `${word} otro cuaderno…`, run: () => pickNotebook(n => n.pages.length > 1 ? pickPage(n, i => open(n.id, i), n.last || 0) : open(n.id, 0)) },
    other && { icon: 'repeat', label: 'Cambiar de lado', run: () => setHash(`#/ed/${refOf(panes[1])}/${refOf(panes[0])}`) },
    other && { icon: 'x', label: 'Cerrar este lado', run: () => closePane(e) }
  ]);
}

async function pickPage(nb, done, cur) {
  for (const p of panes) await p.flushSave();
  const pages = await Promise.all(nb.pages.map(id => db.get('pages', id)));
  const el = h(`<div class="pgview"><div class="pgrid">${pages.map((p, i) => `<div class="pth ${i === cur ? 'on' : ''}" data-i="${i}"><button class="im" style="${p?.thumb ? `background-image:url(${p.thumb})` : ''}">${p?.thumb ? '' : `<span class="sub">${p?.pdf ? 'Pág. ' + p.pdf : 'Vacía'}</span>`}</button><div class="row"><span>${i + 1}</span></div></div>`).join('')}</div></div>`);
  let close;
  el.addEventListener('click', ev => { const b = ev.target.closest('[data-i]'); if (b) { close(); done(+b.dataset.i); } });
  modal('Elige una página · ' + nb.title, el, [{ label: 'Cancelar', value: null }], { wide: true, mount: c => { close = c; } });
}

async function pickNotebook(done) {
  const rec = await store.getRecent();
  const list = (await db.all('notebooks')).filter(n => !FD.isFolder(n) && n.kind !== 'reading').sort((a, b) => b.updated - a.updated);
  list.sort((a, b) => (rec.indexOf(a.id) + 1 || 99) - (rec.indexOf(b.id) + 1 || 99));
  const el = h(`<div><label class="search" style="margin-bottom:12px">${icon('search')}<input placeholder="Buscar cuaderno"></label><div class="list"></div></div>`);
  const box = el.querySelector('.list');
  const draw = q => { box.innerHTML = list.filter(n => n.title.toLowerCase().includes(q)).slice(0, 60).map(n => `<button class="li" data-id="${n.id}" style="width:100%;text-align:left">${icon(KIND_ICON[n.kind])}<span class="tx">${esc(n.title)}</span><div class="grow"></div><span class="sub">${KIND_NAME[n.kind]} · ${n.pages.length} pág.</span></button>`).join('') || '<div class="li sub">Nada coincide</div>'; };
  draw('');
  el.querySelector('input').oninput = e => draw(e.target.value.trim().toLowerCase());
  let close;
  box.onclick = e => { const b = e.target.closest('[data-id]'); if (b) { close(); done(list.find(n => n.id === b.dataset.id)); } };
  modal('Elige un cuaderno', el, [{ label: 'Cancelar', value: null }], { wide: true, mount: c => { close = c; } });
}

function setZen(on) {
  document.documentElement.classList.toggle('zen', on);
  if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
function toggleFull() {
  const on = !document.documentElement.classList.contains('zen');
  setZen(on);
  if (on) document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) document.documentElement.classList.remove('zen'); });

// ---------------- piezas comunes ----------------
function cover(nb, meta) {
  const isBook = nb.kind === 'book', bg = nb.cover ? `background-image:url(${nb.cover})` : '';
  return `<div class="cover ${isBook ? 'book' : ''}" data-open="${nb.id}">
    <div class="pg" style="${bg}">${nb.cover ? '' : `<span class="ph">${icon(KIND_ICON[nb.kind])}</span>`}
      <button class="dots" data-more="${nb.id}" title="Opciones">${icon('more')}</button></div>
    <div class="t">${esc(nb.title)}</div><div class="m">${meta ?? fmtDate(nb.updated)}</div></div>`;
}

function bindCovers(el, nbs, refresh) {
  el.addEventListener('click', e => {
    const m = e.target.closest('[data-more]');
    if (m) { e.stopPropagation(); const nb = nbs.find(n => n.id === m.dataset.more); nbMenu(m, nb, refresh); return; }
    const o = e.target.closest('[data-open]');
    if (o) { const nb = nbs.find(n => n.id === o.dataset.open); if (nb) openNb(nb); }
  });
}

function nbMenu(anchor, nb, refresh) {
  menu(anchor, [
    { icon: 'notebook', label: 'Abrir', run: () => openNb(nb) },
    { icon: 'pen2', label: 'Renombrar', run: async () => {
      const r = await prompt('Renombrar', [{ name: 't', label: 'Nombre', value: nb.title }]);
      if (r && r.t.trim()) { nb.title = r.t.trim(); await db.put('notebooks', nb); refresh(); }
    } },
    nb.kind !== 'daily' && { icon: 'move', label: 'Mover a carpeta', run: async () => {
      const to = await FD.pickFolder(`Mover «${nb.title}» a…`, { current: nb.parent || '' });
      if (to !== null && await FD.moveTo(nb, to)) { toast('Movido'); refresh(); }
    } },
    nb.kind === 'paper' && { icon: 'tag', label: 'Etiquetas', run: async () => {
      const r = await prompt('Etiquetas', [{ name: 't', label: 'Separadas por comas', value: (nb.tags || []).join(', ') }]);
      if (r) { nb.tags = r.t.split(',').map(s => s.trim()).filter(Boolean); await db.put('notebooks', nb); refresh(); }
    } },
    nb.kind === 'memo' && { icon: 'bell', label: nb.remind ? 'Cambiar recordatorio' : 'Poner recordatorio', run: () => setReminder(nb, refresh) },
    { icon: 'dup', label: 'Duplicar', run: async () => { await store.duplicateNotebook(nb); refresh(); toast('Duplicado'); } },
    { icon: 'download', label: 'Exportar PDF', run: async () => {
      const t = toast('Preparando PDF…', 60000);
      try {
        const pages = (await Promise.all(nb.pages.map(id => db.get('pages', id)))).filter(Boolean);
        download(await notebookPDF(nb, pages, (i, n) => { t.textContent = `Preparando PDF… ${i}/${n}`; }), safeName(nb.title) + '.pdf');
      } catch (e) { toast('No se pudo crear el PDF'); } finally { t.remove(); }
    } },
    { icon: 'trash', label: 'Eliminar', danger: true, run: async () => {
      if (!await confirm(`¿Eliminar «${nb.title}»?`, 'Eliminar', 'Se borrarán todas sus páginas. No se puede deshacer.')) return;
      await store.deleteNotebook(nb); refresh();
    } }
  ]);
}

// Evento de tus otros calendarios de Google (solo lectura).
const extRow = e => `<div class="li ext"><i class="cdot" style="background:${esc(e.color)}"></i><b>${e.time ? esc(e.time) + (e.endTime ? '–' + esc(e.endTime) : '') : 'Todo el día'}</b><span class="tx">${esc(e.title)}${e.loc ? ` <span class="sub">· ${esc(e.loc)}</span>` : ''}</span><div class="grow"></div><span class="sub">${esc(e.calName)}</span></div>`;

const empty = (ic, t, s) => `<div class="empty">${icon(ic)}<b>${t}</b><span>${s}</span></div>`;

function tplPicker(sel) {
  const wrap = h('<div class="tpls"></div>');
  for (const t of TEMPLATES) {
    const b = h(`<button type="button" class="tpl ${t.id === sel ? 'on' : ''}" data-id="${t.id}"><canvas width="120" height="160"></canvas><span>${t.n}</span></button>`);
    const x = b.querySelector('canvas').getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 120, 160); x.scale(120 / W, 160 / H);
    drawTemplate(x, t.id, W, H, { thick: 7, alpha: 1.6 });
    b.onclick = () => { wrap.querySelectorAll('.tpl').forEach(e => e.classList.toggle('on', e === b)); wrap.dataset.sel = t.id; };
    wrap.append(b);
  }
  wrap.dataset.sel = sel;
  return wrap;
}

// ---------------- pantallas ----------------
const VIEWS = {};

VIEWS.home = async v => {
  const now = new Date(), today = dkey(now);
  const nbs = await db.all('notebooks');
  const recent = (await store.getRecent()).map(id => nbs.find(n => n.id === id)).filter(Boolean).slice(0, 6);
  const evs = (await db.all('events')).filter(e => e.date === today).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const tds = (await db.all('todos')).filter(t => t.date === today || (!t.done && t.date < today));
  const ext = sync.extOn(await extAll(), today);
  const count = k => nbs.filter(n => n.kind === k).length;
  const tp = await TK.pendingCount();
  const stars = nbs.flatMap(n => (n.marks || []).filter(m => m.type === 'star' && n.pages.includes(m.pid)).map(m => ({ ...m, nb: n, pi: n.pages.indexOf(m.pid) }))).slice(-8).reverse();
  const tiles = [
    ['papel', 'notebook', 'Cuadernos', `${count('paper')} cuadernos`],
    ['agenda', 'calendar', 'Agenda', `${evs.length + ext.length} eventos hoy`],
    ['tareas', 'task', 'Tareas', `${tp.n} pendientes${tp.late ? ' · ' + tp.late + ' atrasadas' : ''}`],
    ['reuniones', 'mic', 'Reuniones', `${count('meeting')} reuniones`],
    ['biblioteca', 'library', 'Biblioteca', `${count('book')} documentos`],
    ['lectura', 'book', 'Lectura', `${nbs.filter(n => n.kind === 'reading' && n.status === 'leyendo').length} leyendo`],
    ['recortes', 'picking', 'Recortes', `${count('picking')} recortes`],
    ['notas', 'memo', 'Notas rápidas', `${count('memo')} notas`]
  ];
  v.innerHTML = `<div class="hero"><div><div class="sub">${cap(fmtDate(now, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</div>
      <div class="clock">${fmtTime(now)}</div></div><div class="grow"></div><div class="sub bat"></div></div>
    <div class="tiles">${tiles.map(([r, i, n, s]) => `<a class="tile" href="#/${r}">${icon(i)}<div><b>${n}</b><span>${s}</span></div></a>`).join('')}</div>
    <div class="cols">
      <section><h2>Continuar</h2>${recent.length ? `<div class="covers rc">${recent.map(n => cover(n, KIND_NAME[n.kind] + ' · ' + fmtDate(n.updated))).join('')}</div>` : empty('notebook', 'Nada reciente', 'Crea un cuaderno o una nota rápida para empezar.')}</section>
      <section><h2>Hoy</h2><div class="list">
        ${evs.map(e => `<div class="li">${icon('clock')}<b>${esc(e.time)}</b><span class="tx">${esc(e.title || '')}</span>${e.img ? `<img src="${e.img}" alt="">` : ''}</div>`).join('')}
        ${ext.map(extRow).join('')}
        ${tds.map(t => `<div class="li ${t.done ? 'done' : ''}" data-td="${t.id}"><button class="chk">${t.done ? icon('check') : ''}</button><span class="tx">${esc(t.text || '')}</span>${t.img ? `<img src="${t.img}" alt="">` : ''}${t.date < today ? '<span class="sub">atrasada</span>' : ''}</div>`).join('')}
        ${!evs.length && !tds.length && !ext.length ? '<div class="li sub">Sin eventos ni tareas para hoy.</div>' : ''}
      </div><a class="btn sm ghost" href="#/agenda" style="margin-top:12px">${icon('calendar')} Abrir agenda</a>
      ${stars.length ? `<h2>${icon('star', 'inl')} Destacados</h2><div class="list stars">${stars.map(m => `<div class="li mk" data-nb="${m.nb.id}" data-pi="${m.pi}"><img src="${m.img}" alt=""><div class="tx"><b>${esc(m.label || m.nb.title)}</b><br><span class="sub">${esc(m.nb.title)} · p. ${m.pi + 1}</span></div></div>`).join('')}</div>` : ''}</section>
    </div>`;
  bindCovers(v.querySelector('.rc') || h('<div></div>'), recent, () => route());
  v.querySelectorAll('.stars [data-nb]').forEach(r => r.onclick = () => go(`#/ed/${r.dataset.nb}/${r.dataset.pi}`));
  v.querySelectorAll('[data-td] .chk').forEach(b => b.onclick = async () => {
    const t = tds.find(x => x.id === b.closest('[data-td]').dataset.td); await TK.setDone(t); route();
  });
  const clk = v.querySelector('.clock');
  timer = setInterval(() => { clk.textContent = fmtTime(new Date()); }, 15000);
  navigator.getBattery?.().then(b => { const el = v.querySelector('.bat'); if (el) el.textContent = `Batería ${Math.round(b.level * 100)} %${b.charging ? ' · cargando' : ''}`; }).catch(() => {});
};

// ---- Cuadernos: explorador de carpetas en árbol ----
const F = { tag: '', q: '', sort: 'updated', open: new Set() };
const inFolders = n => !FD.isFolder(n) && n.kind !== 'daily' && n.kind !== 'reading';
const DAYS = 'dias'; // carpeta fija con las páginas del día de la Agenda

VIEWS.papel = async (v, cur = '') => {
  await FD.migrate();
  const allNb = await db.all('notebooks');
  const folders = allNb.filter(FD.isFolder);
  if (cur && cur !== DAYS && !folders.find(f => f.id === cur)) cur = '';
  const docs = allNb.filter(inFolders), days = allNb.filter(n => n.kind === 'daily').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const inDays = cur === DAYS;
  const path = inDays ? [] : FD.pathOf(cur, folders);
  path.forEach(f => F.open.add(f.id));
  const count = id => folders.filter(f => (f.parent || '') === id).length + docs.filter(d => (d.parent || '') === id).length;
  const sorter = (a, b) => F.sort === 'name' ? a.title.localeCompare(b.title, 'es', { numeric: true }) : F.sort === 'created' ? b.created - a.created : b.updated - a.updated;
  const tags = [...new Set(docs.flatMap(n => n.tags || []))].sort();
  const q = F.q.trim().toLowerCase();
  // En la raíz se ven los cuadernos; en cada carpeta, todo lo que se haya movido a ella.
  const here = d => (d.parent || '') === cur && (cur || d.kind === 'paper');
  let subf = q ? folders.filter(f => f.title.toLowerCase().includes(q)) : inDays ? [] : FD.childrenOf(cur, folders);
  const hit = d => d.title.toLowerCase().includes(q) || Object.values(d.txt || {}).some(t => t.toLowerCase().includes(q));
  const snippet = d => {
    if (d.title.toLowerCase().includes(q)) return '';
    for (const [pid, t] of Object.entries(d.txt || {})) {
      const i = t.toLowerCase().indexOf(q);
      if (i >= 0) return `«…${t.slice(Math.max(0, i - 20), i + q.length + 25).replace(/\s+/g, ' ')}…» · p. ${d.pages.indexOf(pid) + 1}`;
    }
    return '';
  };
  let list = q ? [...docs, ...days].filter(d => hit(d) && (!F.tag || (d.tags || []).includes(F.tag))) : inDays ? days : docs.filter(d => here(d) && (!F.tag || (d.tags || []).includes(F.tag)));
  if (!inDays || q) list.sort(sorter);
  const dayCard = !cur && !q && days.length ? `<div class="fcard" data-folder="${DAYS}">${icon('calendar')}<div class="ft"><b>Páginas del día</b><span class="sub">${days.length} páginas · la última ${esc(days[0].title)}</span></div></div>` : '';
  if (F.sort !== 'name') subf = [...subf].sort(sorter);
  const where = d => { if (d.kind === 'daily') return 'Páginas del día'; const p = FD.pathOf(d.parent || '', folders); return p.length ? p.map(f => f.title).join(' › ') : 'Raíz'; };

  const tree = (pid, depth) => FD.childrenOf(pid, folders).map(f => {
    const kids = FD.childrenOf(f.id, folders).length, open = F.open.has(f.id);
    return `<div class="trow ${f.id === cur ? 'on' : ''}" style="padding-left:${6 + depth * 16}px">
        <button class="tcaret" data-tog="${f.id}" ${kids ? '' : 'disabled'}>${kids ? icon(open ? 'down' : 'right') : ''}</button>
        <a href="#/papel/${f.id}">${icon(open && kids ? 'folderOpen' : 'folder')}<span>${esc(f.title)}</span></a><span class="tc">${count(f.id) || ''}</span></div>` +
      (open ? tree(f.id, depth + 1) : '');
  }).join('');

  v.innerHTML = `<div class="explorer">
    <aside class="ftree"><div class="trow root ${!cur ? 'on' : ''}"><a href="#/papel">${icon('home')}<span>Raíz</span></a><span class="tc">${count('') || ''}</span></div>
      ${days.length ? `<div class="trow ${inDays ? 'on' : ''}" style="padding-left:22px"><span class="tcaret"></span><a href="#/papel/${DAYS}">${icon('calendar')}<span>Páginas del día</span></a><span class="tc">${days.length}</span></div>` : ''}
      ${tree('', 1)}<button class="btn sm ghost tnew">${icon('folderPlus')} Nueva carpeta</button></aside>
    <section class="fmain">
      <div class="row head"><h1>${inDays ? 'Páginas del día' : cur ? esc(path[path.length - 1].title) : 'Cuadernos'}</h1><div class="grow"></div>
        <label class="search">${icon('search')}<input placeholder="Buscar (también lo escrito)" value="${esc(F.q)}"></label>
        <div class="seg sort"><button data-s="updated">Recientes</button><button data-s="created">Creación</button><button data-s="name">A–Z</button></div></div>
      <div class="row crumbs"><a href="#/papel" class="${!cur ? 'on' : ''}">${icon('home', 'inl')} Raíz</a>${inDays ? `<span>›</span><a href="#/papel/${DAYS}" class="on">Páginas del día</a>` : ''}${path.map(f => `<span>›</span><a href="#/papel/${f.id}" class="${f.id === cur ? 'on' : ''}">${esc(f.title)}</a>`).join('')}
        ${cur && !inDays ? `<button class="ib cmore" title="Opciones de la carpeta">${icon('more')}</button>` : ''}<div class="grow"></div>
        ${inDays ? '' : `<button class="btn ghost nf">${icon('folderPlus')} Nueva carpeta</button>`}<button class="btn pri new">${icon('plus')} ${inDays ? 'Página de hoy' : 'Nuevo cuaderno'}</button></div>
      ${tags.length ? `<div class="row chips">${icon('tag')}<button class="chip ${!F.tag ? 'on' : ''}" data-g="">Todas</button>${tags.map(t => `<button class="chip ${F.tag === t ? 'on' : ''}" data-g="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
      ${q ? `<p class="sub">Resultados para «${esc(F.q)}» en todas las carpetas</p>` : ''}
      ${subf.length || dayCard ? `<div class="fcards">${dayCard}${subf.map(f => `<div class="fcard" data-folder="${f.id}">${icon('folder')}<div class="ft"><b>${esc(f.title)}</b><span class="sub">${q ? esc(where(f)) : count(f.id) + ' elementos'}</span></div><button class="ib" data-fmore="${f.id}" title="Opciones">${icon('more')}</button></div>`).join('')}</div>` : ''}
      ${list.length ? `<div class="covers">${list.map(n => cover(n, q ? (snippet(n) || where(n)) : inDays ? `${n.pages.length} pág. · ${fmtDate(n.updated)}` : `${n.kind === 'paper' ? n.pages.length + ' pág.' : KIND_NAME[n.kind]} · ${fmtDate(n.updated)}`)).join('')}</div>`
        : !subf.length && !dayCard ? empty(q ? 'search' : 'folder', q ? 'Nada coincide' : cur ? 'Carpeta vacía' : 'Aún no tienes cuadernos', q ? 'Prueba con otra palabra.' : 'Crea un cuaderno o una carpeta, o mueve aquí cualquier documento con su menú ⋯ → «Mover a carpeta».') : ''}
    </section></div>`;

  const refresh = () => route();
  v.querySelectorAll('.sort button').forEach(b => b.classList.toggle('on', b.dataset.s === F.sort));
  v.querySelector('.sort').onclick = e => { const b = e.target.closest('[data-s]'); if (b) { F.sort = b.dataset.s; route(); } };
  const inp = v.querySelector('.search input');
  let st; inp.oninput = () => { clearTimeout(st); st = setTimeout(() => { F.q = inp.value; route().then(() => { const i = view.querySelector('.search input'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 350); };
  v.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { F.tag = b.dataset.g; route(); });
  v.querySelectorAll('[data-tog]').forEach(b => b.onclick = () => { const id = b.dataset.tog; F.open.has(id) ? F.open.delete(id) : F.open.add(id); route(); });
  const newF = async () => {
    const r = await prompt('Nueva carpeta', [{ name: 't', label: cur ? `Dentro de «${path[path.length - 1].title}»` : 'En la raíz', value: '' }], 'Crear');
    if (r && r.t.trim()) { await FD.newFolder(r.t.trim(), cur); F.open.add(cur); route(); }
  };
  v.querySelector('.nf')?.addEventListener('click', newF);
  v.querySelector('.tnew').onclick = newF;
  v.querySelector('.new').onclick = async () => inDays ? openNb(await store.dailyNotebook(dkey())) : newNotebookDialog(cur);
  v.querySelector('.cmore')?.addEventListener('click', e => folderMenu(e.currentTarget, path[path.length - 1], refresh));
  const fc = v.querySelector('.fcards');
  if (fc) fc.addEventListener('click', e => {
    const m = e.target.closest('[data-fmore]');
    if (m) { e.stopPropagation(); folderMenu(m, folders.find(f => f.id === m.dataset.fmore), refresh); return; }
    const c = e.target.closest('[data-folder]');
    if (c) { F.q = ''; go('#/papel/' + c.dataset.folder); }
  });
  const grid = v.querySelector('.covers'); if (grid) bindCovers(grid, list, refresh);
};

function folderMenu(anchor, f, refresh) {
  menu(anchor, [
    { icon: 'folderOpen', label: 'Abrir', run: () => go('#/papel/' + f.id) },
    { icon: 'folderPlus', label: 'Nueva subcarpeta', run: async () => {
      const r = await prompt('Nueva subcarpeta', [{ name: 't', label: `Dentro de «${f.title}»`, value: '' }], 'Crear');
      if (r && r.t.trim()) { await FD.newFolder(r.t.trim(), f.id); F.open.add(f.id); refresh(); }
    } },
    { icon: 'pen2', label: 'Renombrar', run: async () => {
      const r = await prompt('Renombrar carpeta', [{ name: 't', label: 'Nombre', value: f.title }]);
      if (r && r.t.trim()) { f.title = r.t.trim(); await db.put('notebooks', f); refresh(); }
    } },
    { icon: 'move', label: 'Mover a otra carpeta', run: async () => {
      const to = await FD.pickFolder(`Mover «${f.title}» a…`, { current: f.parent || '', exclude: f.id });
      if (to !== null && await FD.moveTo(f, to)) { toast('Carpeta movida'); refresh(); }
    } },
    { icon: 'trash', label: 'Eliminar carpeta', danger: true, run: async () => {
      if (!await confirm(`¿Eliminar la carpeta «${f.title}»?`, 'Eliminar', 'No se borra nada de dentro: su contenido pasa a la carpeta superior.')) return;
      const up = f.parent || '';
      await FD.deleteFolder(f);
      location.hash.includes(f.id) ? go(up ? '#/papel/' + up : '#/papel') : refresh();
    } }
  ]);
}

async function newNotebookDialog(parent = '') {
  const folders = await FD.allFolders();
  const p = FD.pathOf(parent, folders);
  const body = h(`<div><label class="field"><span>Nombre</span><input name="t" value="Cuaderno ${fmtDate(Date.now(), { day: 'numeric', month: 'short' })}"></label>
    <p class="sub" style="margin:-4px 0 14px">${icon('folder', 'inl')} Se guardará en: <b>${p.length ? esc(p.map(f => f.title).join(' › ')) : 'Raíz'}</b></p>
    <div class="field"><span>Plantilla</span></div></div>`);
  const tp = tplPicker(settings.defaultTpl);
  body.append(tp);
  body.append(h(`<label class="row sub" style="margin-top:14px;gap:8px"><input type="checkbox" name="inf"> ${icon('inf', 'inl')} Página infinita (se puede escribir hacia cualquier lado)</label>`));
  const r = await modal('Nuevo cuaderno', body, [{ label: 'Cancelar', value: null },
    { label: 'Crear', pri: true, value: mb => ({ t: mb.querySelector('[name=t]').value.trim() || 'Cuaderno', tpl: tp.dataset.sel, inf: mb.querySelector('[name=inf]').checked }) }], { wide: true });
  if (!r) return;
  settings.defaultTpl = r.tpl; saveSettings();
  const nb = await store.newNotebook('paper', r.t, { tpl: r.tpl, extra: { parent }, page: r.inf ? { inf: true } : {} });
  openNb(nb);
}

// ---- Agenda: vistas Día · Semana · Mes (al estilo Google Calendar) ----
const CAL = { view: 'month', sel: null };
const HOUR = 48;
const addD = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return dkey(d); };
const weekStart = k => { const d = fromKey(k); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dkey(d); };
const toMin = t => { const [hh, mm] = String(t || '0:0').split(':').map(Number); return (hh || 0) * 60 + (mm || 0); };
const fromMin = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

async function extAll() {
  return [...(settings.gCalShow && G.granted('calRead') ? await sync.externalEvents() : []), ...await MS.events()];
}

async function agendaData() {
  return {
    events: await db.all('events'),
    todos: await db.all('todos'),
    dailies: (await db.all('notebooks')).filter(n => n.kind === 'daily'),
    ext: await extAll()
  };
}

// Todo lo que hay en un día: eventos, tus otros calendarios, tareas y la página escrita.
function itemsOn(D, k) {
  const out = [];
  for (const e of D.events) if (e.date === k) out.push({ kind: 'ev', title: e.title || (e.img ? 'Evento escrito a mano' : 'Evento'), time: e.time, end: e.time ? fromMin(Math.min(1439, toMin(e.time) + (e.dur || 60))) : '', color: '#141414', ref: e });
  for (const e of sync.extOn(D.ext, k)) out.push({ kind: 'ext', title: e.title, time: e.time, end: e.endTime, color: e.color, ref: e });
  for (const t of D.todos) if (t.date === k) out.push({ kind: 'todo', title: t.text || 'Tarea escrita a mano', done: t.done, color: '#141414', ref: t });
  const p = D.dailies.find(d => d.date === k);
  if (p) out.push({ kind: 'page', title: 'Página del día', color: '#7a7a7a', ref: p });
  const key = i => (i.time ? '1' + i.time : i.kind === 'page' ? '2' : '0');
  return out.sort((a, b) => key(a).localeCompare(key(b)));
}

function blocks(items) {
  const ev = items.filter(i => i.time).map(i => {
    const s = toMin(i.time), e0 = i.end ? toMin(i.end) : s + 60;
    return { ...i, s, e: Math.max(s + 20, e0 <= s ? 1440 : e0) };
  }).sort((a, b) => a.s - b.s || b.e - a.e);
  const out = [];
  let group = [], end = -1;
  const flush = () => {
    const cols = [];
    for (const x of group) { let c = cols.findIndex(ce => ce <= x.s); if (c < 0) { c = cols.length; cols.push(0); } cols[c] = x.e; x.col = c; }
    for (const x of group) x.ncol = cols.length;
    out.push(...group); group = [];
  };
  for (const x of ev) { if (x.s >= end && group.length) flush(); group.push(x); end = Math.max(end, x.e); }
  if (group.length) flush();
  return out;
}

VIEWS.agenda = async (v, a) => {
  const today = dkey();
  if (a) { CAL.sel = a; history.replaceState(null, '', '#/agenda'); }
  CAL.sel = CAL.sel || today;
  const D = await agendaData(), REG = [];
  const reg = it => REG.push(it) - 1;
  const chip = it => `<button class="chipev k-${it.kind} ${it.done ? 'done' : ''}" data-i="${reg(it)}" style="--c:${esc(it.color)}">${it.kind === 'todo' ? (it.done ? '☑ ' : '☐ ') : it.kind === 'page' ? icon('pen', 'inl') + ' ' : it.time ? `<b>${it.time}</b> ` : ''}${esc(it.title)}</button>`;
  const sel = CAL.sel, view = CAL.view;
  let title = '', body = '';
  const dowN = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  if (view === 'month') {
    const [y, m] = sel.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const start = weekStart(dkey(first));
    title = cap(first.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }));
    const weeks = (fromKey(addD(start, 35)).getMonth() === m - 1) ? 6 : 5;
    let cells = '';
    for (let i = 0; i < weeks * 7; i++) {
      const k = addD(start, i), d = fromKey(k), its = itemsOn(D, k);
      cells += `<div class="mcell ${d.getMonth() !== m - 1 ? 'out' : ''} ${k === today ? 'today' : ''} ${k === sel ? 'on' : ''}" data-d="${k}">
        <span class="n">${d.getDate()}</span>${its.slice(0, 3).map(chip).join('')}${its.length > 3 ? `<span class="more" data-day="${k}">+${its.length - 3} más</span>` : ''}</div>`;
    }
    body = `<div class="mgrid">${dowN.map(x => `<div class="dow">${x}</div>`).join('')}${cells}</div>`;
  } else {
    const days = view === 'week' ? Array.from({ length: 7 }, (_, i) => addD(weekStart(sel), i)) : [sel];
    if (view === 'week') {
      const s = fromKey(days[0]), e = fromKey(days[6]);
      title = `${s.getDate()} ${s.getMonth() !== e.getMonth() ? s.toLocaleDateString('es-ES', { month: 'short' }) + ' ' : ''}– ${e.getDate()} ${e.toLocaleDateString('es-ES', { month: 'short', year: 'numeric' })}`;
    } else title = cap(fmtDate(fromKey(sel), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    const all = days.map(k => itemsOn(D, k));
    const n = days.length, nowM = new Date().getHours() * 60 + new Date().getMinutes();
    const grid = `<div class="tg" style="--n:${n}">
      <div class="tg-head"><div></div>${days.map(k => { const d = fromKey(k); return `<div class="${k === today ? 'today' : ''}" data-day="${k}"><span>${d.toLocaleDateString('es-ES', { weekday: 'short' })}</span><span class="dn">${d.getDate()}</span></div>`; }).join('')}</div>
      <div class="tg-all"><div class="gl">Todo el día</div>${all.map(its => `<div>${its.filter(i => !i.time).map(chip).join('')}</div>`).join('')}</div>
      <div class="tg-body"><div class="tg-grid">
        <div class="tg-hours">${Array.from({ length: 23 }, (_, hh) => `<span style="top:${(hh + 1) * HOUR}px">${pad(hh + 1)}:00</span>`).join('')}</div>
        ${days.map((k, di) => `<div class="tg-col" data-col="${k}">${blocks(all[di]).map(b => `<button class="blk k-${b.kind}" data-i="${reg(b)}" style="--c:${esc(b.color)};top:${b.s / 60 * HOUR}px;height:${(b.e - b.s) / 60 * HOUR - 2}px;left:calc(${b.col} * 100% / ${b.ncol});width:calc(100% / ${b.ncol} - 3px)"><b>${esc(b.title)}</b><span>${b.time}${b.end ? '–' + b.end : ''}</span></button>`).join('')}
          ${k === today ? `<div class="nowline" style="top:${nowM / 60 * HOUR}px"></div>` : ''}</div>`).join('')}
      </div></div></div>`;
    if (view === 'day') {
      const its = all[0], tds = its.filter(i => i.kind === 'todo'), daily = D.dailies.find(d => d.date === sel);
      body = `<div class="dayview">${grid}<section class="day">
        <button class="btn pri page">${icon('pen')} ${daily ? 'Abrir página del día' : 'Escribir página del día'}</button>
        ${daily?.cover ? `<img class="dthumb page" src="${daily.cover}" alt="">` : ''}
        <h3 class="row">Tareas<div class="grow"></div><button class="btn sm ghost addtd">${icon('plus')} Tarea</button></h3>
        <div class="list">${tds.map(t => `<div class="li ${t.done ? 'done' : ''}"><button class="chk" data-chk="${reg(t)}">${t.done ? icon('check') : ''}</button><span class="tx edit" data-i="${reg(t)}">${esc(t.title)}</span>${t.ref.img ? `<img src="${t.ref.img}" alt="">` : ''}</div>`).join('') || '<div class="li sub">Sin tareas</div>'}</div>
        <p class="sub">Toca una hora vacía para crear un evento. En los cuadernos, rodea lo escrito con el <b>lazo</b> y pulsa «Evento» o «Tarea» para traerlo aquí con tu letra.</p>
      </section></div>`;
    } else body = grid;
  }

  v.innerHTML = `<div class="agwrap"><div class="row head"><h1>Agenda</h1>
      <div class="seg vsel"><button data-v="day">Día</button><button data-v="week">Semana</button><button data-v="month">Mes</button></div>
      <div class="grow"></div>
      <button class="ib" data-m="-1" title="Anterior">${icon('left')}</button><b class="mon">${esc(title)}</b><button class="ib" data-m="1" title="Siguiente">${icon('right')}</button>
      <button class="btn sm ghost" data-m="0">Hoy</button><button class="btn sm pri addany">${icon('plus')} Nuevo</button></div>
    ${body}
    <p class="sub legend"><i class="e"></i> tus eventos <i class="t"></i> tareas <i class="p"></i> página escrita${D.ext.length ? ' <i class="g"></i> tus calendarios de Google y Office 365' : ''}</p></div>`;

  v.querySelectorAll('.vsel button').forEach(b => { b.classList.toggle('on', b.dataset.v === view); b.onclick = () => { CAL.view = b.dataset.v; route(); }; });
  v.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
    const d = +b.dataset.m;
    if (!d) CAL.sel = today;
    else if (view === 'month') { const t = fromKey(sel); CAL.sel = dkey(new Date(t.getFullYear(), t.getMonth() + d, 1)); }
    else CAL.sel = addD(sel, d * (view === 'week' ? 7 : 1));
    route();
  });
  const openDay = k => { CAL.sel = k; CAL.view = 'day'; route(); };
  v.firstElementChild.addEventListener('click', e => {
    const chk = e.target.closest('[data-chk]');
    if (chk) { TK.setDone(REG[+chk.dataset.chk].ref).then(route); return; }
    const it = e.target.closest('[data-i]');
    if (it) { e.stopPropagation(); agendaItem(REG[+it.dataset.i], it); return; }
    const day = e.target.closest('[data-day]');
    if (day) { openDay(day.dataset.day); return; }
    const cell = e.target.closest('.mcell');
    if (cell) { openDay(cell.dataset.d); return; }
    const col = e.target.closest('.tg-col');
    if (col) {
      const r = col.getBoundingClientRect(), mins = Math.max(0, Math.min(1410, Math.floor((e.clientY - r.top) / HOUR * 2) * 30));
      newEvent(col.dataset.col, fromMin(mins));
    }
  });
  v.querySelector('.addany').onclick = e => menu(e.currentTarget, [
    { icon: 'event', label: 'Evento', run: () => newEvent(CAL.sel, '09:00') },
    { icon: 'task', label: 'Tarea', run: () => newTodo(CAL.sel) },
    { icon: 'pen', label: 'Página del día', run: async () => openNb(await store.dailyNotebook(CAL.sel)) }
  ]);
  v.querySelectorAll('.page').forEach(b => b.onclick = async () => openNb(await store.dailyNotebook(sel)));
  v.querySelector('.addtd')?.addEventListener('click', () => newTodo(sel));
  const tb = v.querySelector('.tg-body');
  if (tb) tb.scrollTop = Math.max(0, ((sel <= today && today <= addD(view === 'week' ? weekStart(sel) : sel, view === 'week' ? 6 : 0)) ? new Date().getHours() - 1 : 7) * HOUR);
};

const DURS = [['15', '15 min'], ['30', '30 min'], ['45', '45 min'], ['60', '1 hora'], ['90', '1 h 30'], ['120', '2 horas'], ['180', '3 horas'], ['240', '4 horas']];
async function newEvent(date, time) {
  const r = await prompt('Nuevo evento', [
    { name: 'title', label: 'Título', value: '' },
    { name: 'date', label: 'Fecha', type: 'date', value: date },
    { name: 'time', label: 'Hora (vacío = todo el día)', type: 'time', value: time },
    { name: 'dur', label: 'Duración', type: 'select', value: '60', options: DURS.map(([value, label]) => ({ value, label })) }], 'Crear');
  if (r && r.date && (r.title.trim() || r.time)) { await db.put('events', { id: uid(), date: r.date, time: r.time, dur: +r.dur, title: r.title.trim() }); CAL.sel = r.date; route(); }
}
async function newTodo(date) {
  const r = await prompt('Nueva tarea', [{ name: 'text', label: 'Tarea', value: '' }, { name: 'date', label: 'Fecha', type: 'date', value: date }], 'Añadir');
  if (r && r.text.trim()) { await db.put('todos', TK.make({ date: r.date || date, text: r.text.trim(), origin: 'Creada en la Agenda' })); route(); }
}

async function openSrc(src) {
  const nb = await db.get('notebooks', src.nb);
  if (!nb) return toast('Ese cuaderno ya no existe');
  const i = nb.pages.indexOf(src.pid);
  openNb(nb, i >= 0 ? i : undefined);
}

function agendaItem(it, anchor) {
  const ref = it.ref;
  if (it.kind === 'page') { openNb(ref); return; }
  if (it.kind === 'ext') {
    modal(it.title, `<div class="list">
      <div class="li"><i class="cdot" style="background:${esc(ref.color)}"></i><span>${esc(ref.calName)}</span></div>
      <div class="li">${icon('clock')}<span>${cap(fmtDate(fromKey(ref.date), { weekday: 'long', day: 'numeric', month: 'long' }))} · ${ref.time ? esc(ref.time) + (ref.endTime ? '–' + esc(ref.endTime) : '') : 'Todo el día'}</span></div>
      ${ref.loc ? `<div class="li">${icon('home')}<span>${esc(ref.loc)}</span></div>` : ''}</div>
      <p class="sub">${ref.src === 'ms' ? 'Evento de tu calendario de Office 365: se cambia desde Outlook.' : 'Evento de tu Google Calendar: se cambia desde Google Calendar.'}</p>`);
    return;
  }
  if (it.kind === 'todo') {
    menu(anchor, [
      { icon: 'check', label: ref.done ? 'Marcar como pendiente' : 'Marcar como hecha', run: async () => { await TK.setDone(ref); route(); } },
      ref.img && { icon: 'image', label: 'Ver lo escrito', run: () => modal(ref.text || 'Tarea', `<img src="${ref.img}" style="max-width:100%;background:#fff;border-radius:8px">`) },
      ref.src && { icon: 'notebook', label: 'Abrir en el cuaderno', run: () => openSrc(ref.src) },
      { icon: 'pen2', label: 'Ficha y seguimiento', run: async () => { if (await TK.editTask(ref, openSrc)) route(); } },
      { icon: 'trash', label: 'Eliminar', danger: true, run: async () => { if (await confirm('¿Eliminar esta tarea?', 'Eliminar')) { await db.del('todos', ref.id); route(); } } }
    ]);
    return;
  }
  menu(anchor, [
    ref.img && { icon: 'image', label: 'Ver lo escrito', run: () => modal(ref.title || 'Evento', `<img src="${ref.img}" style="max-width:100%;background:#fff;border-radius:8px">`) },
    ref.src && { icon: 'notebook', label: 'Abrir en el cuaderno', run: () => openSrc(ref.src) },
    { icon: 'pen2', label: 'Editar', run: async () => {
      const r = await prompt('Editar evento', [
        { name: 'title', label: 'Título', value: ref.title || '' },
        { name: 'date', label: 'Fecha', type: 'date', value: ref.date },
        { name: 'time', label: 'Hora (vacío = todo el día)', type: 'time', value: ref.time },
        { name: 'dur', label: 'Duración', type: 'select', value: String(ref.dur || 60), options: DURS.map(([value, label]) => ({ value, label })) }], 'Guardar');
      if (r && r.date) { Object.assign(ref, { date: r.date, time: r.time, title: r.title.trim(), dur: +r.dur }); await db.put('events', ref); CAL.sel = r.date; route(); }
    } },
    { icon: 'trash', label: 'Eliminar', danger: true, run: async () => { if (await confirm('¿Eliminar este evento?', 'Eliminar')) { await db.del('events', ref.id); route(); } } }
  ]);
}

// ---- Reuniones ----
VIEWS.reuniones = async v => {
  const list = (await db.all('notebooks')).filter(n => n.kind === 'meeting').sort((a, b) => b.created - a.created);
  v.innerHTML = `<div class="row head"><h1>Reuniones</h1><div class="grow"></div><button class="btn pri new">${icon('plus')} Nueva reunión</button></div>
    <p class="sub intro">Toma notas a mano mientras grabas el audio de la reunión. Las grabaciones quedan guardadas junto a la página en la que estabas.</p>
    ${list.length ? `<div class="covers">${list.map(n => cover(n, `${fmtDate(n.created, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${(n.recs || []).length} audio`)).join('')}</div>` : empty('mic', 'Sin reuniones', 'Crea una y pulsa «Grabar» dentro.')}`;
  v.querySelector('.new').onclick = async () => {
    const r = await prompt('Nueva reunión', [{ name: 't', label: 'Tema', value: 'Reunión ' + new Date().toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }], 'Crear');
    if (r) openNb(await store.newNotebook('meeting', r.t.trim() || 'Reunión', { tpl: 'reunion' }));
  };
  const g = v.querySelector('.covers'); if (g) bindCovers(g, list, () => route());
};

// ---- Biblioteca ----
VIEWS.biblioteca = async v => {
  const list = (await db.all('notebooks')).filter(n => n.kind === 'book').sort((a, b) => b.updated - a.updated);
  v.innerHTML = `<div class="row head"><h1>Biblioteca</h1><div class="grow"></div><button class="btn pri imp">${icon('upload')} Importar PDF</button></div>
    <p class="sub intro">Lee y anota tus PDF: escribe encima con el lápiz, subraya, añade páginas de notas entre medias y exporta el PDF con tus anotaciones.</p>
    ${list.length ? `<div class="covers">${list.map(n => cover(n, `Pág. ${(n.last || 0) + 1} de ${n.pages.length} · ${Math.round(((n.last || 0) + 1) / n.pages.length * 100)} %`)).join('')}</div>` : empty('library', 'Biblioteca vacía', 'Importa un PDF desde la tablet o Google Drive.')}`;
  v.querySelector('.imp').onclick = importPdf;
  const g = v.querySelector('.covers'); if (g) bindCovers(g, list, () => route());
};

async function importPdf() {
  const files = await pickFiles('application/pdf,.pdf', true);
  for (const f of files) {
    const t = toast('Importando ' + f.name + '…', 120000);
    try {
      const buf = await f.arrayBuffer();
      const blobId = uid();
      await db.put('blobs', { id: blobId, kind: 'pdf', name: f.name, data: new Blob([buf], { type: 'application/pdf' }) });
      const doc = await getDoc(blobId, buf.slice(0));
      const nbId = uid(), pages = [];
      for (let i = 1; i <= doc.numPages; i++) pages.push(store.newPage(nbId, 'blanco', { pdf: i }));
      await db.putMany('pages', pages);
      const c = document.createElement('canvas'); c.width = 180; c.height = 240;
      const bm = await pdfBitmap(blobId, 1, 0.3), r = fitRect(bm.width, bm.height), x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, 180, 240);
      x.drawImage(bm, r.x * 0.15, r.y * 0.15, r.w * 0.15, r.h * 0.15);
      const nb = { id: nbId, kind: 'book', title: f.name.replace(/\.pdf$/i, ''), folder: '', tags: [], tpl: 'blanco', created: Date.now(), updated: Date.now(), pages: pages.map(p => p.id), cover: c.toDataURL('image/jpeg', 0.8), last: 0, blob: blobId };
      await db.put('notebooks', nb);
      toast(`«${nb.title}» importado (${doc.numPages} páginas)`);
    } catch (e) { console.error(e); toast('No se pudo importar ' + f.name + '. ¿Hay conexión la primera vez?'); }
    finally { t.remove(); }
  }
  route();
}

// ---- Recortes ----
VIEWS.recortes = async v => {
  const list = (await db.all('notebooks')).filter(n => n.kind === 'picking').sort((a, b) => b.created - a.created);
  v.innerHTML = `<div class="row head"><h1>Recortes</h1><div class="grow"></div>
      <button class="btn paste">${icon('paste')} Pegar captura</button><button class="btn pri imp">${icon('image')} Añadir imágenes</button></div>
    <p class="sub intro">Guarda capturas de pantalla, fotos o trozos de tus notas y anótalos. Haz una captura en la tablet y pulsa «Añadir imágenes», o cópiala y pulsa «Pegar captura». Desde cualquier cuaderno: lazo → «Recorte».</p>
    ${list.length ? `<div class="covers">${list.map(n => cover(n)).join('')}</div>` : empty('picking', 'Sin recortes', 'Añade una captura o recorta algo con el lazo.')}`;
  v.querySelector('.imp').onclick = async () => {
    const files = await pickFiles('image/*', true);
    for (const f of files) { try { await store.newPicking(await store.fileToImage(f), f.name.replace(/\.\w+$/, '')); } catch (e) { toast('No se pudo abrir ' + f.name); } }
    route();
  };
  v.querySelector('.paste').onclick = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find(t => t.startsWith('image/'));
        if (type) { await store.newPicking(await store.fileToImage(await it.getType(type))); toast('Captura pegada'); return route(); }
      }
      toast('No hay ninguna imagen copiada');
    } catch (e) { toast('El navegador no permite pegar aquí. Usa «Añadir imágenes».'); }
  };
  const g = v.querySelector('.covers'); if (g) bindCovers(g, list, () => route());
};

// ---- Fotos que llegan con «Compartir» (Google Fotos, galería…) ----
VIEWS.compartir = async v => {
  const c = await caches.open('cuaderno-compartir');
  const files = [];
  for (const k of await c.keys()) files.push(new File([await (await c.match(k)).blob()], 'foto'));
  history.replaceState(null, '', '#/compartir');
  if (!files.length) return go('#/home');
  const clear = async () => { for (const k of await c.keys()) await c.delete(k); };
  let to = null; try { to = JSON.parse(localStorage.getItem('shareTo') || 'null'); localStorage.removeItem('shareTo'); } catch (e) { /* sin almacenamiento */ }
  const put = async (nb, i) => {
    location.hash = `#/ed/${nb.id}/${i}`;
    for (let k = 0; k < 100 && !(editor && editor.nb.id === nb.id && editor.page); k++) await new Promise(r => setTimeout(r, 50));
    if (editor?.page) { await editor.addImages(files); await editor.flushSave(); if (!editor.isLocked()) await clear(); }
  };
  if (to && Date.now() - to.t < 30 * 60000) {
    const nb = await db.get('notebooks', to.nb), i = nb ? nb.pages.indexOf(to.pid) : -1;
    if (i >= 0) { setTimeout(() => put(nb, i)); return; }
  }
  const last = await db.get('notebooks', (await store.getRecent())[0] || '-');
  v.innerHTML = `<h1>${files.length === 1 ? 'Foto recibida' : files.length + ' fotos recibidas'}</h1><p class="sub intro">¿Dónde la quieres poner?</p>
    <div class="row" style="flex-wrap:wrap;gap:10px">${last ? `<button class="btn pri" data-w="last">${icon('notebook')} En «${esc(last.title)}»</button>` : ''}
    <button class="btn" data-w="pick">${icon('pages')} Elegir cuaderno</button><button class="btn" data-w="memo">${icon('memo')} En una nota nueva</button><button class="btn" data-w="rec">${icon('picking')} En Recortes</button><button class="btn ghost" data-w="no">Descartar</button></div>
    <div class="row" style="flex-wrap:wrap;gap:10px;margin-top:20px">${files.map(f => `<img src="${URL.createObjectURL(f)}" alt="" style="max-height:180px;border-radius:10px;border:1px solid var(--line2)">`).join('')}</div>`;
  v.querySelectorAll('[data-w]').forEach(b => b.onclick = async () => {
    const w = b.dataset.w;
    if (w === 'last') put(last, last.last || 0);
    if (w === 'pick') pickNotebook(n => n.pages.length > 1 ? pickPage(n, i => put(n, i), n.last || 0) : put(n, 0));
    if (w === 'memo') put(await store.newNotebook('memo', 'Foto · ' + fmtDate(Date.now()), { tpl: 'blanco' }), 0);
    if (w === 'rec') { for (const f of files) await store.newPicking(await store.fileToImage(f)); await clear(); go('#/recortes'); }
    if (w === 'no') { await clear(); go('#/home'); }
  });
};

// ---- Tareas y Lectura ----
VIEWS.tareas = v => TK.view(v, { route, openSrc, go });
VIEWS.lectura = v => RDG.shelf(v, ctxR);

// ---- Notas rápidas ----
VIEWS.notas = async v => {
  const list = (await db.all('notebooks')).filter(n => n.kind === 'memo').sort((a, b) => b.updated - a.updated);
  v.innerHTML = `<div class="row head"><h1>Notas rápidas</h1><div class="grow"></div><button class="btn pri new">${icon('plus')} Nueva nota</button></div>
    <p class="sub intro">Apuntes rápidos con recordatorio opcional. También puedes crear una nota desde cualquier sitio con el botón ${icon('note', 'inl')} de abajo.</p>
    ${list.length ? `<div class="covers">${list.map(n => cover(n, n.remind ? `${icon('bell', 'inl')} ${fmtDate(n.remind, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : fmtDate(n.updated))).join('')}</div>` : empty('memo', 'Sin notas', 'Pulsa «Nueva nota».')}`;
  v.querySelector('.new').onclick = quickMemo;
  const g = v.querySelector('.covers'); if (g) bindCovers(g, list, () => route());
};

async function setReminder(nb, refresh) {
  const d = nb.remind ? new Date(nb.remind) : new Date(Date.now() + 3600e3);
  const val = `${dkey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const r = await prompt('Recordatorio', [{ name: 'w', label: 'Fecha y hora (vacío = quitar)', type: 'datetime-local', value: val }], 'Guardar');
  if (!r) return;
  nb.remind = r.w ? new Date(r.w).getTime() : null; nb.notified = false;
  await db.put('notebooks', nb);
  if (nb.remind && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
  toast(nb.remind ? 'Recordatorio guardado (avisa con la app abierta)' : 'Recordatorio quitado');
  refresh();
}

setInterval(async () => {
  const now = Date.now();
  for (const nb of (await db.all('notebooks')).filter(n => n.kind === 'memo' && n.remind && !n.notified && n.remind <= now)) {
    nb.notified = true; await db.put('notebooks', nb);
    toast('Recordatorio: ' + nb.title, 6000);
    if ('Notification' in window && Notification.permission === 'granted') {
      try { (await navigator.serviceWorker?.ready)?.showNotification('Recordatorio', { body: nb.title, icon: 'icons/icon-192.png' }); } catch (e) { new Notification('Recordatorio', { body: nb.title }); }
    }
  }
}, 30000);

// ---- Ajustes ----
VIEWS.ajustes = async v => {
  const tog = (k, t, s) => `<div class="set"><div class="tx">${t}<small>${s}</small></div><button class="sw-toggle ${settings[k] ? 'on' : ''}" data-k="${k}" aria-label="${t}"></button></div>`;
  const seg = (k, t, s, opts) => `<div class="set"><div class="tx">${t}<small>${s}</small></div><div class="seg" data-k="${k}">${opts.map(([v, n]) => `<button data-v="${v}" class="${settings[k] === v ? 'on' : ''}">${n}</button>`).join('')}</div></div>`;
  let est = '';
  try { const e = await navigator.storage.estimate(); est = `${(e.usage / 1048576).toFixed(1)} MB usados`; } catch (e) {}
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  v.innerHTML = `<h1>Ajustes</h1>
    <h2>Lápiz y gestos</h2>
    ${tog('penOnly', 'Escribir solo con el S Pen', 'El dedo no pinta: sirve para desplazar, pasar página y hacer gestos. Evita marcas al apoyar la mano.')}
    ${tog('gestures', 'Gestos de deshacer', 'Toque con 2 dedos = deshacer. Toque con 3 dedos = rehacer.')}
    ${tog('swipe', 'Deslizar para pasar página', 'Desliza un dedo a izquierda o derecha.')}
    ${tog('shapes', 'Formas perfectas', 'Al terminar una línea, círculo, triángulo o rectángulo, deja el lápiz quieto un momento y se endereza.')}
    ${seg('penButton', 'Botón del S Pen', 'Qué hace al escribir con el botón lateral pulsado.', [['eraser', 'Borrador'], ['lasso', 'Lazo'], ['hl', 'Fluorescente']])}
    ${tog('leftHanded', 'Modo zurdo', 'Pone la barra de herramientas a la derecha.')}
    <h2>Pantalla</h2>
    ${seg('tone', 'Tono del papel', 'Color del fondo de las páginas.', [['eink', 'Tinta electrónica'], ['white', 'Blanco'], ['cream', 'Crema']])}
    ${tog('dark', 'Modo oscuro', 'Invierte los colores para leer de noche.')}
    ${seg('refresh', 'Efecto de refresco', '«Tinta» simula el parpadeo de una pantalla E Ink al cambiar de página.', [['fast', 'Rápido'], ['best', 'Tinta']])}
    <h2>Sincronización con Google</h2>
    <div class="set"><div class="tx">Estado<small>${settings.gConnected
      ? `Conectado · ${sync.state.status === 'error' ? 'último error: ' + esc(sync.state.msg) : settings.gLast ? 'última sincronización ' + fmtDate(settings.gLast, { day: 'numeric', month: 'short' }) + ' ' + fmtTime(settings.gLast) : 'aún sin sincronizar'}`
      : 'Sin conectar. Conecta la misma cuenta de Google en cada tablet para ver lo mismo en todas.'}</small></div>
      ${settings.gConnected ? `<button class="btn sm pri gsync">${icon('cloud')} Sincronizar ahora</button><button class="btn sm ghost gout">Desconectar</button>` : `<button class="btn sm pri gin">${icon('cloud')} Conectar con Google</button>`}</div>
    ${tog('gDrive', 'Cuadernos entre tablets', 'Guarda cuadernos, notas, PDF y audios en la carpeta «Cuaderno (sincronización)» de tu Google Drive.')}
    ${tog('gCal', 'Agenda ↔ Google Calendar', 'Los eventos van a un calendario propio llamado «Cuaderno», en los dos sentidos.')}
    ${tog('gTasks', 'Tareas ↔ Google Tasks', 'Las tareas van a una lista llamada «Cuaderno», en los dos sentidos.')}
    ${tog('gCalShow', 'Ver mis otros calendarios', 'Muestra en la Agenda e Inicio los eventos de tus demás calendarios de Google (personal, familia…). Solo se ven: no se modifican desde la app.')}
    ${settings.gConnected && !G.granted('calRead') ? `<div class="set"><div class="tx">Permiso para ver tus calendarios<small>Pulsa y acepta el nuevo permiso de Google («Ver tus calendarios»).</small></div><button class="btn sm pri gperm">${icon('calendar')} Dar permiso</button></div>` : ''}
    <details class="set gid"><summary class="tx">ID de cliente de Google<small>${G.clientId() ? 'Configurado: …' + esc(G.clientId().slice(-34)) : 'Falta configurarlo (ver guía de registro).'}</small></summary>
      <div class="row" style="width:100%;margin-top:10px"><input class="gcid" placeholder="xxxxxxxx.apps.googleusercontent.com" value="${esc(settings.gClientId)}" style="flex:1;padding:10px;border:1.5px solid var(--line2);border-radius:10px;background:var(--paper);color:var(--ink)"><button class="btn sm gsave">Guardar</button></div></details>
    <h2>Calendario de Office 365</h2>
    <div class="set"><div class="tx">Estado<small>${settings.msConnected ? (MS.needsLogin() ? 'Hay que volver a conectar.' : 'Conectado' + (settings.msLast ? ' · actualizado ' + fmtDate(settings.msLast, { day: 'numeric', month: 'short' }) + ' ' + fmtTime(settings.msLast) : '')) : 'Sin conectar. Muestra en la Agenda e Inicio los eventos de tu calendario de Outlook / Office 365. Solo se ven: no se modifican.'} Microsoft pide volver a entrar cada 24 horas.</small></div>
      ${settings.msConnected ? `<button class="btn sm pri mssync">${icon('repeat')} Actualizar</button>${MS.needsLogin() ? `<button class="btn sm pri msin">Volver a conectar</button>` : ''}<button class="btn sm ghost msout">Desconectar</button>` : `<button class="btn sm pri msin" ${MS.clientId() ? '' : 'disabled style="opacity:.45"'}>${icon('calendar')} Conectar con Office 365</button>`}</div>
    <details class="set gid"><summary class="tx">ID de aplicación de Microsoft<small>${MS.clientId() ? 'Configurado: …' + esc(MS.clientId().slice(-12)) : 'Falta configurarlo: ver GUIA-OFFICE365. También hay una forma sencilla sin registrar nada (a través de Google Calendar).'}</small></summary>
      <div class="row" style="width:100%;margin-top:10px"><input class="mscid" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value="${esc(settings.msClientId)}" style="flex:1;padding:10px;border:1.5px solid var(--line2);border-radius:10px;background:var(--paper);color:var(--ink)"><button class="btn sm mssave">Guardar</button></div></details>
    <h2>Inteligencia artificial (Gemini)</h2>
    <div class="set"><div class="tx">Clave de Gemini<small>${settings.aiKey ? 'Configurada en esta tablet.' : 'Créala gratis en Google AI Studio con tu cuenta y pégala aquí.'} Se guarda solo en esta tablet. Al usar la IA, la página o el audio se envían a Google; en la modalidad gratuita Google puede usarlos para mejorar sus productos.</small>
      <div class="row" style="margin-top:10px"><input class="aikey" type="password" placeholder="Pega aquí la clave de Gemini" value="${esc(settings.aiKey)}" style="flex:1;min-width:220px;padding:10px;border:1.5px solid var(--line2);border-radius:10px;background:var(--paper);color:var(--ink)">
      <button class="btn sm aisave">Guardar</button><button class="btn sm ghost aitest">Probar</button></div>
      <a class="btn sm ghost" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="margin-top:10px">${icon('spark')} Crear clave en Google AI Studio</a></div></div>
    <div class="set"><div class="tx">Cómo se usa<small>En cualquier cuaderno: botón ${icon('spark', 'inl')} de la barra (pasar a texto, pasar a limpio, resumir, sacar citas y tareas, preguntar, traducir, resumir grabaciones) o rodea algo con el lazo y pulsa «A texto».</small></div></div>
    <h2>Privacidad</h2>
    <div class="set"><div class="tx">Bloqueo con PIN<small>${settings.pin ? 'Activado: se pide al abrir la app y tras 2 minutos sin usarla.' : 'Pide un PIN de 4 a 8 cifras al abrir la app. Protege de miradas, pero no cifra los datos.'}</small></div>
      ${settings.pin ? `<button class="btn sm ghost pinoff">Quitar PIN</button>` : `<button class="btn sm pinon">${icon('lockKey')} Poner PIN</button>`}</div>
    <h2>Datos</h2>
    <div class="set"><div class="tx">Almacenamiento<small>${est || 'Todo se guarda solo en esta tablet, en el navegador.'} ${persisted ? '· protegido contra borrado automático' : ''}</small></div></div>
    ${tog('bkOn', 'Copia de seguridad cada noche', 'Se hace sola a la hora elegida si la app está abierta; si no, en cuanto la abras. Se guardan las 3 últimas en la tablet.')}
    ${tog('bkDrive', 'Guardarla también en Google Drive', 'En la carpeta «Cuaderno (copias de seguridad)», las 14 últimas. Se sube cuando la sesión de Google está activa; si no, al tocar la nube.')}
    <div class="set"><div class="tx">Hora y nombre de esta tablet<small class="bkst">…</small></div><select class="bkh" style="padding:9px;border:1.5px solid var(--line2);border-radius:10px;background:var(--paper);color:var(--ink)">${[0, 1, 2, 3, 4, 5, 6, 21, 22, 23].map(x => `<option value="${x}" ${x === settings.bkHour ? 'selected' : ''}>${pad(x)}:00</option>`).join('')}</select>
      <input class="bkn" placeholder="Nombre (p. ej. tablet-casa)" value="${esc(settings.deviceName)}" style="width:170px;padding:9px;border:1.5px solid var(--line2);border-radius:10px;background:var(--paper);color:var(--ink)"></div>
    <div class="set"><div class="tx">Copias guardadas<small>Para recuperar una copia anterior.</small></div><button class="btn sm pri bknow">${icon('download')} Hacer copia ahora</button><button class="btn sm ghost bklist">Ver copias</button></div>
    <div class="set"><div class="tx">Copia en un archivo<small>Descarga un archivo con todos tus cuadernos, agenda y audios. Guárdalo en Drive de vez en cuando.</small></div><button class="btn sm exp">${icon('download')} Exportar</button><button class="btn sm ghost imp">${icon('upload')} Restaurar</button></div>
    ${installEvt ? `<div class="set"><div class="tx">Instalar la app<small>Añade Cuaderno a la pantalla de inicio de la tablet.</small></div><button class="btn sm pri inst">Instalar</button></div>` : ''}
    <div class="set"><div class="tx">Borrar todo<small>Elimina todos los datos de esta app en esta tablet.</small></div><button class="btn sm danger wipe">${icon('trash')} Borrar</button></div>
    <p class="sub" style="margin-top:24px">Cuaderno · app web que funciona sin conexión. Tus datos se quedan en la tablet (y en tu Drive si sincronizas); la IA solo envía a Google lo que le pidas.</p>`;
  v.querySelectorAll('.sw-toggle').forEach(b => b.onclick = () => { settings[b.dataset.k] = !settings[b.dataset.k]; saveSettings(); b.classList.toggle('on'); });
  v.querySelectorAll('.seg[data-k]').forEach(s => s.onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; settings[s.dataset.k] = b.dataset.v; saveSettings(); s.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); });
  G.prepare().catch(() => {});
  v.querySelector('.msin')?.addEventListener('click', () => MS.signIn().catch(e => toast(e.message, 5000)));
  v.querySelector('.mssync')?.addEventListener('click', async () => { const t = toast('Actualizando…', 60000); try { await MS.refresh(); } catch (e) { toast(e.message, 5000); } finally { t.remove(); route(); } });
  v.querySelector('.msout')?.addEventListener('click', async () => { if (await confirm('¿Desconectar Office 365 en esta tablet?', 'Desconectar')) { await MS.signOut(); route(); } });
  v.querySelector('.mssave').onclick = () => { settings.msClientId = v.querySelector('.mscid').value.trim(); saveSettings(); toast('ID guardado'); route(); };
  BK.getState().then(s => {
    const when = t => t ? fmtDate(t, { day: 'numeric', month: 'short' }) + ' ' + fmtTime(t) : 'todavía no';
    const el = v.querySelector('.bkst'); if (el) el.textContent = `Última copia en la tablet: ${when(s.local)} · en Drive: ${when(s.drive)}${s.error ? ' · Aviso: ' + s.error : ''}`;
  }).catch(() => {});
  v.querySelector('.bkh').onchange = e => { settings.bkHour = +e.target.value; saveSettings(); toast('Hora guardada'); };
  v.querySelector('.bkn').onchange = e => { settings.deviceName = e.target.value.trim().replace(/[^\wáéíóúñ-]+/gi, '-').slice(0, 24); saveSettings(); toast('Nombre guardado'); };
  v.querySelector('.bknow').onclick = async () => {
    const t = toast('Haciendo la copia…', 120000);
    try { const r = await BK.run(true); toast(r === 'drive' ? 'Copia guardada en la tablet y en Drive' : 'Copia guardada en la tablet' + (settings.bkDrive ? ' (Drive: falta conectar con Google)' : ''), 4000); }
    catch (e) { toast(e.message, 6000); } finally { t.remove(); route(); }
  };
  v.querySelector('.bklist').onclick = backupsDialog;
  v.querySelector('.gin')?.addEventListener('click', async () => { await connectGoogle(); route(); });
  v.querySelector('.gperm')?.addEventListener('click', async () => { await connectGoogle(); route(); });
  v.querySelector('.gsync')?.addEventListener('click', async () => { await cloudTap(); route(); });
  v.querySelector('.gout')?.addEventListener('click', async () => {
    if (!await confirm('¿Desconectar de Google en esta tablet?', 'Desconectar', 'Tus datos se quedan en la tablet y en Drive; solo deja de sincronizar.')) return;
    G.signOut(); sync.refreshState(); paintCloud(); route();
  });
  v.querySelector('.pinon')?.addEventListener('click', async () => {
    const r = await prompt('Poner PIN', [{ name: 'a', label: 'PIN (4 a 8 cifras)', type: 'password', value: '' }, { name: 'b', label: 'Repite el PIN', type: 'password', value: '' }], 'Guardar');
    if (!r) return;
    if (!/^\d{4,8}$/.test(r.a)) return toast('El PIN debe tener entre 4 y 8 cifras');
    if (r.a !== r.b) return toast('Los dos PIN no coinciden');
    settings.pin = await sha(r.a); saveSettings(); toast('PIN activado'); route();
  });
  v.querySelector('.pinoff')?.addEventListener('click', async () => {
    const r = await prompt('Quitar PIN', [{ name: 'a', label: 'PIN actual', type: 'password', value: '' }], 'Quitar');
    if (!r) return;
    if (await sha(r.a) !== settings.pin) return toast('PIN incorrecto');
    settings.pin = ''; saveSettings(); toast('PIN quitado'); route();
  });
  v.querySelector('.aisave').onclick = () => { settings.aiKey = v.querySelector('.aikey').value.trim(); saveSettings(); toast(settings.aiKey ? 'Clave de Gemini guardada' : 'Clave quitada'); };
  v.querySelector('.aitest').onclick = async () => {
    settings.aiKey = v.querySelector('.aikey').value.trim(); saveSettings();
    const t = toast('Probando Gemini…', 60000);
    try { const r = await AI.ask([{ text: 'Responde solo con la palabra: Funciona' }]); toast('Gemini responde: ' + r.slice(0, 60), 4000); }
    catch (e) { toast(e.message, 6000); } finally { t.remove(); }
  };
  v.querySelector('.gsave').onclick = () => {
    settings.gClientId = v.querySelector('.gcid').value.trim(); saveSettings();
    G.prepare().catch(() => {}); toast('ID de cliente guardado'); route();
  };
  v.querySelector('.exp').onclick = async () => { const t = toast('Preparando copia…', 60000); try { download(await store.exportAll(), `cuaderno-copia-${dkey()}.json`); } finally { t.remove(); } };
  v.querySelector('.imp').onclick = async () => {
    const [f] = await pickFiles('application/json,.json'); if (!f) return;
    if (!await confirm('¿Restaurar esta copia?', 'Restaurar', 'Se reemplazarán TODOS los datos actuales por los de la copia.')) return;
    try { await restoreFile(f); } catch (e) { toast(e.message || 'Archivo no válido'); }
  };
  v.querySelector('.inst')?.addEventListener('click', async () => { installEvt.prompt(); installEvt = null; route(); });
  v.querySelector('.wipe').onclick = async () => {
    if (!await confirm('¿Borrar TODOS los datos?', 'Borrar todo', 'Cuadernos, agenda, audios y ajustes. No se puede deshacer. Haz antes una copia de seguridad.')) return;
    for (const s of db.STORES) await db.clear(s);
    toast('Datos borrados'); go('#/home');
  };
};

async function restoreFile(f) {
  // Antes de tocar nada se guarda una copia de lo que hay ahora.
  const copy = new Blob([await f.arrayBuffer()], { type: 'application/json' }); // por si la copia elegida es la que se va a renovar
  await BK.safety();
  await store.importAll(copy);
  await loadSettings();
  toast('Copia restaurada'); route();
}

async function backupsDialog() {
  const loc = await BK.list();
  let drv = [], note = '';
  try { drv = await BK.listDrive(); if (!settings.gConnected || !G.hasToken()) note = 'Para ver las de Drive, toca la nube y conecta con Google.'; } catch (e) { note = e.message; }
  const mb = n => (n / 1048576).toFixed(1) + ' MB';
  const el = h(`<div class="bklist"><h3>En esta tablet</h3><div class="list">${loc.map((x, i) => `<div class="li">${icon('download')}<span class="tx">${fmtDate(x.date)} ${fmtTime(x.date)}${x.name.includes('antes') ? ' · antes de restaurar' : ''}</span><div class="grow"></div><span class="sub">${mb(x.size)}</span><button class="btn sm ghost" data-l="${i}" data-a="get">Guardar archivo</button><button class="btn sm" data-l="${i}" data-a="res">Restaurar</button></div>`).join('') || '<div class="li sub">Aún no hay copias</div>'}</div>
    <h3>En Google Drive</h3><div class="list">${drv.map((x, i) => `<div class="li">${icon('cloud')}<span class="tx">${esc(x.name.replace(/\.json$/, ''))}</span><div class="grow"></div><span class="sub">${mb(+x.size || 0)}</span><button class="btn sm" data-d="${i}" data-a="res">Restaurar</button></div>`).join('') || `<div class="li sub">${esc(note || 'Aún no hay copias')}</div>`}</div></div>`);
  let close;
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const L = b.dataset.l !== undefined ? loc[+b.dataset.l] : null;
    if (b.dataset.a === 'get') return download(L.file, L.name);
    close();
    if (!await confirm('¿Restaurar esta copia?', 'Restaurar', 'Se reemplazarán TODOS los datos actuales por los de la copia. Antes se guarda una copia de lo que hay ahora.')) return;
    const t = toast('Restaurando…', 180000);
    try { await restoreFile(L ? L.file : await BK.fetchDrive(drv[+b.dataset.d].id)); } catch (err) { toast(err.message || 'No se pudo restaurar', 6000); } finally { t.remove(); }
  });
  modal('Copias de seguridad', el, [{ label: 'Cerrar', value: null }], { wide: true, mount: c => { close = c; } });
}

// ---------------- bloqueo con PIN ----------------
const sha = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cuaderno:' + t)))].map(b => b.toString(16).padStart(2, '0')).join('');
let hiddenAt = 0;
function lockScreen() {
  if (!settings.pin || document.querySelector('.lock')) return;
  let code = '';
  const el = h(`<div class="lock"><div class="lockbox">${icon('lockKey')}<h2>Cuaderno</h2><p class="sub">Escribe tu PIN</p><div class="dots"></div>
    <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map(k => k === '' ? '<span></span>' : `<button data-k="${k}">${k}</button>`).join('')}</div></div></div>`);
  const dots = el.querySelector('.dots');
  const draw = () => { dots.textContent = '●'.repeat(code.length) || ' '; };
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    code = b.dataset.k === '⌫' ? code.slice(0, -1) : (code + b.dataset.k).slice(0, 8);
    draw();
    if (code.length >= 4 && await sha(code) === settings.pin) el.remove();
    else if (code.length === 8) { code = ''; draw(); toast('PIN incorrecto'); }
  });
  draw();
  document.body.append(el);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hiddenAt = Date.now();
  else if (settings.pin && hiddenAt && Date.now() - hiddenAt > 120000) lockScreen();
});

// ---------------- arranque ----------------
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
(async () => {
  await loadSettings();
  lockScreen();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    // Cuando llega una versión nueva, la app se recarga sola (fuera del editor, para no perder nada).
    const hadCtrl = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadCtrl) return;
      if (!editor) location.reload();
      else addEventListener('hashchange', () => location.reload(), { once: true });
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(e => console.warn(e));
  }
  try { if (await MS.finishSignIn()) toast('Conectado con Office 365'); } catch (e) { toast('Office 365: ' + e.message, 8000); }
  if (!location.hash) history.replaceState(null, '', '#/home');
  route();
  sync.refreshState(); paintCloud();
  if (settings.gConnected) { G.prepare().catch(() => {}); if (G.hasToken()) sync.syncNow(); }
  BK.start();
  const msTick = () => MS.refresh().then(ch => { if (ch && !editor && !document.querySelector('.modal-bg,.pop') && /#\/(home|agenda)/.test(location.hash)) route(); }).catch(e => console.warn('Office 365', e));
  msTick(); setInterval(msTick, 10 * 60000);
})();
