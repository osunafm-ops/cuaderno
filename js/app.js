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

const app = document.getElementById('app');
let editor = null, timer = null, installEvt = null;

const NAV = [
  ['home', 'Inicio', 'home'], ['papel', 'Cuadernos', 'notebook'], ['agenda', 'Agenda', 'calendar'],
  ['reuniones', 'Reuniones', 'mic'], ['biblioteca', 'Biblioteca', 'library'], ['recortes', 'Recortes', 'picking'], ['notas', 'Notas', 'memo']
];
const KIND_ROUTE = { paper: 'papel', meeting: 'reuniones', book: 'biblioteca', picking: 'recortes', memo: 'notas', daily: 'agenda' };
const KIND_NAME = { paper: 'Cuaderno', meeting: 'Reunión', book: 'Libro', picking: 'Recorte', memo: 'Nota', daily: 'Agenda' };

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
bez.addEventListener('pointerdown', e => {
  const b = e.target.closest('[data-b=home]'); if (!b) return;
  lpFired = false;
  lpT = setTimeout(() => { lpFired = true; recentsMenu(b); }, 550);
});
bez.addEventListener('pointerup', () => clearTimeout(lpT));
bez.addEventListener('pointerleave', () => clearTimeout(lpT));
bez.addEventListener('click', async e => {
  const b = e.target.closest('[data-b]'); if (!b) return;
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
const KIND_ICON = { paper: 'notebook', meeting: 'mic', book: 'library', picking: 'picking', memo: 'memo', daily: 'calendar' };

const go = hash => { if (location.hash === hash) route(); else location.hash = hash; };
const openNb = (nb, page) => go(`#/ed/${nb.id}${page !== undefined ? '/' + page : ''}`);

async function quickMemo() {
  const nb = await store.newNotebook('memo', 'Nota · ' + new Date().toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), { tpl: 'rayas_f' });
  openNb(nb);
}

// ---------------- navegación ----------------
async function route() {
  clearInterval(timer); timer = null;
  closePop();
  document.querySelectorAll('.modal-bg').forEach(m => m.remove());
  if (editor) { const e = editor; editor = null; await e.destroy(); }
  const [, r, a, b] = location.hash.split('/');
  if (r === 'ed') {
    const nb = await db.get('notebooks', a);
    if (!nb) return go('#/home');
    main.hidden = true; edroot.hidden = false;
    editor = new Editor(edroot, nb, b !== undefined ? +b : undefined);
    await editor.init();
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
addEventListener('hashchange', route);

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
    nb.kind === 'paper' && { icon: 'folder', label: 'Mover a carpeta', run: async () => {
      const folders = [...new Set((await db.all('notebooks')).map(n => n.folder).filter(Boolean))];
      const r = await prompt('Carpeta', [{ name: 'f', label: 'Nombre de carpeta (vacío = sin carpeta)', value: nb.folder, list: folders }]);
      if (r) { nb.folder = r.f.trim(); await db.put('notebooks', nb); refresh(); }
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
  const count = k => nbs.filter(n => n.kind === k).length;
  const tiles = [
    ['papel', 'notebook', 'Cuadernos', `${count('paper')} cuadernos`],
    ['agenda', 'calendar', 'Agenda', `${evs.length} eventos hoy`],
    ['reuniones', 'mic', 'Reuniones', `${count('meeting')} reuniones`],
    ['biblioteca', 'library', 'Biblioteca', `${count('book')} documentos`],
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
        ${tds.map(t => `<div class="li ${t.done ? 'done' : ''}" data-td="${t.id}"><button class="chk">${t.done ? icon('check') : ''}</button><span class="tx">${esc(t.text || '')}</span>${t.img ? `<img src="${t.img}" alt="">` : ''}${t.date < today ? '<span class="sub">atrasada</span>' : ''}</div>`).join('')}
        ${!evs.length && !tds.length ? '<div class="li sub">Sin eventos ni tareas para hoy.</div>' : ''}
      </div><a class="btn sm ghost" href="#/agenda" style="margin-top:12px">${icon('calendar')} Abrir agenda</a></section>
    </div>`;
  bindCovers(v.querySelector('.rc') || h('<div></div>'), recent, () => route());
  v.querySelectorAll('[data-td] .chk').forEach(b => b.onclick = async () => {
    const t = tds.find(x => x.id === b.closest('[data-td]').dataset.td); t.done = !t.done; await db.put('todos', t); route();
  });
  const clk = v.querySelector('.clock');
  timer = setInterval(() => { clk.textContent = fmtTime(new Date()); }, 15000);
  navigator.getBattery?.().then(b => { const el = v.querySelector('.bat'); if (el) el.textContent = `Batería ${Math.round(b.level * 100)} %${b.charging ? ' · cargando' : ''}`; }).catch(() => {});
};

const F = { folder: '', tag: '', q: '', sort: 'updated' };
VIEWS.papel = async v => {
  const all = (await db.all('notebooks')).filter(n => n.kind === 'paper');
  const folders = [...new Set(all.map(n => n.folder).filter(Boolean))].sort();
  const tags = [...new Set(all.flatMap(n => n.tags || []))].sort();
  let list = all.filter(n => (!F.folder || n.folder === F.folder) && (!F.tag || (n.tags || []).includes(F.tag)) && (!F.q || n.title.toLowerCase().includes(F.q.toLowerCase())));
  list.sort((a, b) => F.sort === 'name' ? a.title.localeCompare(b.title) : F.sort === 'created' ? b.created - a.created : b.updated - a.updated);
  v.innerHTML = `<div class="row head"><h1>Cuadernos</h1><div class="grow"></div>
      <label class="search">${icon('search')}<input placeholder="Buscar por nombre" value="${esc(F.q)}"></label>
      <div class="seg sort"><button data-s="updated">Recientes</button><button data-s="created">Creación</button><button data-s="name">A–Z</button></div>
      <button class="btn pri new">${icon('plus')} Nuevo cuaderno</button></div>
    <div class="row chips">${icon('folder')}<button class="chip ${!F.folder ? 'on' : ''}" data-f="">Todas</button>${folders.map(f => `<button class="chip ${F.folder === f ? 'on' : ''}" data-f="${esc(f)}">${esc(f)}</button>`).join('')}</div>
    ${tags.length ? `<div class="row chips">${icon('tag')}<button class="chip ${!F.tag ? 'on' : ''}" data-g="">Todas</button>${tags.map(t => `<button class="chip ${F.tag === t ? 'on' : ''}" data-g="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
    ${list.length ? `<div class="covers">${list.map(n => cover(n, `${n.pages.length} pág. · ${fmtDate(n.updated)}`)).join('')}</div>` : empty('notebook', all.length ? 'Ningún cuaderno coincide' : 'Aún no tienes cuadernos', 'Pulsa «Nuevo cuaderno» y elige una plantilla.')}`;
  v.querySelectorAll('.sort button').forEach(b => b.classList.toggle('on', b.dataset.s === F.sort));
  v.querySelector('.sort').onclick = e => { const b = e.target.closest('[data-s]'); if (b) { F.sort = b.dataset.s; route(); } };
  const inp = v.querySelector('.search input');
  let st; inp.oninput = () => { clearTimeout(st); st = setTimeout(() => { F.q = inp.value; route().then(() => { const i = view.querySelector('.search input'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 350); };
  v.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { F.folder = b.dataset.f; route(); });
  v.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { F.tag = b.dataset.g; route(); });
  v.querySelector('.new').onclick = () => newNotebookDialog(folders);
  const grid = v.querySelector('.covers'); if (grid) bindCovers(grid, list, () => route());
};

async function newNotebookDialog(folders) {
  const body = h(`<div><label class="field"><span>Nombre</span><input name="t" value="Cuaderno ${fmtDate(Date.now(), { day: 'numeric', month: 'short' })}"></label>
    <label class="field"><span>Carpeta (opcional)</span><input name="f" list="dl-fold" value="${esc(F.folder)}"><datalist id="dl-fold">${folders.map(f => `<option value="${esc(f)}">`).join('')}</datalist></label>
    <div class="field"><span>Plantilla</span></div></div>`);
  const tp = tplPicker(settings.defaultTpl);
  body.append(tp);
  const r = await modal('Nuevo cuaderno', body, [{ label: 'Cancelar', value: null },
    { label: 'Crear', pri: true, value: mb => ({ t: mb.querySelector('[name=t]').value.trim() || 'Cuaderno', f: mb.querySelector('[name=f]').value.trim(), tpl: tp.dataset.sel }) }], { wide: true });
  if (!r) return;
  settings.defaultTpl = r.tpl; saveSettings();
  const nb = await store.newNotebook('paper', r.t, { tpl: r.tpl, folder: r.f });
  openNb(nb);
}

// ---- Agenda ----
let calM = null, calSel = null;
VIEWS.agenda = async (v, a) => {
  if (a) { calSel = a; calM = a.slice(0, 7); }
  const today = dkey();
  calSel = calSel || today; calM = calM || today.slice(0, 7);
  const [y, m] = calM.split('-').map(Number);
  const first = new Date(y, m - 1, 1), start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const events = await db.all('events'), todos = await db.all('todos');
  const dailies = (await db.all('notebooks')).filter(n => n.kind === 'daily');
  const marks = {};
  const mk = (k, t) => (marks[k] = marks[k] || new Set()).add(t);
  events.forEach(e => mk(e.date, 'e')); todos.forEach(t => mk(t.date, 't')); dailies.forEach(d => mk(d.date, 'p'));
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = dkey(d);
    cells.push(`<button class="${d.getMonth() !== m - 1 ? 'out' : ''} ${k === today ? 'today' : ''} ${k === calSel ? 'on' : ''}" data-d="${k}"><span class="n">${d.getDate()}</span><span class="mk">${[...(marks[k] || [])].map(t => `<i class="${t}"></i>`).join('')}</span></button>`);
  }
  const dEv = events.filter(e => e.date === calSel).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const dTd = todos.filter(t => t.date === calSel);
  const daily = dailies.find(d => d.date === calSel);
  v.innerHTML = `<div class="row head"><h1>Agenda</h1><div class="grow"></div>
      <button class="ib" data-m="-1">${icon('left')}</button><b class="mon">${cap(first.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }))}</b><button class="ib" data-m="1">${icon('right')}</button>
      <button class="btn sm ghost" data-m="0">Hoy</button></div>
    <div class="agenda"><div><div class="cal">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => `<div class="dow">${d}</div>`).join('')}${cells.join('')}</div>
      <p class="sub legend"><i class="e"></i> evento <i class="t"></i> tarea <i class="p"></i> página escrita</p></div>
      <section class="day"><h2>${cap(fmtDate(fromKey(calSel), { weekday: 'long', day: 'numeric', month: 'long' }))}</h2>
        <button class="btn pri page">${icon('pen')} ${daily ? 'Abrir página del día' : 'Escribir página del día'}</button>
        ${daily?.cover ? `<img class="dthumb page" src="${daily.cover}" alt="">` : ''}
        <h3 class="row">Eventos<div class="grow"></div><button class="btn sm ghost addev">${icon('plus')} Evento</button></h3>
        <div class="list">${dEv.map(e => `<div class="li" data-ev="${e.id}"><b class="edit">${esc(e.time || 'Todo el día')}</b><span class="tx edit">${esc(e.title || '')}${e.rec ? ' ' + icon('repeat', 'inl') : ''}</span>${e.img ? `<img src="${e.img}" alt="">` : ''}<div class="grow"></div><button class="ib del">${icon('trash')}</button></div>`).join('') || '<div class="li sub">Sin eventos</div>'}</div>
        <h3 class="row">Tareas<div class="grow"></div><button class="btn sm ghost addtd">${icon('plus')} Tarea</button></h3>
        <div class="list">${dTd.map(t => `<div class="li ${t.done ? 'done' : ''}" data-td="${t.id}"><button class="chk">${t.done ? icon('check') : ''}</button><span class="tx">${esc(t.text || '')}</span>${t.img ? `<img src="${t.img}" alt="">` : ''}<div class="grow"></div><button class="ib del">${icon('trash')}</button></div>`).join('') || '<div class="li sub">Sin tareas</div>'}</div>
        <p class="sub">Consejo: en cualquier cuaderno, rodea lo escrito con el <b>lazo</b> y pulsa «Evento» o «Tarea» para traerlo aquí con tu letra.</p>
      </section></div>`;
  v.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
    const d = +b.dataset.m;
    if (!d) { calSel = today; calM = today.slice(0, 7); }
    else { const n = new Date(y, m - 1 + d, 1); calM = `${n.getFullYear()}-${pad(n.getMonth() + 1)}`; }
    route();
  });
  v.querySelector('.cal').onclick = e => { const b = e.target.closest('[data-d]'); if (b) { calSel = b.dataset.d; calM = calSel.slice(0, 7); route(); } };
  v.querySelectorAll('.page').forEach(b => b.onclick = async () => openNb(await store.dailyNotebook(calSel)));
  v.querySelector('.addev').onclick = async () => {
    const r = await prompt('Nuevo evento', [{ name: 'time', label: 'Hora', type: 'time', value: '09:00' }, { name: 'title', label: 'Título', value: '' }], 'Añadir');
    if (r && (r.title || r.time)) { await db.put('events', { id: uid(), date: calSel, time: r.time, title: r.title }); route(); }
  };
  v.querySelector('.addtd').onclick = async () => {
    const r = await prompt('Nueva tarea', [{ name: 'text', label: 'Tarea', value: '' }], 'Añadir');
    if (r && r.text.trim()) { await db.put('todos', { id: uid(), date: calSel, text: r.text.trim(), done: false }); route(); }
  };
  v.querySelectorAll('[data-ev] .edit').forEach(b => b.onclick = async () => {
    const e = dEv.find(x => x.id === b.closest('[data-ev]').dataset.ev);
    const r = await prompt('Editar evento', [
      { name: 'date', label: 'Fecha', type: 'date', value: e.date },
      { name: 'time', label: 'Hora (vacío = todo el día)', type: 'time', value: e.time },
      { name: 'title', label: 'Título', value: e.title || '' }], 'Guardar');
    if (r && r.date) { Object.assign(e, { date: r.date, time: r.time, title: r.title }); await db.put('events', e); calSel = r.date; calM = r.date.slice(0, 7); route(); }
  });
  v.querySelectorAll('[data-td] .tx').forEach(b => b.onclick = async () => {
    const t = dTd.find(x => x.id === b.closest('[data-td]').dataset.td);
    const r = await prompt('Editar tarea', [{ name: 'date', label: 'Fecha', type: 'date', value: t.date }, { name: 'text', label: 'Tarea', value: t.text || '' }], 'Guardar');
    if (r && r.date) { Object.assign(t, { date: r.date, text: r.text.trim() }); await db.put('todos', t); route(); }
  });
  v.querySelectorAll('[data-ev] .del').forEach(b => b.onclick = async () => { if (await confirm('¿Eliminar este evento?', 'Eliminar')) { await db.del('events', b.closest('[data-ev]').dataset.ev); route(); } });
  v.querySelectorAll('[data-td] .del').forEach(b => b.onclick = async () => { if (await confirm('¿Eliminar esta tarea?', 'Eliminar')) { await db.del('todos', b.closest('[data-td]').dataset.td); route(); } });
  v.querySelectorAll('[data-td] .chk').forEach(b => b.onclick = async () => { const t = dTd.find(x => x.id === b.closest('[data-td]').dataset.td); t.done = !t.done; await db.put('todos', t); route(); });
};

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
    ${tog('color', 'Tinta en color', 'Añade colores a los lápices (la tableta original solo tiene grises).')}
    ${seg('refresh', 'Efecto de refresco', '«Tinta» simula el parpadeo de una pantalla E Ink al cambiar de página.', [['fast', 'Rápido'], ['best', 'Tinta']])}
    <h2>Sincronización con Google</h2>
    <div class="set"><div class="tx">Estado<small>${settings.gConnected
      ? `Conectado · ${sync.state.status === 'error' ? 'último error: ' + esc(sync.state.msg) : settings.gLast ? 'última sincronización ' + fmtDate(settings.gLast, { day: 'numeric', month: 'short' }) + ' ' + fmtTime(settings.gLast) : 'aún sin sincronizar'}`
      : 'Sin conectar. Conecta la misma cuenta de Google en cada tablet para ver lo mismo en todas.'}</small></div>
      ${settings.gConnected ? `<button class="btn sm pri gsync">${icon('cloud')} Sincronizar ahora</button><button class="btn sm ghost gout">Desconectar</button>` : `<button class="btn sm pri gin">${icon('cloud')} Conectar con Google</button>`}</div>
    ${tog('gDrive', 'Cuadernos entre tablets', 'Guarda cuadernos, notas, PDF y audios en la carpeta «Cuaderno (sincronización)» de tu Google Drive.')}
    ${tog('gCal', 'Agenda ↔ Google Calendar', 'Los eventos van a un calendario propio llamado «Cuaderno», en los dos sentidos.')}
    ${tog('gTasks', 'Tareas ↔ Google Tasks', 'Las tareas van a una lista llamada «Cuaderno», en los dos sentidos.')}
    <details class="set gid"><summary class="tx">ID de cliente de Google<small>${G.clientId() ? 'Configurado: …' + esc(G.clientId().slice(-34)) : 'Falta configurarlo (ver guía de registro).'}</small></summary>
      <div class="row" style="width:100%;margin-top:10px"><input class="gcid" placeholder="xxxxxxxx.apps.googleusercontent.com" value="${esc(settings.gClientId)}" style="flex:1;padding:10px;border:1.5px solid var(--line2);border-radius:10px;background:var(--paper);color:var(--ink)"><button class="btn sm gsave">Guardar</button></div></details>
    <h2>Inteligencia artificial (Gemini)</h2>
    <div class="set"><div class="tx">Clave de Gemini<small>${settings.aiKey ? 'Configurada en esta tablet.' : 'Créala gratis en Google AI Studio con tu cuenta y pégala aquí.'} Se guarda solo en esta tablet. Al usar la IA, la página o el audio se envían a Google; en la modalidad gratuita Google puede usarlos para mejorar sus productos.</small>
      <div class="row" style="margin-top:10px"><input class="aikey" type="password" placeholder="Pega aquí la clave (AIza…)" value="${esc(settings.aiKey)}" style="flex:1;min-width:220px;padding:10px;border:1.5px solid var(--line2);border-radius:10px;background:var(--paper);color:var(--ink)">
      <button class="btn sm aisave">Guardar</button><button class="btn sm ghost aitest">Probar</button></div>
      <a class="btn sm ghost" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="margin-top:10px">${icon('spark')} Crear clave en Google AI Studio</a></div></div>
    <div class="set"><div class="tx">Cómo se usa<small>En cualquier cuaderno: botón ${icon('spark', 'inl')} de la barra (pasar a texto, pasar a limpio, resumir, sacar citas y tareas, preguntar, traducir, resumir grabaciones) o rodea algo con el lazo y pulsa «A texto».</small></div></div>
    <h2>Datos</h2>
    <div class="set"><div class="tx">Almacenamiento<small>${est || 'Todo se guarda solo en esta tablet, en el navegador.'} ${persisted ? '· protegido contra borrado automático' : ''}</small></div></div>
    <div class="set"><div class="tx">Copia de seguridad<small>Descarga un archivo con todos tus cuadernos, agenda y audios. Guárdalo en Drive de vez en cuando.</small></div><button class="btn sm exp">${icon('download')} Exportar</button><button class="btn sm ghost imp">${icon('upload')} Restaurar</button></div>
    ${installEvt ? `<div class="set"><div class="tx">Instalar la app<small>Añade Cuaderno a la pantalla de inicio de la tablet.</small></div><button class="btn sm pri inst">Instalar</button></div>` : ''}
    <div class="set"><div class="tx">Borrar todo<small>Elimina todos los datos de esta app en esta tablet.</small></div><button class="btn sm danger wipe">${icon('trash')} Borrar</button></div>
    <p class="sub" style="margin-top:24px">Cuaderno · app web que funciona sin conexión. Tus datos se quedan en la tablet (y en tu Drive si sincronizas); la IA solo envía a Google lo que le pidas.</p>`;
  v.querySelectorAll('.sw-toggle').forEach(b => b.onclick = () => { settings[b.dataset.k] = !settings[b.dataset.k]; saveSettings(); b.classList.toggle('on'); });
  v.querySelectorAll('.seg[data-k]').forEach(s => s.onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; settings[s.dataset.k] = b.dataset.v; saveSettings(); s.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); });
  G.prepare().catch(() => {});
  v.querySelector('.gin')?.addEventListener('click', async () => { await connectGoogle(); route(); });
  v.querySelector('.gsync')?.addEventListener('click', async () => { await cloudTap(); route(); });
  v.querySelector('.gout')?.addEventListener('click', async () => {
    if (!await confirm('¿Desconectar de Google en esta tablet?', 'Desconectar', 'Tus datos se quedan en la tablet y en Drive; solo deja de sincronizar.')) return;
    G.signOut(); sync.refreshState(); paintCloud(); route();
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
    try { await store.importAll(f); toast('Copia restaurada'); await loadSettings(); route(); } catch (e) { toast(e.message || 'Archivo no válido'); }
  };
  v.querySelector('.inst')?.addEventListener('click', async () => { installEvt.prompt(); installEvt = null; route(); });
  v.querySelector('.wipe').onclick = async () => {
    if (!await confirm('¿Borrar TODOS los datos?', 'Borrar todo', 'Cuadernos, agenda, audios y ajustes. No se puede deshacer. Haz antes una copia de seguridad.')) return;
    for (const s of db.STORES) await db.clear(s);
    toast('Datos borrados'); go('#/home');
  };
};

// ---------------- arranque ----------------
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
(async () => {
  await loadSettings();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(e => console.warn(e));
  if (!location.hash) history.replaceState(null, '', '#/home');
  route();
  sync.refreshState(); paintCloud();
  if (settings.gConnected) { G.prepare().catch(() => {}); if (G.hasToken()) sync.syncNow(); }
})();
