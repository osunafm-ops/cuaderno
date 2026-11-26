// Lectura: estantería de libros (EPUB, PDF o en papel) y lector de EPUB con lo típico de una app de lectura.
import { db, uid } from './db.js';
import { settings, saveSettings } from './settings.js';
import { h, icon, esc, modal, prompt, confirm, toast, menu, pop, closePop, pickFiles, loadScript, dkey, fmtDate, fmtDur, cap, flash } from './ui.js';
import * as store from './store.js';

const JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
const EPUBJS = 'https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js';
export const STATUS = [['leyendo', 'Leyendo'], ['pendiente', 'Quiero leer'], ['leido', 'Leído'], ['dejado', 'Abandonado']];
const stName = s => (STATUS.find(x => x[0] === s) || STATUS[1])[1];
const THEMES = { papel: ['#f4f3ee', '#141414'], blanco: ['#ffffff', '#141414'], sepia: ['#f3e7cf', '#3b2f20'], noche: ['#141414', '#dcdad4'] };
const FONTS = { libro: ['Libro', 'Literata, Georgia, serif'], moderna: ['Moderna', 'Inter, system-ui, sans-serif'], original: ['Original', ''] };
const RD = () => (settings.rd = { size: 110, font: 'libro', lh: 1.55, margin: 36, theme: 'papel', flow: 'paginated', goal: 12, ...(settings.rd || {}) });

const blobToDataURL = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
async function shrinkCover(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const im = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = url; });
    const s = Math.min(1, 360 / im.naturalHeight), c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } catch (e) { return null; } finally { URL.revokeObjectURL(url); }
}

export const progress = async b => {
  if (b.fmt === 'pdf') { const n = await db.get('notebooks', b.book); return n ? ((n.last || 0) + 1) / n.pages.length : 0; }
  if (b.fmt === 'papel') return b.total ? Math.min(1, (b.cur || 0) / b.total) : 0;
  return b.pct || 0;
};
const secsOn = (b, k) => (b.log || {})[k] || 0;

async function newBook(o) {
  const now = Date.now();
  const b = { id: uid(), kind: 'reading', title: o.title || 'Libro', author: o.author || '', folder: '', tags: [], tpl: 'blanco', pages: [], last: 0, created: now, updated: now, cover: o.cover || null, status: o.status || 'pendiente', fmt: o.fmt || 'papel', total: o.total || 0, cur: 0, pct: 0, quotes: [], bms: [], log: {}, ...o };
  await db.put('notebooks', b);
  return b;
}

// ---------------- estantería ----------------
const V = { f: 'leyendo' };

export async function shelf(v, ctx) {
  const all = (await db.all('notebooks')).filter(n => n.kind === 'reading');
  const year = String(new Date().getFullYear()), today = dkey();
  const doneYear = all.filter(b => b.status === 'leido' && b.finished && String(new Date(b.finished).getFullYear()) === year).length;
  const week = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - i); return dkey(d); });
  const minsWeek = Math.round(all.reduce((s, b) => s + week.reduce((x, k) => x + secsOn(b, k), 0), 0) / 60);
  const minsToday = Math.round(all.reduce((s, b) => s + secsOn(b, today), 0) / 60);
  const goal = RD().goal;
  const list = all.filter(b => V.f === 'todos' || (b.status || 'pendiente') === V.f).sort((a, b) => (b.opened || b.updated) - (a.opened || a.updated));
  const pcts = await Promise.all(list.map(progress));
  v.innerHTML = `<div class="row head"><h1>Lectura</h1><div class="grow"></div><button class="btn pri add">${icon('plus')} Añadir libro</button></div>
    <div class="rstats"><div><b>${minsToday} min</b><span>leídos hoy</span></div><div><b>${minsWeek} min</b><span>esta semana</span></div>
      <div class="goal" title="Toca para cambiar la meta"><b>${doneYear} / ${goal}</b><span>libros en ${year}</span><i style="--p:${Math.min(100, Math.round(doneYear / goal * 100))}%"></i></div>
      <div><b>${all.filter(b => b.status === 'leyendo').length}</b><span>leyendo ahora</span></div></div>
    <div class="seg flt">${[...STATUS, ['todos', 'Todos']].map(([k, n]) => `<button data-f="${k}" class="${V.f === k ? 'on' : ''}">${n} <span class="sub">${k === 'todos' ? all.length : all.filter(b => (b.status || 'pendiente') === k).length}</span></button>`).join('')}</div>
    ${list.length ? `<div class="covers shelf">${list.map((b, i) => `<div class="cover book" data-b="${b.id}"><div class="pg" style="${b.cover ? `background-image:url(${b.cover})` : ''}">${b.cover ? '' : `<span class="ph bt">${esc(b.title)}</span>`}
        <button class="dots" data-m="${b.id}" title="Opciones">${icon('more')}</button><span class="fmt">${b.fmt === 'epub' ? 'EPUB' : b.fmt === 'pdf' ? 'PDF' : 'Papel'}</span></div>
        <div class="t">${esc(b.title)}</div><div class="m">${esc(b.author || '')}</div>
        <div class="bar"><i style="width:${Math.round(pcts[i] * 100)}%"></i></div><div class="m">${Math.round(pcts[i] * 100)} %${b.rating ? ' · ' + '★'.repeat(b.rating) : ''}</div></div>`).join('')}</div>`
      : `<div class="empty">${icon('library')}<b>${V.f === 'leyendo' ? 'No estás leyendo nada' : 'Nada en esta estantería'}</b><span>Pulsa «Añadir libro»: un EPUB, un PDF o un libro en papel para seguir por dónde vas.</span></div>`}`;
  v.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { V.f = b.dataset.f; ctx.route(); });
  v.querySelector('.goal').onclick = async () => {
    const r = await prompt('Meta de lectura', [{ name: 'g', label: `Libros que quieres leer en ${year}`, type: 'number', value: goal }], 'Guardar');
    if (r && +r.g > 0) { RD().goal = Math.round(+r.g); saveSettings(); ctx.route(); }
  };
  v.querySelector('.add').onclick = e => addMenu(e.currentTarget, ctx);
  v.querySelector('.shelf')?.addEventListener('click', e => {
    const m = e.target.closest('[data-m]'), b = list.find(x => x.id === (m || e.target.closest('[data-b]'))?.dataset[m ? 'm' : 'b']);
    if (!b) return;
    if (m) { e.stopPropagation(); bookMenu(m, b, ctx); } else open(b, ctx);
  });
}

export function open(b, ctx) {
  if (b.fmt === 'epub') return ctx.go('#/lectura/' + b.id);
  if (b.fmt === 'pdf') return db.get('notebooks', b.book).then(n => n ? (touch(b), ctx.go(`#/ed/${n.id}/${n.last || 0}`)) : toast('Ese PDF ya no está en la Biblioteca'));
  return details(b, ctx);
}
async function touch(b) { b.opened = Date.now(); if (b.status === 'pendiente') { b.status = 'leyendo'; b.started = b.started || Date.now(); } await db.put('notebooks', b); store.touchRecent(b.id); }

function bookMenu(anchor, b, ctx) {
  menu(anchor, [
    { icon: 'library', label: b.fmt === 'papel' ? 'Ficha y progreso' : 'Abrir', run: () => open(b, ctx) },
    b.fmt !== 'papel' && { icon: 'memo', label: 'Ficha, notas y citas', run: () => details(b, ctx) },
    ...STATUS.filter(([k]) => k !== b.status).map(([k, n]) => ({ icon: 'check', label: 'Pasar a «' + n + '»', run: async () => { setStatus(b, k); await db.put('notebooks', b); ctx.route(); } })),
    { icon: 'trash', label: 'Quitar de Lectura', danger: true, run: async () => {
      if (!await confirm(`¿Quitar «${b.title}»?`, 'Quitar', b.fmt === 'pdf' ? 'El PDF se queda en la Biblioteca.' : 'Se borran el libro, sus notas y citas.')) return;
      if (b.blob) await db.del('blobs', b.blob);
      await db.del('notebooks', b.id); await db.del('kv', 'locs-' + b.id); ctx.route();
    } }
  ]);
}

function setStatus(b, s) {
  b.status = s;
  if (s === 'leyendo') b.started = b.started || Date.now();
  if (s === 'leido') { b.finished = Date.now(); if (b.fmt === 'papel' && b.total) b.cur = b.total; }
}

function addMenu(anchor, ctx) {
  menu(anchor, [
    { icon: 'library', label: 'Libro electrónico (EPUB)', run: () => addEpub(ctx) },
    { icon: 'download', label: 'PDF', run: () => addPdf(ctx) },
    { icon: 'search', label: 'Libro en papel (buscar título)', run: () => addPaper(ctx) },
    { icon: 'notebook', label: 'Un PDF que ya está en la Biblioteca', run: () => fromLibrary(ctx) }
  ]);
}

async function epubLib() { await loadScript(JSZIP); await loadScript(EPUBJS); return window.ePub; }

async function addEpub(ctx) {
  const files = await pickFiles('application/epub+zip,.epub', true);
  for (const f of files) {
    const t = toast('Importando ' + f.name + '…', 120000);
    try {
      const buf = await f.arrayBuffer(), ePub = await epubLib(), bk = ePub(buf.slice(0));
      const md = await bk.loaded.metadata;
      let cover = null;
      try { const u = await bk.coverUrl(); if (u) cover = await shrinkCover(await (await fetch(u)).blob()); } catch (e) { /* sin portada */ }
      bk.destroy();
      const blob = uid();
      await db.put('blobs', { id: blob, kind: 'epub', name: f.name, data: new Blob([buf], { type: 'application/epub+zip' }) });
      await newBook({ title: md.title || f.name.replace(/\.epub$/i, ''), author: md.creator || '', fmt: 'epub', blob, cover, status: 'leyendo', started: Date.now() });
      toast(`«${md.title || f.name}» añadido`);
    } catch (e) { console.error(e); toast('No se pudo abrir ' + f.name + '. ¿Es un EPUB sin protección? (La primera vez hace falta conexión.)', 6000); }
    finally { t.remove(); }
  }
  V.f = 'leyendo'; ctx.route();
}

async function addPdf(ctx) {
  const before = new Set((await db.all('notebooks')).filter(n => n.kind === 'book').map(n => n.id));
  await ctx.importPdf(true);
  for (const n of (await db.all('notebooks')).filter(n => n.kind === 'book' && !before.has(n.id)))
    await newBook({ title: n.title, fmt: 'pdf', book: n.id, cover: n.cover, status: 'leyendo', started: Date.now() });
  V.f = 'leyendo'; ctx.route();
}

async function fromLibrary(ctx) {
  const used = new Set((await db.all('notebooks')).filter(n => n.kind === 'reading').map(n => n.book));
  const pdfs = (await db.all('notebooks')).filter(n => n.kind === 'book' && !used.has(n.id));
  if (!pdfs.length) return toast('No hay PDF nuevos en la Biblioteca');
  menu(document.querySelector('.add'), pdfs.map(n => ({ icon: 'library', label: n.title, run: async () => { await newBook({ title: n.title, fmt: 'pdf', book: n.id, cover: n.cover, status: 'leyendo', started: Date.now() }); V.f = 'leyendo'; ctx.route(); } })));
}

// Buscar en Open Library (título, autor, páginas y portada).
async function search(q) {
  const r = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=12&fields=title,author_name,cover_i,number_of_pages_median,first_publish_year`);
  if (!r.ok) throw new Error('El buscador de libros no responde');
  return (await r.json()).docs || [];
}
async function coverFrom(id) {
  try { const r = await fetch(`https://covers.openlibrary.org/b/id/${id}-M.jpg`); return r.ok ? await shrinkCover(await r.blob()) : null; } catch (e) { return null; }
}

async function lookup(q0) {
  const el = h(`<div><label class="search" style="margin-bottom:12px">${icon('search')}<input placeholder="Título o autor" value="${esc(q0 || '')}"></label><div class="list res"><div class="li sub">Escribe y pulsa Enter. Si no aparece, pulsa «Sin buscar».</div></div></div>`);
  const inp = el.querySelector('input'), res = el.querySelector('.res');
  let docs = [], close;
  const run = async () => {
    if (!inp.value.trim()) return;
    res.innerHTML = '<div class="li sub">Buscando…</div>';
    try { docs = await search(inp.value.trim()); } catch (e) { res.innerHTML = `<div class="li sub">${esc(e.message)}</div>`; return; }
    res.innerHTML = docs.map((d, i) => `<button class="li" data-i="${i}" style="width:100%;text-align:left">${d.cover_i ? `<img src="https://covers.openlibrary.org/b/id/${d.cover_i}-S.jpg" alt="" style="height:56px">` : icon('library')}<span class="tx"><b>${esc(d.title)}</b><br><span class="sub">${esc((d.author_name || []).join(', '))}${d.first_publish_year ? ' · ' + d.first_publish_year : ''}${d.number_of_pages_median ? ' · ' + d.number_of_pages_median + ' pág.' : ''}</span></span></button>`).join('') || '<div class="li sub">Nada encontrado</div>';
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); run(); } });
  let pick = null;
  res.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) { pick = docs[+b.dataset.i]; close(); } });
  const r = await modal('Buscar libro', el, [{ label: 'Cancelar', value: null }, { label: 'Sin buscar', value: 'manual' }, { label: 'Buscar', pri: true, value: () => { run(); return undefined; } }], { wide: true, mount: c => { close = c; } });
  if (pick) {
    const t = toast('Trayendo la portada…', 20000);
    try { return { title: pick.title, author: (pick.author_name || [])[0] || '', total: pick.number_of_pages_median || 0, cover: pick.cover_i ? await coverFrom(pick.cover_i) : null }; } finally { t.remove(); }
  }
  return r === 'manual' ? { title: inp.value.trim() } : null;
}

async function addPaper(ctx) {
  const r = await lookup('');
  if (!r) return;
  const b = await newBook({ ...r, fmt: 'papel', status: 'leyendo', started: Date.now() });
  V.f = 'leyendo';
  await details(b, ctx);
}

// ---------------- ficha del libro ----------------
export async function details(b, ctx) {
  const pct = await progress(b), year = k => fmtDate(k, { day: 'numeric', month: 'short', year: 'numeric' });
  const total = Object.values(b.log || {}).reduce((a, x) => a + x, 0);
  const el = h(`<div class="bkd"><div class="row" style="gap:16px;align-items:flex-start">
      <div class="bcov" style="${b.cover ? `background-image:url(${b.cover})` : ''}">${b.cover ? '' : esc(b.title)}</div>
      <div style="flex:1;min-width:0">
        <label class="field"><span>Título</span><input name="title" value="${esc(b.title)}"></label>
        <label class="field"><span>Autor</span><input name="author" value="${esc(b.author || '')}"></label>
        <div class="row" style="gap:12px;flex-wrap:wrap">
          <label class="field"><span>Estado</span><select name="status">${STATUS.map(([k, n]) => `<option value="${k}" ${b.status === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          ${b.fmt === 'papel' ? `<label class="field"><span>Voy por la página</span><input type="number" name="cur" value="${b.cur || 0}" min="0" style="width:110px"></label><label class="field"><span>Páginas</span><input type="number" name="total" value="${b.total || ''}" min="0" style="width:100px"></label>` : ''}
        </div>
        <div class="stars">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-s="${n}" class="${(b.rating || 0) >= n ? 'on' : ''}">★</button>`).join('')}</div>
      </div></div>
    <div class="bar big"><i style="width:${Math.round(pct * 100)}%"></i></div>
    <p class="sub">${Math.round(pct * 100)} % · ${total ? 'tiempo leyendo: ' + fmtDur(total * 1000) : 'aún sin tiempo registrado'}${b.started ? ' · empezado el ' + year(b.started) : ''}${b.finished ? ' · terminado el ' + year(b.finished) : ''}</p>
    <div class="row" style="gap:8px;flex-wrap:wrap">${b.fmt === 'papel' ? `<button type="button" class="btn sm" data-k="ses">${icon('clock')} Apuntar lectura de hoy</button>` : ''}<button type="button" class="btn sm ghost" data-k="find">${icon('search')} Buscar datos y portada</button><button type="button" class="btn sm ghost" data-k="cov">${icon('camera')} Portada con foto</button></div>
    <label class="field" style="margin-top:14px"><span>Mis notas / reseña</span><textarea name="notes" rows="4">${esc(b.notes || '')}</textarea></label>
    <div class="field"><span>Citas y subrayados (${(b.quotes || []).length})</span></div>
    <div class="list quotes">${(b.quotes || []).slice().reverse().map(q => `<div class="li"><i class="qdot" style="background:${esc(q.color || '#ffd400')}"></i><span class="tx">«${esc(q.text)}»${q.note ? `<br><span class="sub">${esc(q.note)}</span>` : ''}</span></div>`).join('') || '<div class="li sub">' + (b.fmt === 'epub' ? 'Selecciona texto en el libro para subrayar.' : 'Añade citas con el botón de abajo.') + '</div>'}</div>
    <button type="button" class="btn sm ghost" data-k="q" style="margin-top:8px">${icon('plus')} Añadir cita</button></div>`);
  const ch = {};
  el.querySelector('.stars').onclick = e => { const s = e.target.closest('[data-s]'); if (!s) return; ch.rating = +s.dataset.s === b.rating ? 0 : +s.dataset.s; el.querySelectorAll('.stars button').forEach(x => x.classList.toggle('on', +x.dataset.s <= ch.rating)); };
  el.addEventListener('click', async e => {
    const k = e.target.closest('[data-k]')?.dataset.k; if (!k) return;
    if (k === 'find') { const r = await lookup(b.title); if (r) { Object.assign(ch, r.cover ? r : { ...r, cover: undefined }); if (r.title) el.querySelector('[name=title]').value = r.title; if (r.author) el.querySelector('[name=author]').value = r.author; if (r.total && el.querySelector('[name=total]')) el.querySelector('[name=total]').value = r.total; if (r.cover) el.querySelector('.bcov').style.backgroundImage = `url(${r.cover})`; } }
    if (k === 'cov') { const [f] = await pickFiles('image/*'); if (f) { ch.cover = await shrinkCover(f); el.querySelector('.bcov').style.backgroundImage = `url(${ch.cover})`; el.querySelector('.bcov').textContent = ''; } }
    if (k === 'q') { const r = await prompt('Nueva cita', [{ name: 't', label: 'Texto', type: 'textarea', value: '' }, { name: 'p', label: 'Página (opcional)', value: '' }], 'Añadir'); if (r && r.t.trim()) { (b.quotes = b.quotes || []).push({ id: uid(), text: r.t.trim(), note: r.p ? 'p. ' + r.p : '', at: Date.now(), color: '#ffd400' }); await db.put('notebooks', b); toast('Cita guardada'); } }
    if (k === 'ses') {
      const r = await prompt('Lectura de hoy', [{ name: 'p', label: 'Página a la que has llegado', type: 'number', value: b.cur || 0 }, { name: 'm', label: 'Minutos leídos (aprox.)', type: 'number', value: 20 }], 'Apuntar');
      if (r) { b.cur = Math.max(0, +r.p || 0); el.querySelector('[name=cur]').value = b.cur; b.log = b.log || {}; b.log[dkey()] = (b.log[dkey()] || 0) + Math.max(0, +r.m || 0) * 60; if (b.status !== 'leido') b.status = 'leyendo'; await db.put('notebooks', b); toast('Apuntado'); }
    }
  });
  const btns = [{ label: 'Cerrar', value: null }];
  if (b.fmt !== 'papel') btns.push({ label: 'Abrir libro', value: 'open' });
  btns.push({ label: 'Guardar', pri: true, value: mb => ({ title: mb.querySelector('[name=title]').value.trim(), author: mb.querySelector('[name=author]').value.trim(), status: mb.querySelector('[name=status]').value, notes: mb.querySelector('[name=notes]').value, cur: mb.querySelector('[name=cur]') ? +mb.querySelector('[name=cur]').value : undefined, total: mb.querySelector('[name=total]') ? +mb.querySelector('[name=total]').value : undefined }) });
  const r = await modal(b.title, el, btns, { wide: true });
  if (r === 'open') return open(b, ctx);
  if (!r) { ctx.route(); return; }
  if (r.status !== b.status) setStatus(b, r.status);
  Object.assign(b, { title: r.title || b.title, author: r.author, notes: r.notes }, ch.rating !== undefined ? { rating: ch.rating } : {}, ch.cover ? { cover: ch.cover } : {});
  if (r.cur !== undefined) { b.cur = r.cur; b.total = r.total || ch.total || b.total; }
  if (b.fmt === 'papel' && b.total && b.cur >= b.total && b.status !== 'leido') { setStatus(b, 'leido'); toast('¡Libro terminado!'); }
  await db.put('notebooks', b);
  ctx.route();
}

// ---------------- lector de EPUB ----------------
export async function reader(root, b, ctx) {
  const R = RD();
  root.innerHTML = '';
  const el = h(`<div class="rdr theme-${R.theme}">
    <header class="rtop"><button class="ib" data-a="back" title="Volver">${icon('back')}</button><div class="rtt"><b>${esc(b.title)}</b><span class="sub chap"></span></div><div class="grow"></div>
      <button class="ib" data-a="toc" title="Índice">${icon('listN')}</button><button class="ib" data-a="find" title="Buscar en el libro">${icon('search')}</button>
      <button class="ib" data-a="notes" title="Marcadores, subrayados y notas">${icon('memo')}</button><button class="ib" data-a="mark" title="Marcar esta página">${icon('bookmark')}</button>
      <button class="ib aa" data-a="aa" title="Letra y tema">Aa</button><button class="ib" data-a="full" title="Pantalla completa">${icon('full')}</button></header>
    <div class="rview"><div class="rbook"></div><div class="rload sub">Abriendo el libro…</div></div>
    <footer class="rbot"><input type="range" class="rng" min="0" max="1000" value="0"><span class="sub pos"></span></footer></div>`);
  root.append(el);
  const q = s => el.querySelector(s), view = q('.rbook');
  const rec = await db.get('blobs', b.blob);
  if (!rec) { q('.rload').textContent = 'No se encuentra el archivo del libro en esta tablet. Si lo añadiste en otra, sincroniza primero.'; return { destroy() {} }; }
  let ePub;
  try { ePub = await epubLib(); } catch (e) { q('.rload').textContent = 'Hace falta conexión la primera vez para abrir libros EPUB.'; return { destroy() {} }; }
  const bk = ePub(await rec.data.arrayBuffer());
  let rend = null, cur = null, bars = true, dead = false, lastAct = Date.now(), saveT = 0;
  touch(b);
  if (b.status !== 'leido') b.status = 'leyendo';

  const apply = () => {
    const [bg, fg] = THEMES[R.theme] || THEMES.papel;
    el.className = 'rdr theme-' + R.theme;
    view.style.padding = `0 ${R.margin}px`;
    if (!rend) return;
    rend.themes.override('color', fg); rend.themes.override('background', bg);
    rend.themes.override('line-height', String(R.lh));
    if (FONTS[R.font][1]) rend.themes.override('font-family', FONTS[R.font][1]); else rend.themes.override('font-family', 'inherit');
    rend.themes.fontSize(R.size + '%');
  };
  const make = async () => {
    const at = cur?.start?.cfi || b.cfi;
    rend?.destroy();
    view.innerHTML = '';
    rend = bk.renderTo(view, { width: '100%', height: '100%', flow: R.flow, spread: 'auto', allowScriptedContent: false });
    rend.themes.default({ 'p, li': { 'text-align': 'justify', hyphens: 'auto' }, '::selection': { background: 'rgba(255,212,0,.5)' } });
    apply();
    rend.hooks.content.register(contents => {
      const d = contents.document;
      d.addEventListener('click', ev => { if (ev.target.closest('a')) return; tap(ev.clientX - (contents.window.scrollX || 0), ev); }, true);
      let sx = 0, sy = 0;
      d.addEventListener('touchstart', ev => { sx = ev.touches[0].clientX; sy = ev.touches[0].clientY; }, { passive: true });
      d.addEventListener('touchend', ev => { const dx = ev.changedTouches[0].clientX - sx, dy = ev.changedTouches[0].clientY - sy; if (R.flow === 'paginated' && Math.abs(dx) > 60 && Math.abs(dy) < 70) { dx < 0 ? next() : prev(); } }, { passive: true });
      d.addEventListener('keydown', key);
    });
    rend.on('relocated', loc => { cur = loc; lastAct = Date.now(); place(); clearTimeout(saveT); saveT = setTimeout(savePos, 900); });
    rend.on('selected', (cfi, contents) => selBar(cfi, contents));
    await rend.display(at || undefined);
    for (const x of b.quotes || []) if (x.cfi) mark(x);
    q('.rload').hidden = true;
  };
  const mark = x => { try { rend.annotations.highlight(x.cfi, { id: x.id }, () => quoteMenu(x), 'rhl', { fill: x.color || '#ffd400', 'fill-opacity': '0.4', 'mix-blend-mode': 'multiply' }); } catch (e) { /* cita de otra edición */ } };

  const tap = (x, ev) => {
    const w = view.clientWidth;
    const sel = ev.view.getSelection?.(); if (sel && !sel.isCollapsed) return;
    if (R.flow === 'paginated' && x < w * 0.28) prev();
    else if (R.flow === 'paginated' && x > w * 0.72) next();
    else { bars = !bars; el.classList.toggle('nobars', !bars); }
  };
  const next = () => { rend?.next(); if (settings.refresh === 'best') flash(); };
  const prev = () => { rend?.prev(); if (settings.refresh === 'best') flash(); };
  const key = e => { if (e.target.closest?.('input,textarea')) return; if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); next(); } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); } };
  addEventListener('keydown', key);

  const chapterOf = href => {
    let best = null;
    const walk = items => { for (const it of items || []) { if (href && it.href && href.split('#')[0].endsWith(it.href.split('#')[0])) best = it; walk(it.subitems); } };
    walk(bk.navigation?.toc); return best?.label?.trim() || '';
  };
  const pctOf = cfi => { try { return bk.locations.length() ? bk.locations.percentageFromCfi(cfi) : null; } catch (e) { return null; } };
  const place = () => {
    if (!cur) return;
    const p = pctOf(cur.start.cfi);
    q('.chap').textContent = chapterOf(cur.start.href);
    if (p !== null) { b.pct = p; q('.rng').value = Math.round(p * 1000); }
    const loc = cur.start.location, tot = bk.locations.length();
    q('.pos').textContent = p === null ? 'Calculando posición…' : `${Math.round(p * 100)} %${tot ? ` · posición ${loc + 1} de ${tot}` : ''}`;
    q('[data-a=mark]').classList.toggle('on', (b.bms || []).some(m => m.cfi === cur.start.cfi));
  };
  const savePos = async () => {
    if (!cur) return;
    b.cfi = cur.start.cfi; b.opened = Date.now();
    if (b.pct >= 0.995 && b.status !== 'leido') { setStatus(b, 'leido'); toast('¡Libro terminado! Lo tienes en «Leído».', 4000); }
    await db.put('notebooks', b);
  };
  // Tiempo de lectura: cuenta mientras la pantalla está a la vista y se ha pasado página hace menos de 5 minutos.
  const timer = setInterval(() => {
    if (document.visibilityState !== 'visible' || Date.now() - lastAct > 300000) return;
    const k = dkey(); b.log = b.log || {}; b.log[k] = (b.log[k] || 0) + 30;
  }, 30000);

  const selBar = (cfi, contents) => {
    const range = rend.getRange(cfi), text = String(range || '').trim();
    if (!text) return;
    const COLS = ['#ffd400', '#7fd3ff', '#9be59b', '#ffa0c8'];
    const bar = h(`<div class="menu rsel"><div class="row" style="gap:6px;padding:6px">${COLS.map(c => `<button class="sw" data-c="${c}" style="background:${c}" title="Subrayar"></button>`).join('')}</div>
      <button data-k="note">${icon('memo')}<span>Subrayar con nota</span></button><button data-k="copy">${icon('copy')}<span>Copiar</span></button><button data-k="web">${icon('search')}<span>Buscar en internet</span></button></div>`);
    const r = range.getBoundingClientRect(), fr = view.querySelector('iframe')?.getBoundingClientRect() || { left: 0, top: 0 };
    const anchor = { getBoundingClientRect: () => ({ left: fr.left + r.left, right: fr.left + r.right, top: fr.top + r.top, bottom: fr.top + r.bottom }) };
    bar.addEventListener('click', async e => {
      const x = e.target.closest('[data-c],[data-k]'); if (!x) return;
      closePop();
      const add = async (color, note) => { const qq = { id: uid(), cfi, text: text.slice(0, 2000), color, note: note || '', at: Date.now(), chap: chapterOf(cur?.start?.href) }; (b.quotes = b.quotes || []).push(qq); mark(qq); await db.put('notebooks', b); toast('Subrayado guardado'); };
      if (x.dataset.c) await add(x.dataset.c);
      else if (x.dataset.k === 'note') { const n = await prompt('Nota', [{ name: 'n', label: '«' + text.slice(0, 80) + (text.length > 80 ? '…' : '') + '»', type: 'textarea', value: '' }], 'Guardar'); if (n) await add('#ffd400', n.n.trim()); }
      else if (x.dataset.k === 'copy') navigator.clipboard?.writeText(text).then(() => toast('Copiado'), () => toast('No se pudo copiar'));
      else if (x.dataset.k === 'web') window.open('https://www.google.com/search?q=' + encodeURIComponent(text.slice(0, 200)), '_blank', 'noopener');
      contents.window.getSelection()?.removeAllRanges();
    });
    pop(anchor, bar, { side: 'below' });
  };
  const quoteMenu = x => menu(q('[data-a=notes]'), [
    { icon: 'memo', label: x.note ? 'Cambiar la nota' : 'Añadir nota', run: async () => { const n = await prompt('Nota', [{ name: 'n', label: '«' + x.text.slice(0, 80) + '»', type: 'textarea', value: x.note || '' }], 'Guardar'); if (n) { x.note = n.n.trim(); await db.put('notebooks', b); } } },
    { icon: 'trash', label: 'Quitar subrayado', danger: true, run: async () => { rend.annotations.remove(x.cfi, 'highlight'); b.quotes = b.quotes.filter(y => y.id !== x.id); await db.put('notebooks', b); } }
  ]);

  const panel = (title, html, onPick) => {
    const box = h(`<div class="rpanel">${html}</div>`);
    let close;
    box.addEventListener('click', e => { const it = e.target.closest('[data-go]'); if (it) { close(); onPick(it.dataset.go, it); } });
    modal(title, box, [{ label: 'Cerrar', value: null }], { wide: true, mount: c => { close = c; } });
    return box;
  };
  const actions = {
    back: () => history.length > 1 ? history.back() : ctx.go('#/lectura'),
    full: () => ctx.toggleFull(),
    toc: () => {
      const walk = (items, d = 0) => (items || []).map(it => `<button class="li" data-go="${esc(it.href)}" style="width:100%;text-align:left;padding-left:${8 + d * 18}px"><span class="tx">${esc(it.label.trim())}</span></button>` + walk(it.subitems, d + 1)).join('');
      panel('Índice', `<div class="list">${walk(bk.navigation?.toc) || '<div class="li sub">Este libro no trae índice.</div>'}</div>`, href => rend.display(href));
    },
    mark: async () => {
      if (!cur) return;
      const c = cur.start.cfi, i = (b.bms || []).findIndex(m => m.cfi === c);
      if (i >= 0) b.bms.splice(i, 1);
      else (b.bms = b.bms || []).push({ cfi: c, at: Date.now(), label: chapterOf(cur.start.href), pct: b.pct || 0 });
      await db.put('notebooks', b); place(); toast(i >= 0 ? 'Marcador quitado' : 'Página marcada');
    },
    notes: () => {
      const bm = (b.bms || []).slice().sort((x, y) => (x.pct || 0) - (y.pct || 0)), qs = (b.quotes || []).slice();
      panel('Marcadores y subrayados', `<h3>${icon('bookmark', 'inl')} Marcadores</h3><div class="list">${bm.map(m => `<button class="li" data-go="${esc(m.cfi)}" style="width:100%;text-align:left"><b>${Math.round((m.pct || 0) * 100)} %</b><span class="tx">${esc(m.label || '')}</span><span class="sub">${fmtDate(m.at)}</span></button>`).join('') || '<div class="li sub">Pulsa el marcador de arriba para guardar la página.</div>'}</div>
        <h3>${icon('hl', 'inl')} Subrayados y notas</h3><div class="list">${qs.map(x => `<button class="li" data-go="${esc(x.cfi || '')}" style="width:100%;text-align:left"><i class="qdot" style="background:${esc(x.color || '#ffd400')}"></i><span class="tx">«${esc(x.text.slice(0, 220))}»${x.note ? `<br><span class="sub">${esc(x.note)}</span>` : ''}</span></button>`).join('') || '<div class="li sub">Selecciona texto en el libro para subrayarlo.</div>'}</div>`,
      cfi => cfi && rend.display(cfi));
    },
    find: async () => {
      const r = await prompt('Buscar en el libro', [{ name: 'q', label: 'Palabra o frase', value: '' }], 'Buscar');
      if (!r || r.q.trim().length < 2) return;
      const t = toast('Buscando…', 60000), out = [];
      try {
        for (const it of bk.spine.spineItems) {
          await it.load(bk.load.bind(bk));
          for (const m of it.find(r.q.trim())) { out.push(m); if (out.length >= 200) break; }
          it.unload();
          if (out.length >= 200) break;
        }
      } finally { t.remove(); }
      panel(`«${r.q.trim()}» · ${out.length}${out.length >= 200 ? '+' : ''} resultados`, `<div class="list">${out.map(m => `<button class="li" data-go="${esc(m.cfi)}" style="width:100%;text-align:left"><span class="tx">${esc(m.excerpt)}</span></button>`).join('') || '<div class="li sub">No aparece en el libro.</div>'}</div>`, cfi => rend.display(cfi));
    },
    aa: btn => {
      const box = h('<div class="penpop rset"></div>');
      const draw = () => {
        box.innerHTML = `<div class="pop-t">Lectura</div>
          <div class="lbl">Tamaño de letra · ${R.size} %</div><div class="row"><button class="btn sm" data-s="-10">A−</button><button class="btn sm" data-s="10">A+</button></div>
          <div class="lbl">Letra</div><div class="row">${Object.entries(FONTS).map(([k, [n]]) => `<button class="chip ${R.font === k ? 'on' : ''}" data-f="${k}">${n}</button>`).join('')}</div>
          <div class="lbl">Interlineado</div><div class="row">${[1.3, 1.55, 1.8, 2.1].map(v => `<button class="chip ${R.lh === v ? 'on' : ''}" data-l="${v}">${v}</button>`).join('')}</div>
          <div class="lbl">Márgenes</div><div class="row">${[[12, 'Estrechos'], [36, 'Normales'], [80, 'Anchos']].map(([v, n]) => `<button class="chip ${R.margin === v ? 'on' : ''}" data-m="${v}">${n}</button>`).join('')}</div>
          <div class="lbl">Fondo</div><div class="row">${Object.keys(THEMES).map(k => `<button class="chip ${R.theme === k ? 'on' : ''}" data-t="${k}">${cap(k)}</button>`).join('')}</div>
          <div class="lbl">Pasar página</div><div class="row"><button class="chip ${R.flow === 'paginated' ? 'on' : ''}" data-w="paginated">Por páginas</button><button class="chip ${R.flow !== 'paginated' ? 'on' : ''}" data-w="scrolled-doc">Desplazando</button></div>`;
      };
      box.addEventListener('click', async e => {
        const x = e.target.closest('button'); if (!x) return;
        const d = x.dataset;
        if (d.s) R.size = Math.max(70, Math.min(220, R.size + +d.s));
        if (d.f) R.font = d.f; if (d.l) R.lh = +d.l; if (d.m) R.margin = +d.m; if (d.t) R.theme = d.t;
        saveSettings(); draw();
        if (d.w && d.w !== R.flow) { R.flow = d.w; await make(); } else { apply(); if (d.m) rend?.resize(); }
      });
      draw();
      pop(btn, box, { side: 'below' });
    }
  };
  q('.rtop').addEventListener('click', e => { const x = e.target.closest('[data-a]'); if (x) actions[x.dataset.a](x); });
  q('.rng').addEventListener('change', e => { if (bk.locations.length()) rend.display(bk.locations.cfiFromPercentage(+e.target.value / 1000)); });
  const ro = new ResizeObserver(() => rend?.resize());

  try {
    await bk.ready;
    apply();
    await make();
    ro.observe(view);
    // Posiciones del libro (para el %): se calculan una vez y se guardan en la tablet.
    const saved = await db.get('kv', 'locs-' + b.id);
    if (saved?.v) bk.locations.load(saved.v);
    else { await bk.locations.generate(1200); if (!dead) await db.put('kv', { id: 'locs-' + b.id, v: bk.locations.save() }); }
    place();
  } catch (e) { console.error(e); q('.rload').hidden = false; q('.rload').textContent = 'No se pudo abrir este libro (' + (e.message || e) + ').'; }

  return {
    async destroy() {
      dead = true; clearInterval(timer); clearTimeout(saveT); removeEventListener('keydown', key); ro.disconnect(); closePop();
      await savePos().catch(() => {});
      try { rend?.destroy(); bk.destroy(); } catch (e) { /* ya cerrado */ }
    }
  };
}
