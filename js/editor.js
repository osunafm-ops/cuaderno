// Editor de páginas: escritura con S Pen, borrador, lazo, texto, imágenes, capas, plantillas y páginas.
import { db, uid } from './db.js';
import * as ink from './ink.js';
import { W, H, BRUSHES, WIDTHS } from './ink.js';
import { TEMPLATES, drawTemplate } from './templates.js';
import { settings, saveSettings } from './settings.js';
import { h, icon, esc, pop, menu, modal, prompt, confirm, toast, flash, pickFiles, download, shareOrDownload, dkey, fmtDate, fmtDur, closePop } from './ui.js';
import * as store from './store.js';
import { drawBackground, pagePNG, notebookPDF, pageCanvas, safeName } from './render.js';
import { hooks as syncHooks, onSync } from './sync.js';
import * as AI from './ai.js';
import * as RT from './richtext.js';
import * as FD from './folders.js';

let CLIP = null;
// Reduce una imagen (dataURL) para guardarla como miniatura.
async function shrink(src, max = 520) {
  const im = await ink.loadImage(src);
  if (!im) return src;
  const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
} // portapapeles compartido entre cuadernos
const GRAYS = ['#141414', '#4a4a4a', '#7a7a7a', '#a8a8a8', '#ffffff'];
const COLORS = ['#c62828', '#1565c0', '#2e7d32', '#ef6c00', '#6a1b9a'];
const HL_GRAYS = ['#9a9a9a', '#c4c4c4'];
const HL_COLORS = ['#ffd400', '#7fd3ff', '#9be59b', '#ffa0c8'];

export class Editor {
  constructor(root, nb, idx) {
    this.root = root; this.nb = nb;
    this.idx = Math.max(0, Math.min(idx ?? nb.last ?? 0, nb.pages.length - 1));
    this.tool = 'pen0'; this.undo = []; this.redo = [];
    this.touches = new Map(); this.g = null; this.act = null; this.sel = null;
    this.z = 0; this.zMul = 1; this.raf = 0; this.rafInk = 0;
  }

  // ---------------- montaje ----------------
  async init() {
    this.root.innerHTML = '';
    this.el = h(`<div class="ed ${settings.leftHanded ? 'lh' : ''}">
      <aside class="tb">
        <button data-a="exit" title="Salir">${icon('back')}</button><hr>
        <button data-t="pen0" title="Lápiz 1 (pulsa otra vez para ajustar)">${icon('pen')}<span class="dot"></span></button>
        <button data-t="pen1" title="Lápiz 2 (pulsa otra vez para ajustar)">${icon('pen2')}<span class="dot"></span></button>
        <button data-t="hl" title="Fluorescente">${icon('hl')}</button>
        <button data-t="eraser" title="Borrador">${icon('eraser')}</button>
        <button data-t="lasso" title="Lazo">${icon('lasso')}</button>
        <button data-t="text" title="Texto">${icon('text')}</button>
        <button data-a="image" title="Insertar imagen">${icon('image')}</button>
        <button data-a="ai" title="Gemini (IA)">${icon('spark')}</button><hr>
        <button data-a="undo" title="Deshacer">${icon('undo')}</button>
        <button data-a="redo" title="Rehacer">${icon('redo')}</button><hr>
        <button data-a="layers" title="Capas">${icon('layers')}</button>
        <button data-a="tpl" title="Plantilla">${icon('template')}</button>
        <button data-a="pages" title="Páginas">${icon('pages')}</button>
        <button data-a="more" title="Más opciones">${icon('more')}</button>
      </aside>
      <section class="ed-main">
        <header class="ed-top">
          <div class="ttl"></div><span class="badges"></span><div class="extra row"></div><div class="grow"></div>
          <button class="ib paste" data-a="paste" title="Pegar" hidden>${icon('paste')}</button>
          <button class="ib" data-a="zout" title="Alejar">${icon('zout')}</button>
          <button class="zv" data-a="zfit" title="Ajustar página">100%</button>
          <button class="ib" data-a="zin" title="Acercar">${icon('zin')}</button>
          <span class="vsep"></span>
          <button class="ib" data-a="prev" title="Página anterior">${icon('left')}</button>
          <button class="pgl" data-a="goto" title="Ir a página"></button>
          <button class="ib" data-a="next" title="Página siguiente">${icon('right')}</button>
          <button class="ib" data-a="addpage" title="Nueva página">${icon('plus')}</button>
        </header>
        <div class="scroller"><div class="sheet"><canvas class="c-bg"></canvas><canvas class="c-ink"></canvas><canvas class="c-live"></canvas><div class="ovl"></div></div></div>
      </section></div>`);
    this.root.append(this.el);
    const q = s => this.el.querySelector(s);
    this.q = q;
    this.sc = q('.scroller'); this.sheet = q('.sheet'); this.ovl = q('.ovl');
    this.cBg = q('.c-bg'); this.cInk = q('.c-ink'); this.cLive = q('.c-live');
    this.xBg = this.cBg.getContext('2d'); this.xInk = this.cInk.getContext('2d'); this.xLive = this.cLive.getContext('2d');

    q('.tb').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.t) this.pickTool(b.dataset.t, b); else this.action(b.dataset.a, b);
    });
    q('.ed-top').addEventListener('click', e => {
      const b = e.target.closest('button[data-a]'); if (b) this.action(b.dataset.a, b);
    });
    const L = this.cLive;
    L.addEventListener('pointerdown', e => this.down(e));
    L.addEventListener('pointermove', e => this.move(e));
    L.addEventListener('pointerup', e => this.up(e));
    L.addEventListener('pointercancel', e => this.up(e, true));
    L.addEventListener('contextmenu', e => e.preventDefault());
    this.sc.addEventListener('wheel', e => {
      if (e.ctrlKey) { e.preventDefault(); this.setZoom(this.zMul * (e.deltaY < 0 ? 1.1 : 0.9)); }
    }, { passive: false });
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(this.sc);
    this.onKey = e => this.key(e);
    addEventListener('keydown', this.onKey);
    this.setupExtra();
    syncHooks.before = () => this.flushSave();
    // Cuando terminan de cargar las letras (negrita, cursiva, «a mano»…), redibujar los textos.
    this.onFonts = () => this.reqInk();
    document.fonts?.addEventListener('loadingdone', this.onFonts);
    for (const f of ['400 20px Caveat', '700 20px Literata', 'italic 400 20px Literata', '700 20px Inter']) document.fonts?.load(f).catch(() => {});
    this.offSync = onSync((s, ch) => this.remoteChanged(ch));
    await this.loadPage(this.idx, false);
    this.updTools();
    store.touchRecent(this.nb.id);
  }

  // Cambios que llegan de otra tablet o de Google mientras el cuaderno está abierto.
  async remoteChanged(ch) {
    if (!ch || !ch.size || !this.el.isConnected) return;
    if (ch.has('notebooks/' + this.nb.id)) {
      const fresh = await db.get('notebooks', this.nb.id);
      if (!fresh) { toast('Este cuaderno se eliminó en otra tablet'); location.hash = '#/home'; return; }
      const curId = this.nb.pages[this.idx];
      this.nb = fresh;
      const i = fresh.pages.indexOf(curId);
      if (i < 0) { await this.loadPage(Math.min(this.idx, fresh.pages.length - 1), false); return; }
      this.idx = i;
      this.updTop();
    }
    if (this.page && ch.has('pages/' + this.page.id) && !this.saveT && !this.act && !this.editingText) {
      const p = await db.get('pages', this.page.id);
      if (p) { this.page = p; this.undo = []; this.redo = []; this.sel = null; await this.renderBg(); this.renderInk(); this.drawSel(); this.updTop(); }
    }
  }

  async destroy() {
    this.offSync?.();
    document.fonts?.removeEventListener('loadingdone', this.onFonts);
    if (syncHooks.before) syncHooks.before = null;
    this.ro?.disconnect();
    removeEventListener('keydown', this.onKey);
    if (this.editingText) this.editingText();
    if (this.mr) this.mr.stop();
    clearInterval(this.recT);
    closePop();
    await this.flushSave();
  }

  // ---------------- páginas ----------------
  async loadPage(i, fx = true) {
    await this.flushSave();
    if (this.editingText) this.editingText();
    this.idx = i;
    let p = await db.get('pages', this.nb.pages[i]);
    if (!p) { p = store.newPage(this.nb.id, this.nb.tpl); this.nb.pages[i] = p.id; await db.put('pages', p); }
    this.page = p;
    this.undo = []; this.redo = []; this.sel = null; this.act = null;
    if (this.nb.last !== i) { this.nb.last = i; db.put('notebooks', this.nb); }
    if (!this.z) this.fit(); else { this.renderBg(); this.renderInk(); this.drawSel(); }
    this.updTop();
    this.sc.scrollTop = 0;
    if (fx) flash();
  }

  async go(d) {
    const n = this.idx + d;
    if (n < 0) return toast('Es la primera página');
    if (n >= this.nb.pages.length) return toast('Última página · pulsa + para añadir otra');
    await this.loadPage(n);
  }

  async addPage(at = this.idx + 1, tpl) {
    await this.flushSave();
    const t = tpl || (this.nb.kind === 'book' ? 'blanco' : this.page.tpl);
    const p = store.newPage(this.nb.id, t);
    await db.put('pages', p);
    this.nb.pages.splice(at, 0, p.id);
    await db.put('notebooks', this.nb);
    await this.loadPage(at);
  }

  updTop() {
    const q = this.q, p = this.page;
    q('.ttl').textContent = this.nb.title;
    q('.pgl').textContent = `${this.idx + 1} / ${this.nb.pages.length}`;
    q('.badges').innerHTML = (p.locked ? `<span class="badge">${icon('lock')}</span>` : '') + (p.mark ? `<span class="badge">${icon('bookmark')}</span>` : '');
  }

  // ---------------- zoom y dibujo de lienzos ----------------
  fit() {
    const r = this.sc.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.zFit = Math.min((r.width - 24) / W, (r.height - 24) / H);
    this.setZoom(this.zMul, false, true);
  }

  setZoom(m, keep = true, force = false) {
    m = Math.max(0.6, Math.min(4, m));
    const z = this.zFit * m;
    if (!force && Math.abs(z - this.z) < 1e-4) return;
    const sc = this.sc, oz = this.z || z;
    const cx = (sc.scrollLeft + sc.clientWidth / 2) / oz, cy = (sc.scrollTop + sc.clientHeight / 2) / oz;
    this.zMul = m; this.z = z;
    this.layout();
    if (keep) { sc.scrollLeft = cx * z - sc.clientWidth / 2; sc.scrollTop = cy * z - sc.clientHeight / 2; }
    this.renderBg(); this.renderInk(); this.drawSel();
    this.q('.zv').textContent = Math.round(m * 100) + '%';
  }

  layout() {
    const z = this.z, dpr = devicePixelRatio || 1;
    const k = Math.min(z * dpr, 2.2);
    this.k = k;
    const sw = W * z, sh = H * z, cw = Math.round(W * k), ch = Math.round(H * k);
    this.sheet.style.width = sw + 'px'; this.sheet.style.height = sh + 'px';
    for (const c of [this.cBg, this.cInk, this.cLive]) {
      c.width = cw; c.height = ch; c.style.width = sw + 'px'; c.style.height = sh + 'px';
      c.getContext('2d').setTransform(k, 0, 0, k, 0, 0);
    }
  }

  async renderBg() {
    if (!this.page) return;
    const tok = this.bgTok = (this.bgTok || 0) + 1;
    const off = document.createElement('canvas');
    off.width = this.cBg.width; off.height = this.cBg.height;
    const x = off.getContext('2d'); x.setTransform(this.k, 0, 0, this.k, 0, 0);
    await drawBackground(x, this.page, this.nb, Math.max(1, this.k));
    if (tok !== this.bgTok || off.width !== this.cBg.width) return;
    this.xBg.save(); this.xBg.setTransform(1, 0, 0, 1, 0, 0); this.xBg.drawImage(off, 0, 0); this.xBg.restore();
  }

  renderInk() {
    if (!this.page) return;
    const x = this.xInk;
    x.clearRect(0, 0, W, H);
    for (const L of this.page.layers) if (L.vis) for (const o of L.objs) ink.drawObj(x, o, () => this.reqInk());
    // Marcas de índice y destacados en el margen
    for (const m of this.page.marks || []) {
      x.save(); x.fillStyle = '#141414'; x.font = '600 34px Inter, sans-serif'; x.textBaseline = 'middle';
      x.fillText(m.type === 'star' ? '★' : '§', Math.max(6, m.box.x - 44), m.box.y + Math.min(30, m.box.h / 2));
      x.restore();
    }
  }
  reqInk() { if (this.rafInk) return; this.rafInk = requestAnimationFrame(() => { this.rafInk = 0; this.renderInk(); }); }
  reqLive() { if (this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = 0; this.paintLive(); }); }

  paintLive() {
    const x = this.xLive, a = this.act;
    x.clearRect(0, 0, W, H);
    if (!a) return;
    if (a.kind === 'draw') ink.drawStroke(x, a.s);
    else if (a.kind === 'lasso' || a.kind === 'eraseArea') {
      const p = a.poly;
      x.save(); x.setLineDash([10, 8]); x.lineWidth = 2.5; x.strokeStyle = '#141414';
      x.beginPath(); x.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) x.lineTo(p[i], p[i + 1]); x.stroke(); x.restore();
    } else if (a.kind === 'erase' && a.last) {
      x.save(); x.strokeStyle = '#7a7a7a'; x.lineWidth = 2; x.beginPath(); x.arc(a.last.x, a.last.y, settings.eraserSize, 0, 7); x.stroke(); x.restore();
    }
  }

  // ---------------- herramientas ----------------
  layer() { return this.page.layers[this.page.al] || this.page.layers[0]; }
  isLocked() { return !!this.page.locked; }
  side() { return settings.leftHanded ? 'left' : 'right'; }

  pickTool(t, btn) {
    if (this.editingText) this.editingText();
    if (this.tool === t) {
      if (t === 'pen0' || t === 'pen1' || t === 'hl') this.penPop(t, btn);
      else if (t === 'eraser') this.eraserPop(btn);
      else if (t === 'text') this.textPop(btn);
      return;
    }
    this.tool = t;
    if (t !== 'lasso') this.clearSel();
    this.updTools(); this.drawSel();
  }

  updTools() {
    this.el.querySelectorAll('.tb [data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === this.tool));
    this.el.querySelectorAll('.tb [data-t^=pen]').forEach(b => {
      const cfg = settings.pens[+b.dataset.t.slice(3)];
      b.querySelector('.dot').style.cssText = `background:${cfg.c};height:${Math.min(6, 1 + cfg.w)}px`;
    });
  }

  penPop(t, btn) {
    const isHl = t === 'hl';
    const cfg = isHl ? settings.hl : settings.pens[+t.slice(3)];
    const el = h('<div class="penpop"></div>');
    const draw = () => {
      const colors = isHl ? (settings.color ? [...HL_GRAYS, ...HL_COLORS] : HL_GRAYS) : (settings.color ? [...GRAYS, ...COLORS] : GRAYS);
      el.innerHTML = `<div class="pop-t">${isHl ? 'Fluorescente' : 'Lápiz ' + (+t.slice(3) + 1)}</div>
        ${isHl ? '' : `<div class="brushes">${BRUSHES.map(([id, n]) => `<button class="chip ${cfg.b === id ? 'on' : ''}" data-b="${id}">${n}</button>`).join('')}</div>`}
        <div class="lbl">Grosor</div>
        <div class="row">${WIDTHS.map(w => { const v = isHl ? w * 3 : w; return `<button class="wd ${Math.abs(cfg.w - (isHl ? w * 3 : w)) < 0.01 ? 'on' : ''}" data-w="${v}"><i style="width:${Math.min(26, 3 + v * (isHl ? 0.9 : 3))}px;height:${Math.min(26, 3 + v * (isHl ? 0.9 : 3))}px"></i></button>`; }).join('')}</div>
        <div class="lbl">Color</div>
        <div class="row">${colors.map(c => `<button class="sw ${cfg.c === c ? 'on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}</div>
        <canvas class="pv" width="560" height="110"></canvas>`;
      const cv = el.querySelector('.pv'), x = cv.getContext('2d');
      x.fillStyle = '#fbfaf6'; x.fillRect(0, 0, 560, 110); x.scale(2, 2);
      const pts = [];
      for (let i = 0; i <= 60; i++) { const tt = i / 60; pts.push(20 + tt * 240, 28 + Math.sin(tt * Math.PI * 2) * 14, 0.25 + 0.75 * Math.sin(tt * Math.PI)); }
      ink.drawStroke(x, { b: isHl ? 'marca' : cfg.b, w: cfg.w, c: cfg.c, pts });
    };
    el.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.b) cfg.b = b.dataset.b;
      if (b.dataset.w) cfg.w = +b.dataset.w;
      if (b.dataset.c) cfg.c = b.dataset.c;
      saveSettings(); this.updTools(); draw();
    };
    draw();
    pop(btn, el, { side: this.side() });
  }

  eraserPop(btn) {
    const el = h('<div class="penpop"></div>');
    const draw = () => {
      el.innerHTML = `<div class="pop-t">Borrador</div>
        <div class="seg"><button data-m="trazo" class="${settings.eraserMode === 'trazo' ? 'on' : ''}">Trazo</button><button data-m="area" class="${settings.eraserMode === 'area' ? 'on' : ''}">Lazo</button></div>
        <p class="sub" style="margin:8px 0">${settings.eraserMode === 'trazo' ? 'Borra los trazos que toques.' : 'Rodea con el lápiz lo que quieras borrar.'}</p>
        <div class="lbl">Tamaño</div>
        <input type="range" min="6" max="60" value="${settings.eraserSize}" class="rng">
        <button class="btn danger" data-m="clear" style="margin-top:12px;width:100%">${icon('trash')} Borrar toda la página</button>`;
    };
    el.addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.m === 'clear') {
        closePop();
        if (this.isLocked()) return toast('Página bloqueada');
        if (await confirm('¿Borrar todo el contenido de esta página?', 'Borrar', 'Se puede deshacer con el botón Deshacer.')) {
          this.snap(); for (const L of this.page.layers) L.objs = []; this.clearSel(); this.renderInk(); this.dirty();
        }
        return;
      }
      settings.eraserMode = b.dataset.m; saveSettings(); draw();
    });
    el.addEventListener('input', e => { if (e.target.classList.contains('rng')) { settings.eraserSize = +e.target.value; saveSettings(); } });
    draw();
    pop(btn, el, { side: this.side() });
  }

  textPop(btn) {
    const el = h(`<div class="penpop"><div class="pop-t">Texto</div><div class="lbl">Tamaño de letra</div><div class="row">${[24, 30, 36, 48, 64].map(s => `<button class="chip ${settings.textSize === s ? 'on' : ''}" data-s="${s}">${s}</button>`).join('')}</div><p class="sub">Toca la página para escribir con el teclado. Toca un texto existente para editarlo.</p></div>`);
    el.onclick = e => { const b = e.target.closest('[data-s]'); if (!b) return; settings.textSize = +b.dataset.s; saveSettings(); el.querySelectorAll('[data-s]').forEach(x => x.classList.toggle('on', x === b)); };
    pop(btn, el, { side: this.side() });
  }

  // ---------------- deshacer / guardar ----------------
  snap() {
    this.undo.push(JSON.stringify(this.page.layers));
    if (this.undo.length > 60) this.undo.shift();
    this.redo = [];
  }
  doUndo() {
    if (!this.undo.length) return toast('Nada que deshacer', 1200);
    this.redo.push(JSON.stringify(this.page.layers));
    this.page.layers = JSON.parse(this.undo.pop());
    this.clearSel(); this.renderInk(); this.dirty();
  }
  doRedo() {
    if (!this.redo.length) return toast('Nada que rehacer', 1200);
    this.undo.push(JSON.stringify(this.page.layers));
    this.page.layers = JSON.parse(this.redo.pop());
    this.clearSel(); this.renderInk(); this.dirty();
  }
  dirty() {
    clearTimeout(this.saveT);
    this.saveT = setTimeout(() => { this.saveT = 0; this.save(); }, 800);
  }
  async flushSave() {
    if (this.saveT) { clearTimeout(this.saveT); this.saveT = 0; await this.save(); }
  }
  thumb() {
    const c = document.createElement('canvas'); c.width = 180; c.height = 240;
    const x = c.getContext('2d');
    x.drawImage(this.cBg, 0, 0, 180, 240); x.drawImage(this.cInk, 0, 0, 180, 240);
    return c.toDataURL('image/jpeg', 0.72);
  }
  async save() {
    const p = this.page; if (!p) return;
    p.updated = Date.now();
    try { p.thumb = this.thumb(); } catch (e) { /* lienzo aún vacío */ }
    await db.put('pages', p);
    this.nb.updated = p.updated;
    // Texto de la página para el buscador: lo tecleado + lo reconocido de la escritura (si se pidió).
    const typed = p.layers.flatMap(L => L.objs).filter(o => o.t === 'x').map(o => o.text || RT.plain(o)).join(' ');
    this.nb.txt = { ...(this.nb.txt || {}), [p.id]: (typed + ' ' + (p.ocr || '') + ' ' + (p.marks || []).map(m => m.label || '').join(' ')).trim() };
    this.nb.marks = (this.nb.marks || []).filter(m => m.pid !== p.id).concat((p.marks || []).map(m => ({ ...m, pid: p.id })));
    if (this.idx === 0 || !this.nb.cover) this.nb.cover = p.thumb;
    await db.put('notebooks', this.nb);
  }

  // ---------------- entrada: S Pen, dedo y ratón ----------------
  pt(e) {
    const r = this.cLive.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.z, y: (e.clientY - r.top) / this.z, p: e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5 };
  }

  effTool(e) {
    if (e.pointerType === 'pen') {
      if ((e.buttons & 32) || e.button === 5) return 'eraser';
      if (e.buttons & 2) return settings.penButton === 'lasso' ? 'lasso' : settings.penButton === 'hl' ? 'hl' : 'eraser';
    }
    if (e.pointerType === 'mouse' && e.button === 2) return 'eraser';
    return this.tool;
  }

  down(e) {
    e.preventDefault();
    if (this.editingText) { this.editingText(); return; }
    closePop();
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
      if (this.touches.size === 1) {
        this.g = { n: 1, t: performance.now(), moved: false, sl: this.sc.scrollLeft, st: this.sc.scrollTop };
      } else {
        this.g.n = Math.max(this.g.n, this.touches.size);
        if (this.act && this.act.touch) this.cancelAction();
        if (this.touches.size === 2) this.startPinch();
      }
      if (settings.penOnly || this.touches.size > 1) return;
    }
    if (this.act) return;
    try { this.cLive.setPointerCapture(e.pointerId); } catch (_) {}
    this.startAction(e);
  }

  move(e) {
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      const t = this.touches.get(e.pointerId);
      t.x = e.clientX; t.y = e.clientY;
      if (Math.hypot(t.x - t.sx, t.y - t.sy) > 14) this.g.moved = true;
      if (this.touches.size >= 2 && this.g.pinch) this.movePinch();
      else if (this.touches.size === 1 && settings.penOnly) {
        this.sc.scrollLeft = this.g.sl - (t.x - t.sx);
        this.sc.scrollTop = this.g.st - (t.y - t.sy);
      }
    }
    if (!this.act || this.act.id !== e.pointerId) return;
    this.moveAction(e);
  }

  up(e, cancel) {
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      const t = this.touches.get(e.pointerId);
      this.touches.delete(e.pointerId);
      if (this.touches.size === 0 && this.g) {
        const g = this.g, dt = performance.now() - g.t;
        if (g.pinch && g.pinch.s && Math.abs(g.pinch.s - 1) > 0.04) this.endPinch();
        else {
          if (g.pinch) this.sheet.style.transform = '';
          if (g.n >= 2 && !g.moved && dt < 450 && settings.gestures) { g.n === 2 ? this.doUndo() : this.doRedo(); }
          else if (g.n === 1 && settings.penOnly && settings.swipe) {
            const dx = t.x - t.sx, dy = t.y - t.sy;
            const noOverflowX = this.sc.scrollWidth <= this.sc.clientWidth + 2;
            if (noOverflowX && Math.abs(dx) > 90 && Math.abs(dy) < 80) this.go(dx < 0 ? 1 : -1);
          }
        }
        this.g = null;
      }
    }
    if (this.act && this.act.id === e.pointerId) this.endAction(e, cancel);
  }

  startPinch() {
    const [a, b] = [...this.touches.values()];
    const r = this.sheet.getBoundingClientRect();
    this.g.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), m0: this.zMul, ox: ((a.x + b.x) / 2 - r.left), oy: ((a.y + b.y) / 2 - r.top), s: 1 };
    this.sheet.style.transformOrigin = `${this.g.pinch.ox}px ${this.g.pinch.oy}px`;
  }
  movePinch() {
    const [a, b] = [...this.touches.values()];
    const P = this.g.pinch;
    P.s = Math.max(0.6 / P.m0, Math.min(4 / P.m0, Math.hypot(a.x - b.x, a.y - b.y) / P.d0));
    if (Math.abs(P.s - 1) > 0.04) { this.g.moved = true; this.sheet.style.transform = `scale(${P.s})`; }
  }
  endPinch() {
    const P = this.g.pinch;
    this.sheet.style.transform = '';
    this.setZoom(P.m0 * P.s);
  }

  startAction(e) {
    const p = this.pt(e), tool = this.effTool(e), id = e.pointerId, touch = e.pointerType === 'touch';
    if (this.isLocked() && tool !== 'lasso') { toast('Página bloqueada · desbloquéala en ⋯'); return; }
    switch (tool) {
      case 'pen0': case 'pen1': case 'hl': {
        const cfg = tool === 'hl' ? settings.hl : settings.pens[+tool.slice(3)];
        const s = { t: 's', b: tool === 'hl' ? 'marca' : cfg.b, w: cfg.w, c: cfg.c, pts: [p.x, p.y, p.p] };
        this.act = { id, touch, kind: 'draw', s, t0: performance.now(), wall: Date.now() };
        this.armHold(p);
        this.reqLive();
        break;
      }
      case 'eraser':
        if (settings.eraserMode === 'area') { this.act = { id, touch, kind: 'eraseArea', poly: [p.x, p.y] }; }
        else { this.snap(); this.act = { id, touch, kind: 'erase', last: p, changed: false }; this.eraseAt(p); }
        this.reqLive();
        break;
      case 'lasso': {
        if (this.sel) {
          const b = this.selBox();
          if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
            if (this.isLocked()) return toast('Página bloqueada');
            this.snap();
            this.act = { id, touch, kind: 'move', p0: p, orig: this.sel.objs.map(ink.clone) };
            this.q('.selbar')?.remove();
            return;
          }
          this.clearSel();
        }
        this.act = { id, touch, kind: 'lasso', poly: [p.x, p.y] };
        break;
      }
      case 'text':
        this.textAt(p);
        break;
    }
  }

  armHold(p) {
    const a = this.act;
    clearTimeout(a.ht);
    a.hp = p;
    if (!settings.shapes || a.s.b === 'marca') return;
    a.ht = setTimeout(() => {
      if (this.act !== a || a.shaped) return;
      const r = ink.recognize(a.s.pts);
      if (r) { a.s.pts = r; a.shaped = true; this.reqLive(); }
    }, settings.holdMs);
  }

  moveAction(e) {
    const a = this.act;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const list = evs.length ? evs : [e];
    for (const ev of list) {
      const p = this.pt(ev);
      switch (a.kind) {
        case 'draw': {
          if (a.shaped) break;
          const P = a.s.pts, lx = P[P.length - 3], ly = P[P.length - 2];
          if (Math.hypot(p.x - lx, p.y - ly) < 0.7) break;
          P.push(p.x, p.y, p.p);
          if (!a.hp || Math.hypot(p.x - a.hp.x, p.y - a.hp.y) > 5) this.armHold(p);
          break;
        }
        case 'erase': {
          const l = a.last, d = Math.hypot(p.x - l.x, p.y - l.y), step = settings.eraserSize / 2;
          for (let k = step; k < d; k += step) this.eraseAt({ x: l.x + (p.x - l.x) * k / d, y: l.y + (p.y - l.y) * k / d });
          this.eraseAt(p); a.last = p;
          break;
        }
        case 'lasso': case 'eraseArea': a.poly.push(p.x, p.y); break;
        case 'move': {
          const dx = p.x - a.p0.x, dy = p.y - a.p0.y;
          this.sel.objs.forEach((o, i) => { ink.restore(o, a.orig[i]); ink.translate(o, dx, dy); });
          this.reqInk(); this.updSelBox();
          break;
        }
      }
    }
    if (a.kind !== 'move') this.reqLive();
  }

  endAction(e, cancel) {
    const a = this.act; this.act = null;
    clearTimeout(a.ht);
    if (cancel && a.kind === 'draw') { this.reqLive(); return; }
    switch (a.kind) {
      case 'draw':
        this.snap();
        if (this.mr && this.recId) { a.s.ar = this.recId; a.s.at = Math.max(0, a.wall - this.recT0); }
        this.layer().objs.push(a.s);
        ink.drawObj(this.xInk, a.s);
        this.dirty();
        break;
      case 'erase':
        if (a.changed) this.dirty(); else this.undo.pop();
        break;
      case 'eraseArea': {
        const objs = this.objsInPoly(a.poly);
        if (objs.length) { this.snap(); this.removeObjs(objs); this.renderInk(); this.dirty(); }
        break;
      }
      case 'lasso': {
        const objs = a.poly.length > 8 ? this.objsInPoly(a.poly) : [];
        this.select(objs);
        break;
      }
      case 'move':
        this.drawSel(); this.dirty();
        break;
    }
    this.reqLive();
  }

  cancelAction() { const a = this.act; this.act = null; if (a) clearTimeout(a.ht); this.reqLive(); }

  eraseAt(p) {
    const r = settings.eraserSize;
    let hit = false;
    for (const L of this.page.layers) {
      if (!L.vis) continue;
      const n = L.objs.length;
      L.objs = L.objs.filter(o => !(o.t === 's' && ink.hitStroke(o, p.x, p.y, r)));
      if (L.objs.length !== n) hit = true;
    }
    if (hit) { this.act.changed = true; this.reqInk(); }
  }

  objsInPoly(poly) {
    const out = [];
    for (const L of this.page.layers) if (L.vis) for (const o of L.objs) if (ink.objInPoly(o, poly)) out.push(o);
    return out;
  }
  removeObjs(objs) {
    const s = new Set(objs);
    for (const L of this.page.layers) L.objs = L.objs.filter(o => !s.has(o));
  }

  // ---------------- selección (lazo) ----------------
  select(objs) { this.sel = objs.length ? { objs } : null; this.drawSel(); }
  clearSel() { if (this.sel) { this.sel = null; this.drawSel(); } }
  selBox() { const b = ink.unionBox(this.sel.objs); return { x: b.x - 8, y: b.y - 8, w: b.w + 16, h: b.h + 16 }; }

  updSelBox() {
    const box = this.ovl.querySelector('.selbox'); if (!box || !this.sel) return;
    const b = this.selBox(), z = this.z;
    Object.assign(box.style, { left: b.x * z + 'px', top: b.y * z + 'px', width: b.w * z + 'px', height: b.h * z + 'px' });
  }

  drawSel() {
    this.ovl.querySelectorAll('.selbox,.selbar').forEach(n => n.remove());
    const pb = this.q('.paste'); if (pb) pb.hidden = !(CLIP && this.tool === 'lasso');
    if (!this.sel) return;
    const b = this.selBox(), z = this.z;
    const box = h(`<div class="selbox"><div class="handle" title="Cambiar tamaño"></div></div>`);
    this.ovl.append(box); this.updSelBox();
    const bar = h(`<div class="selbar">
      <button data-s="ocr">${icon('spark')}A texto</button><button data-s="copy">${icon('copy')}Copiar</button><button data-s="cut">${icon('cut')}Cortar</button>
      <button data-s="dup">${icon('dup')}Duplicar</button><button data-s="del">${icon('trash')}Borrar</button>
      <button data-s="layer">${icon('moveLayer')}Capa</button><button data-s="event">${icon('event')}Evento</button>
      <button data-s="todo">${icon('task')}Tarea</button><button data-s="head">${icon('listN')}Índice</button><button data-s="star">${icon('star')}Destacar</button>
      ${this.sel.objs.some(o => o.ar) ? `<button data-s="listen">${icon('headphones')}Escuchar</button>` : ''}<button data-s="pick">${icon('picking')}Recorte</button></div>`);
    this.ovl.append(bar);
    const bw = bar.offsetWidth, sw = W * z;
    let top = b.y * z - bar.offsetHeight - 10;
    if (top < 4) top = (b.y + b.h) * z + 12;
    bar.style.top = top + 'px';
    bar.style.left = Math.max(4, Math.min(b.x * z, sw - bw - 4)) + 'px';
    bar.onclick = e => { const x = e.target.closest('[data-s]'); if (x) this.selAction(x.dataset.s, x); };
    box.querySelector('.handle').addEventListener('pointerdown', e => this.startScale(e));
  }

  startScale(e) {
    e.preventDefault(); e.stopPropagation();
    if (this.isLocked()) return toast('Página bloqueada');
    const hd = e.currentTarget, b = this.selBox(), p0 = this.pt(e);
    const d0 = Math.max(10, Math.hypot(p0.x - b.x, p0.y - b.y));
    this.snap();
    const orig = this.sel.objs.map(ink.clone);
    this.q('.selbar')?.remove();
    hd.setPointerCapture(e.pointerId);
    const mv = ev => {
      const p = this.pt(ev);
      const k = Math.max(0.1, Math.hypot(p.x - b.x, p.y - b.y) / d0);
      this.sel.objs.forEach((o, i) => { ink.restore(o, orig[i]); ink.scale(o, b.x + 8, b.y + 8, k); });
      this.reqInk(); this.updSelBox();
    };
    const end = () => { hd.removeEventListener('pointermove', mv); hd.removeEventListener('pointerup', end); hd.removeEventListener('pointercancel', end); this.drawSel(); this.dirty(); };
    hd.addEventListener('pointermove', mv); hd.addEventListener('pointerup', end); hd.addEventListener('pointercancel', end);
  }

  selImage() {
    const b = ink.unionBox(this.sel.objs);
    const pad = 16, s = Math.min(1, 1400 / Math.max(b.w, b.h));
    const c = document.createElement('canvas');
    c.width = Math.ceil((b.w + pad * 2) * s); c.height = Math.ceil((b.h + pad * 2) * s);
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
    x.scale(s, s); x.translate(pad - b.x, pad - b.y);
    for (const o of this.sel.objs) ink.drawObj(x, o);
    return { src: c.toDataURL('image/png'), w: c.width, h: c.height };
  }

  async selAction(a, btn) {
    const objs = this.sel.objs;
    const locked = this.isLocked() && ['cut', 'dup', 'del', 'layer'].includes(a);
    if (locked) return toast('Página bloqueada');
    switch (a) {
      case 'copy': CLIP = objs.map(ink.clone); toast('Copiado'); this.drawSel(); break;
      case 'cut': CLIP = objs.map(ink.clone); this.snap(); this.removeObjs(objs); this.clearSel(); this.renderInk(); this.dirty(); toast('Cortado'); break;
      case 'del': this.snap(); this.removeObjs(objs); this.clearSel(); this.renderInk(); this.dirty(); break;
      case 'dup': {
        this.snap();
        const c = objs.map(ink.clone); c.forEach(o => ink.translate(o, 30, 30));
        this.layer().objs.push(...c); this.renderInk(); this.select(c); this.dirty();
        break;
      }
      case 'layer':
        menu(btn, this.page.layers.map((L, i) => ({
          label: L.name + (i === this.page.al ? ' (activa)' : ''), icon: 'layers',
          run: () => { this.snap(); this.removeObjs(objs); this.page.layers[i].objs.push(...objs); this.renderInk(); this.drawSel(); this.dirty(); toast('Movido a ' + L.name); }
        })));
        break;
      case 'event': case 'todo': {
        const img = this.selImage();
        const def = this.nb.date || dkey();
        const r = await prompt(a === 'event' ? 'Crear evento en la Agenda' : 'Crear tarea en la Agenda', [
          { name: 'date', label: 'Fecha', type: 'date', value: def },
          ...(a === 'event' ? [{ name: 'time', label: 'Hora', type: 'time', value: '09:00' }] : []),
          { name: 'title', label: 'Título (opcional, se guarda también tu letra)', value: '' }
        ], 'Crear');
        if (!r || !r.date) return;
        const src = { nb: this.nb.id, pid: this.page.id };
        if (a === 'event') await db.put('events', { id: uid(), date: r.date, time: r.time || '', title: r.title, img: img.src, src });
        else await db.put('todos', { id: uid(), date: r.date, text: r.title, img: img.src, done: false, src });
        toast(a === 'event' ? 'Evento añadido a la Agenda' : 'Tarea añadida a la Agenda');
        break;
      }
      case 'pick': await store.newPicking(this.selImage()); toast('Guardado en Recortes'); break;
      case 'head': case 'star': {
        const b = ink.unionBox(objs), img = this.selImage();
        let label = '';
        if (a === 'head') {
          const r = await prompt('Añadir al índice', [{ name: 't', label: 'Título de la sección (opcional; se guarda también tu letra)', value: '' }], 'Añadir');
          if (!r) return;
          label = r.t.trim();
        }
        this.page.marks = [...(this.page.marks || []), { id: uid(), type: a, label, box: b, img: await shrink(img.src) }];
        this.renderInk(); this.dirty();
        toast(a === 'head' ? 'Añadido al índice del cuaderno' : 'Destacado ★ (lo verás en Inicio)');
        break;
      }
      case 'listen': {
        const first = objs.filter(o => o.ar).sort((x, y) => x.at - y.at)[0];
        this.playAt(first.ar, first.at);
        break;
      }
      case 'ocr': {
        if (!this.aiReady()) return;
        const b = ink.unionBox(objs), img = this.selImage();
        const text = await this.aiBusy(() => AI.ask([{ text: AI.P.ocr }, AI.dataUrlPart(img.src)]));
        if (text) this.aiResult('Texto reconocido', text, { x: b.x, y: Math.min(H - 120, b.y + b.h + 30) });
        break;
      }
    }
  }

  // ---------------- Gemini (IA) ----------------
  aiReady() {
    if (AI.hasKey()) return true;
    confirm('Falta la clave de Gemini', 'Ir a Ajustes', 'Para usar la IA, crea una clave gratuita en Google AI Studio y pégala en Ajustes → Inteligencia artificial.')
      .then(ok => { if (ok) location.hash = '#/ajustes'; });
    return false;
  }

  async aiBusy(fn) {
    const t = toast('Gemini está pensando…', 180000);
    try { return await fn(); }
    catch (e) { toast(e.message || 'Error de Gemini', 6000); return null; }
    finally { t.remove(); }
  }

  async pageParts(all) {
    await this.flushSave();
    const ids = all ? this.nb.pages.slice(0, 30) : [this.nb.pages[this.idx]];
    const parts = [];
    for (const id of ids) {
      const p = id === this.page.id ? this.page : await db.get('pages', id);
      if (p) parts.push(AI.canvasPart(await pageCanvas(p, this.nb, 0.75), 0.72));
    }
    return parts;
  }

  aiMenu(btn) {
    if (!this.aiReady()) return;
    const run = (title, prompt, all) => async () => {
      const text = await this.aiBusy(async () => AI.ask([{ text: prompt }, ...await this.pageParts(all)]));
      if (text) this.aiResult(title, text);
    };
    menu(btn, [
      { icon: 'text', label: 'Pasar esta página a texto', run: run('Texto de la página', AI.P.ocr, false) },
      { icon: 'pen2', label: 'Pasar a limpio esta página', run: run('Pasado a limpio', AI.P.clean, false) },
      { icon: 'notebook', label: 'Resumir esta página', run: run('Resumen de la página', AI.P.summary, false) },
      this.nb.pages.length > 1 && { icon: 'pages', label: 'Resumir todo el cuaderno', run: run('Resumen del cuaderno', AI.P.summary, true) },
      { icon: 'event', label: 'Sacar citas y tareas a la Agenda', run: () => this.aiExtract() },
      { icon: 'search', label: 'Preguntar a este cuaderno', run: () => this.aiAsk() },
      { icon: 'share', label: 'Traducir esta página', run: () => this.aiTranslate() },
      (this.nb.recs || []).length && { icon: 'headphones', label: 'Resumir una grabación', run: () => this.aiMeeting() },
      { icon: 'search', label: 'Reconocer la escritura para el buscador', run: () => this.aiIndex() }
    ], { side: this.side() });
  }

  aiResult(title, text, at) {
    const ta = h('<textarea class="aires" rows="12" spellcheck="false"></textarea>');
    ta.value = text;
    modal(title + ' · Gemini', ta, [
      { label: 'Cerrar', value: null },
      { label: 'Copiar', value: () => { navigator.clipboard?.writeText(ta.value).then(() => toast('Copiado'), () => toast('No se pudo copiar')); return undefined; } },
      { label: 'Insertar en la página', pri: true, value: () => ta.value }
    ], { wide: true }).then(v => { if (v) this.insertText(v, at); });
  }

  insertText(text, at = { x: 90, y: 110 }) {
    if (this.isLocked()) return toast('Página bloqueada');
    this.snap();
    const size = Math.min(settings.textSize, 32);
    const o = { t: 'x', x: at.x, y: at.y, size, c: settings.pens[0].c, f: 'serif', w: Math.max(300, W - at.x - 60), text: text.trim(), paras: RT.fromPlain(text.trim()) };
    this.layer().objs.push(o);
    this.tool = 'lasso'; this.updTools();
    this.renderInk(); this.select([o]); this.dirty();
    toast('Texto insertado: muévelo con el lazo si hace falta');
  }

  async aiExtract() {
    const all = this.nb.kind === 'meeting' && this.nb.pages.length > 1;
    const res = await this.aiBusy(async () => AI.ask([{ text: AI.P.extract() }, ...await this.pageParts(all)], { json: true }));
    if (!res) return;
    const okDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
    const evs = (res.eventos || []).filter(e => e.titulo && okDate(e.fecha));
    const tds = (res.tareas || []).filter(t => t.texto).map(t => ({ ...t, fecha: okDate(t.fecha) ? t.fecha : dkey() }));
    if (!evs.length && !tds.length) return toast('Gemini no encontró citas ni tareas en esta página', 4000);
    const el = h(`<div class="list">${evs.map((e, i) => `<label class="li"><input type="checkbox" checked data-e="${i}"> ${icon('event')} <b>${esc(e.fecha)} ${esc(e.hora || '')}</b> <span class="tx">${esc(e.titulo)}</span></label>`).join('')}
      ${tds.map((t, i) => `<label class="li"><input type="checkbox" checked data-t="${i}"> ${icon('task')} <b>${esc(t.fecha)}</b> <span class="tx">${esc(t.texto)}</span></label>`).join('')}</div>`);
    const ok = await modal('Añadir a la Agenda', el, [{ label: 'Cancelar', value: false }, { label: 'Añadir marcados', pri: true, value: true }]);
    if (!ok) return;
    let n = 0;
    for (const c of el.querySelectorAll('input:checked')) {
      if (c.dataset.e !== undefined) { const e = evs[+c.dataset.e]; await db.put('events', { id: uid(), date: e.fecha, time: /^\d{2}:\d{2}$/.test(e.hora || '') ? e.hora : '', title: e.titulo }); }
      else { const t = tds[+c.dataset.t]; await db.put('todos', { id: uid(), date: t.fecha, text: t.texto, done: false }); }
      n++;
    }
    toast(`${n} elementos añadidos a la Agenda`);
  }

  // Pasa a texto la letra de cada página (con Gemini) para poder buscarla desde Cuadernos.
  async aiIndex() {
    await this.flushSave();
    const t = toast('Reconociendo la escritura…', 600000);
    let n = 0;
    try {
      for (let i = 0; i < this.nb.pages.length; i++) {
        const id = this.nb.pages[i], p = id === this.page.id ? this.page : await db.get('pages', id);
        if (!p || (p.ocrAt && p.ocrAt >= p.updated)) continue;
        if (!p.layers.some(L => L.objs.some(o => o.t === 's'))) continue;
        t.textContent = `Reconociendo la escritura… página ${i + 1} de ${this.nb.pages.length}`;
        const txt = await AI.ask([{ text: AI.P.ocr }, AI.canvasPart(await pageCanvas(p, this.nb, 0.75), 0.72)]);
        p.ocr = txt === '(sin texto)' ? '' : txt; p.ocrAt = Date.now() + 1;
        await db.put('pages', p);
        const typed = p.layers.flatMap(L => L.objs).filter(o => o.t === 'x').map(o => o.text || RT.plain(o)).join(' ');
        this.nb.txt = { ...(this.nb.txt || {}), [p.id]: (typed + ' ' + p.ocr).trim() };
        await db.put('notebooks', this.nb);
        n++;
      }
      toast(n ? `Listo: ${n} páginas reconocidas. Ya puedes buscarlas desde Cuadernos.` : 'Ya estaba todo reconocido.', 4000);
    } catch (e) { toast(e.message || 'No se pudo reconocer la escritura', 6000); }
    finally { t.remove(); }
  }

  async aiAsk() {
    const r = await prompt('Preguntar a este cuaderno', [{ name: 'q', label: 'Tu pregunta', type: 'textarea', value: '' }], 'Preguntar');
    if (!r || !r.q.trim()) return;
    const text = await this.aiBusy(async () => AI.ask([{ text: AI.P.question(r.q.trim()) }, ...await this.pageParts(true)]));
    if (text) this.aiResult('Respuesta', text);
  }

  async aiTranslate() {
    const r = await prompt('Traducir esta página', [{ name: 'l', label: 'Idioma', type: 'select', value: 'inglés', options: ['inglés', 'francés', 'alemán', 'italiano', 'portugués', 'catalán'].map(x => ({ value: x, label: x })) }], 'Traducir');
    if (!r) return;
    const text = await this.aiBusy(async () => AI.ask([{ text: AI.P.translate(r.l) }, ...await this.pageParts(false)]));
    if (text) this.aiResult('Traducción', text);
  }

  async aiMeeting() {
    const recs = (await Promise.all((this.nb.recs || []).map(id => db.get('blobs', id)))).filter(Boolean);
    if (!recs.length) return toast('Esta reunión no tiene grabaciones');
    let rec = recs[recs.length - 1];
    if (recs.length > 1) {
      const r = await prompt('¿Qué grabación?', [{ name: 'i', label: 'Grabación', type: 'select', value: String(recs.length - 1), options: recs.map((x, i) => ({ value: String(i), label: `Grabación ${i + 1} · ${fmtDur(x.dur)}` })) }], 'Resumir');
      if (!r) return;
      rec = recs[+r.i];
    }
    if (rec.data.size > 18 * 1024 * 1024) return toast('La grabación es demasiado larga para enviarla a Gemini (máx. ~18 MB).', 5000);
    const text = await this.aiBusy(async () => AI.ask([{ text: AI.P.meeting }, await AI.blobPart(rec.data)]));
    if (text) this.aiResult('Resumen de la reunión', text);
  }

  paste() {
    if (!CLIP) return;
    if (this.isLocked()) return toast('Página bloqueada');
    this.snap();
    const c = CLIP.map(ink.clone); c.forEach(o => ink.translate(o, 40, 40));
    this.layer().objs.push(...c);
    this.tool = 'lasso'; this.updTools();
    this.renderInk(); this.select(c); this.dirty();
  }

  // ---------------- texto e imágenes ----------------
  // Texto con formato: se edita en un cuadro sobre la página con una barra de formato.
  textAt(p) {
    let hit = null;
    for (const L of this.page.layers) if (L.vis) for (const o of L.objs) if (o.t === 'x') {
      const b = ink.bbox(o);
      if (p.x >= b.x - 10 && p.x <= b.x + b.w + 10 && p.y >= b.y - 10 && p.y <= b.y + b.h + 10) hit = o;
    }
    this.snap();
    let o = hit;
    if (hit) this.removeObjs([hit]);
    else o = { t: 'x', x: p.x, y: p.y - settings.textSize * 0.65, size: settings.textSize, c: settings.pens[0].c, f: 'serif', w: Math.min(900, Math.max(300, W - p.x - 40)), paras: [{ runs: [], align: 'left', list: null }] };
    RT.normalize(o);
    if (!o.w) o.w = Math.max(300, ink.bbox(o).w + 40);
    this.renderInk();
    const z = this.z;
    const wrap = h('<div class="rtwrap"><div class="rte" contenteditable="true" spellcheck="true"></div><div class="rtw" title="Ancho del cuadro"></div></div>');
    const ed = wrap.querySelector('.rte');
    ed.innerHTML = RT.toHTML(o);
    Object.assign(ed.style, { fontSize: o.size + 'px', color: o.c || '#141414', fontFamily: RT.FAM[o.f || 'serif'], transform: `scale(${z})` });
    const place = () => {
      ed.style.width = o.w + 'px';
      Object.assign(wrap.style, { left: o.x * z + 'px', top: o.y * z + 'px', width: o.w * z + 'px', height: ed.offsetHeight * z + 'px' });
    };
    ed.addEventListener('input', place);
    this.ovl.append(wrap); place();
    wrap.querySelector('.rtw').addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      const hd = e.currentTarget, x0 = e.clientX, w0 = o.w;
      hd.setPointerCapture(e.pointerId);
      const mv = ev => { o.w = Math.max(120, Math.min(W - o.x, w0 + (ev.clientX - x0) / z)); place(); };
      const up = () => { hd.removeEventListener('pointermove', mv); hd.removeEventListener('pointerup', up); };
      hd.addEventListener('pointermove', mv); hd.addEventListener('pointerup', up);
    });
    document.execCommand('styleWithCSS', false, true);
    const bar = this.rtBar(ed, o, place);
    setTimeout(() => {
      ed.focus();
      const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    }, 30);
    let done = false;
    const commit = () => {
      if (done) return; done = true;
      this.editingText = null;
      o.paras = RT.fromDOM(ed);
      o.text = RT.plain(o);
      delete o.html;
      bar.cleanup(); wrap.remove(); closePop();
      if (o.text.trim()) this.layer().objs.push(o);
      else if (!hit) this.undo.pop();
      this.renderInk(); this.dirty();
    };
    ed.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); commit(); } e.stopPropagation(); });
    this.editingText = commit;
  }

  rtBar(ed, o, place) {
    const bar = h(`<div class="rtbar">
      <button data-c="pTitle" title="Título">Título</button><button data-c="pSub" title="Subtítulo">Subtítulo</button><button data-c="pNormal" title="Texto normal">Normal</button><span class="sep"></span>
      <button data-c="bold" title="Negrita"><b>N</b></button><button data-c="italic" title="Cursiva"><i>K</i></button>
      <button data-c="underline" title="Subrayado"><u>S</u></button><button data-c="strikeThrough" title="Tachado"><s>T</s></button><span class="sep"></span>
      <button data-c="smaller" title="Letra más pequeña">A−</button><span class="szv"></span><button data-c="bigger" title="Letra más grande">A+</button>
      <button data-c="font" title="Tipo de letra">Letra ▾</button>
      <button data-c="color" title="Color del texto"><span class="cbar" style="border-bottom:4px solid #c62828">A</span> ▾</button>
      <button data-c="hilite" title="Resaltar"><span style="background:#ffe066;padding:0 3px">ab</span> ▾</button><span class="sep"></span>
      <button data-c="justifyLeft" title="Alinear a la izquierda">${icon('alignL')}</button><button data-c="justifyCenter" title="Centrar">${icon('alignC')}</button><button data-c="justifyRight" title="Alinear a la derecha">${icon('alignR')}</button>
      <button data-c="insertUnorderedList" title="Lista con viñetas">${icon('listB')}</button><button data-c="insertOrderedList" title="Lista numerada">${icon('listN')}</button><span class="sep"></span>
      <button data-c="dictate" title="Dictar por voz">${icon('mic')}Dictar</button>
      <button data-c="clear" title="Quitar formato">${icon('x')}Formato</button>
      <button class="ok" data-c="done" title="Terminar">${icon('check')} Hecho</button></div>`);
    this.q('.ed-main').append(bar);
    bar.addEventListener('pointerdown', e => { if (e.target.closest('button')) e.preventDefault(); });
    const sel = () => getSelection();
    const inEd = () => sel().rangeCount && ed.contains(sel().anchorNode);
    const ensure = () => {
      if (inEd()) return;
      ed.focus();
      const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
      sel().removeAllRanges(); sel().addRange(r);
    };
    const blockOf = () => {
      let n = sel().anchorNode;
      while (n && n !== ed && !(n.nodeType === 1 && /^(DIV|P|LI)$/.test(n.tagName))) n = n.parentNode;
      return n && n !== ed ? n : null;
    };
    const scope = what => {
      if (!sel().isCollapsed) return false;
      const r = document.createRange(); r.selectNodeContents((what === 'para' && blockOf()) || ed);
      sel().removeAllRanges(); sel().addRange(r);
      return true;
    };
    const curSize = () => {
      let n = sel().anchorNode;
      if (n && n.nodeType === 3) n = n.parentNode;
      return n && ed.contains(n) ? Math.round(parseFloat(getComputedStyle(n).fontSize)) : Math.round(o.size);
    };
    const setSize = px => {
      document.execCommand('styleWithCSS', false, false);
      document.execCommand('fontSize', false, '7');
      document.execCommand('styleWithCSS', false, true);
      ed.querySelectorAll('font[size="7"]').forEach(f => { f.removeAttribute('size'); f.style.fontSize = px + 'px'; });
    };
    const SIZES = [14, 18, 22, 26, 30, 36, 42, 48, 56, 64, 80, 96];
    const STATE = ['bold', 'italic', 'underline', 'strikeThrough', 'justifyLeft', 'justifyCenter', 'justifyRight', 'insertUnorderedList', 'insertOrderedList'];
    const upd = () => {
      if (!inEd()) return;
      bar.querySelector('.szv').textContent = curSize();
      for (const c of STATE) bar.querySelector(`[data-c=${c}]`).classList.toggle('on', document.queryCommandState(c));
      place();
    };
    document.addEventListener('selectionchange', upd);
    let recog = null;
    const stopDict = () => { if (recog) { try { recog.stop(); } catch (e) {} recog = null; } bar.querySelector('[data-c=dictate]')?.classList.remove('on'); };
    bar.cleanup = () => { stopDict(); document.removeEventListener('selectionchange', upd); bar.remove(); };
    const swatches = (list, run, extra) => {
      const el = h(`<div class="penpop"><div class="row">${list.map(c => `<button class="sw" data-v="${c}" style="background:${c}"></button>`).join('')}</div>${extra || ''}</div>`);
      el.addEventListener('pointerdown', e => e.preventDefault());
      el.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; ensure(); run(b.dataset.v); closePop(); upd(); place(); });
      return el;
    };
    bar.addEventListener('click', e => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      ensure();
      const c = b.dataset.c;
      switch (c) {
        case 'done': if (this.editingText) this.editingText(); return;
        case 'bigger': case 'smaller': {
          const all = scope('all'), cur = curSize();
          const nx = c === 'bigger' ? (SIZES.find(s => s > cur) || cur + 16) : ([...SIZES].reverse().find(s => s < cur) || Math.max(10, cur - 4));
          setSize(nx); if (all) sel().collapseToEnd();
          break;
        }
        case 'pTitle': case 'pSub': case 'pNormal': {
          const para = scope('para');
          if (c === 'pNormal') { document.execCommand('removeFormat'); setSize(Math.round(o.size)); }
          else { setSize(c === 'pTitle' ? 56 : 40); if (!document.queryCommandState('bold')) document.execCommand('bold'); }
          if (para) sel().collapseToEnd();
          break;
        }
        case 'clear': document.execCommand('removeFormat'); break;
        case 'dictate': {
          if (recog) { stopDict(); return; }
          const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
          if (!SR) { toast('Este navegador no permite dictar. Usa el micrófono del teclado de la tablet.'); return; }
          recog = new SR();
          recog.lang = 'es-ES'; recog.continuous = true; recog.interimResults = false;
          recog.onresult = ev => {
            for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) {
              ensure(); document.execCommand('insertText', false, ev.results[i][0].transcript.trim() + ' '); place();
            }
          };
          recog.onerror = ev => { if (ev.error !== 'no-speech') toast('Dictado: ' + (ev.error === 'not-allowed' ? 'permiso de micrófono denegado' : ev.error)); stopDict(); };
          recog.onend = () => { if (recog) { try { recog.start(); } catch (e) { stopDict(); } } };
          try { recog.start(); b.classList.add('on'); toast('Habla: lo que digas se escribe aquí'); } catch (e) { stopDict(); }
          return;
        }
        case 'font': {
          const el = h(`<div class="menu">${Object.entries(RT.FAM_NAMES).map(([k, n]) => `<button data-f="${k}" style="font-family:${RT.FAM[k].replace(/"/g, "'")};font-size:18px">${n}</button>`).join('')}</div>`);
          el.addEventListener('pointerdown', ev => ev.preventDefault());
          el.addEventListener('click', ev => { const f = ev.target.closest('[data-f]'); if (!f) return; ensure(); const all = scope('all'); document.execCommand('fontName', false, RT.FAM[f.dataset.f]); if (all) sel().collapseToEnd(); closePop(); place(); });
          pop(b, el, { side: 'below' });
          return;
        }
        case 'color': pop(b, swatches([...GRAYS.slice(0, 4), ...COLORS, '#00838f', '#ad1457'], v => document.execCommand('foreColor', false, v)), { side: 'below' }); return;
        case 'hilite': pop(b, swatches(['#ffe066', '#b9f6ca', '#b3e5fc', '#f8bbd0', '#e0e0e0'], v => document.execCommand('hiliteColor', false, v),
          '<button class="btn sm ghost" data-v="transparent" style="margin-top:10px">Sin resaltado</button>'), { side: 'below' }); return;
        default: document.execCommand(c);
      }
      upd(); place();
    });
    upd();
    return bar;
  }

  async insertImages() {
    if (this.isLocked()) return toast('Página bloqueada');
    const files = await pickFiles('image/*', true);
    if (!files.length) return;
    this.snap();
    const objs = [];
    for (const f of files) {
      try {
        const im = await store.fileToImage(f);
        const o = store.imageObj(im.src, im.w, im.h, { max: 0.6 });
        ink.translate(o, objs.length * 30, objs.length * 30);
        await ink.loadImage(o.src);
        this.layer().objs.push(o); objs.push(o);
      } catch (e) { toast('No se pudo abrir ' + f.name); }
    }
    this.tool = 'lasso'; this.updTools();
    this.renderInk(); this.select(objs); this.dirty();
  }

  // ---------------- acciones de barra ----------------
  async action(a, btn) {
    if (this.editingText && a !== 'undo') this.editingText();
    switch (a) {
      case 'exit': history.length > 1 ? history.back() : (location.hash = '#/home'); break;
      case 'undo': this.doUndo(); break;
      case 'redo': this.doRedo(); break;
      case 'image': this.insertImages(); break;
      case 'ai': this.aiMenu(btn); break;
      case 'layers': this.layersPop(btn); break;
      case 'tpl': this.tplPop(btn); break;
      case 'pages': this.pagesView(); break;
      case 'more': this.moreMenu(btn); break;
      case 'paste': this.paste(); break;
      case 'zin': this.setZoom(this.zMul * 1.25); break;
      case 'zout': this.setZoom(this.zMul / 1.25); break;
      case 'zfit': this.setZoom(1); break;
      case 'prev': this.go(-1); break;
      case 'next': this.go(1); break;
      case 'addpage': this.addPage(); break;
      case 'goto': {
        const r = await prompt('Ir a la página', [{ name: 'n', label: `Número (1 – ${this.nb.pages.length})`, type: 'number', value: this.idx + 1 }], 'Ir');
        const n = r && Math.round(+r.n);
        if (n >= 1 && n <= this.nb.pages.length) this.loadPage(n - 1);
        break;
      }
      case 'rec': this.toggleRec(btn); break;
      case 'marks': this.marksView(); break;
      case 'recs': this.recsPop(btn); break;
    }
  }

  key(e) {
    if (e.target.closest && e.target.closest('input,textarea')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? this.doRedo() : this.doUndo(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); this.doRedo(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'c' && this.sel) this.selAction('copy');
    else if ((e.ctrlKey || e.metaKey) && k === 'v') this.paste();
    else if ((k === 'delete' || k === 'backspace') && this.sel) this.selAction('del');
    else if (k === 'arrowright' || k === 'pagedown') this.go(1);
    else if (k === 'arrowleft' || k === 'pageup') this.go(-1);
  }

  layersPop(btn) {
    const P = this.page;
    const el = h('<div class="lay"></div>');
    const draw = () => {
      el.innerHTML = `<div class="pop-t">Capas</div><p class="sub" style="margin:0 0 8px">Escribe en la capa activa. Oculta capas con el ojo.</p>` +
        P.layers.map((L, i) => `<div class="lrow ${i === P.al ? 'on' : ''}" data-i="${i}">
          <button data-l="act" class="lname">${esc(L.name)}${i === P.al ? ' · activa' : ''}<small>${L.objs.length} elementos</small></button>
          <button class="ib" data-l="vis" title="Mostrar/ocultar">${icon(L.vis ? 'eye' : 'eyeoff')}</button>
          <button class="ib" data-l="ren" title="Renombrar">${icon('pen2')}</button>
          <button class="ib" data-l="del" title="Eliminar">${icon('trash')}</button></div>`).reverse().join('') +
        (P.layers.length < 5 ? `<button class="btn sm" data-l="add" style="margin-top:8px">${icon('plus')} Añadir capa</button>` : '<p class="sub">Máximo 5 capas</p>');
    };
    el.onclick = async e => {
      const b = e.target.closest('[data-l]'); if (!b) return;
      const i = +b.closest('[data-i]')?.dataset.i;
      switch (b.dataset.l) {
        case 'act': P.al = i; break;
        case 'vis': P.layers[i].vis = !P.layers[i].vis; this.clearSel(); this.renderInk(); break;
        case 'ren': {
          closePop();
          const r = await prompt('Renombrar capa', [{ name: 'n', label: 'Nombre', value: P.layers[i].name }]);
          if (r && r.n.trim()) { P.layers[i].name = r.n.trim(); this.dirty(); }
          return;
        }
        case 'del':
          if (P.layers.length === 1) return toast('Debe quedar al menos una capa');
          this.snap(); P.layers.splice(i, 1);
          if (P.al >= P.layers.length) P.al = P.layers.length - 1;
          this.clearSel(); this.renderInk(); break;
        case 'add':
          P.layers.push({ id: uid(), name: 'Capa ' + (P.layers.length + 1), vis: true, objs: [] });
          P.al = P.layers.length - 1; break;
      }
      this.dirty(); draw();
    };
    draw();
    pop(btn, el, { side: this.side() });
  }

  tplPop(btn) {
    const el = h(`<div class="tplpop"><div class="pop-t">Plantilla de página</div><div class="tpls"></div>
      <label class="row sub" style="margin-top:12px;gap:8px"><input type="checkbox" class="all"> Aplicar a todas las páginas del cuaderno</label></div>`);
    const grid = el.querySelector('.tpls');
    for (const t of TEMPLATES) {
      const b = h(`<button class="tpl ${t.id === this.page.tpl ? 'on' : ''}"><canvas width="120" height="160"></canvas><span>${t.n}</span></button>`);
      const x = b.querySelector('canvas').getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, 120, 160); x.scale(120 / W, 160 / H);
      drawTemplate(x, t.id, W, H, { thick: 7, alpha: 1.6 });
      b.onclick = async () => {
        const all = el.querySelector('.all').checked;
        closePop();
        this.page.tpl = t.id; this.nb.tpl = t.id;
        if (all) {
          for (const id of this.nb.pages) {
            if (id === this.page.id) continue;
            const p = await db.get('pages', id);
            if (p) { p.tpl = t.id; await db.put('pages', p); }
          }
        }
        await this.renderBg(); this.dirty();
      };
      grid.append(b);
    }
    pop(btn, el, { side: this.side() });
  }

  async pagesView() {
    await this.flushSave();
    const nb = this.nb;
    let pages = await Promise.all(nb.pages.map(id => db.get('pages', id)));
    let only = false;
    const el = h(`<div class="pgview"><div class="row" style="margin-bottom:12px">
      <label class="row sub" style="gap:8px"><input type="checkbox" class="only"> Solo páginas marcadas</label><div class="grow"></div>
      <button class="btn sm" data-p="add">${icon('plus')} Añadir página al final</button></div><div class="pgrid"></div></div>`);
    const grid = el.querySelector('.pgrid');
    const draw = () => {
      grid.innerHTML = pages.map((p, i) => (!only || p?.mark) ? `<div class="pth ${i === this.idx ? 'on' : ''}" data-i="${i}">
        <button class="im" data-p="go" style="${p?.thumb ? `background-image:url(${p.thumb})` : ''}">${p?.thumb ? '' : `<span class="sub">${p?.pdf ? 'Pág. ' + p.pdf : 'Vacía'}</span>`}
          ${p?.mark ? `<span class="bm">${icon('bookmark')}</span>` : ''}${p?.locked ? `<span class="lk">${icon('lock')}</span>` : ''}</button>
        <div class="row"><span>${i + 1}</span><div class="grow"></div><button class="ib" data-p="menu">${icon('more')}</button></div></div>` : '').join('');
    };
    el.querySelector('.only').onchange = e => { only = e.target.checked; draw(); };
    let closeM;
    const reload = async () => { pages = await Promise.all(nb.pages.map(id => db.get('pages', id))); draw(); };
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-p]'); if (!b) return;
      const i = +b.closest('[data-i]')?.dataset.i;
      if (b.dataset.p === 'go') { closeM(); this.loadPage(i); }
      else if (b.dataset.p === 'add') { closeM(); this.addPage(nb.pages.length); }
      else if (b.dataset.p === 'menu') {
        menu(b, [
          { icon: 'dup', label: 'Duplicar', run: async () => {
            const p = await db.get('pages', nb.pages[i]);
            const c = { ...JSON.parse(JSON.stringify(p)), id: uid() };
            await db.put('pages', c); nb.pages.splice(i + 1, 0, c.id); await db.put('notebooks', nb);
            if (i < this.idx) this.idx++;
            reload(); this.updTop();
          } },
          i > 0 && { icon: 'up', label: 'Mover antes', run: () => this.movePage(i, i - 1).then(reload) },
          i < nb.pages.length - 1 && { icon: 'down', label: 'Mover después', run: () => this.movePage(i, i + 1).then(reload) },
          { icon: 'trash', label: 'Eliminar página', danger: true, run: async () => {
            if (nb.pages.length === 1) return toast('Un cuaderno necesita al menos una página');
            if (!await confirm(`¿Eliminar la página ${i + 1}?`, 'Eliminar', 'Esta acción no se puede deshacer.')) return;
            await this.deletePage(i); reload();
          } }
        ]);
      }
    });
    draw();
    modal('Páginas · ' + nb.title, el, [{ label: 'Cerrar', value: null }], { wide: true, mount: c => { closeM = c; } });
  }

  async movePage(from, to) {
    const nb = this.nb, cur = nb.pages[this.idx];
    const [id] = nb.pages.splice(from, 1);
    nb.pages.splice(to, 0, id);
    this.idx = nb.pages.indexOf(cur);
    nb.last = this.idx;
    await db.put('notebooks', nb);
    this.updTop();
  }

  async deletePage(i) {
    const nb = this.nb, id = nb.pages[i], cur = nb.pages[this.idx];
    nb.pages.splice(i, 1);
    await db.del('pages', id);
    if (id === cur) {
      this.saveT && clearTimeout(this.saveT); this.saveT = 0;
      await db.put('notebooks', nb);
      await this.loadPage(Math.min(i, nb.pages.length - 1));
    } else {
      this.idx = nb.pages.indexOf(cur);
      nb.last = this.idx;
      await db.put('notebooks', nb);
      this.updTop();
    }
  }

  moreMenu(btn) {
    const nb = this.nb, p = this.page;
    menu(btn, [
      { icon: 'pen2', label: 'Renombrar cuaderno', run: async () => {
        const r = await prompt('Renombrar', [{ name: 't', label: 'Nombre', value: nb.title }]);
        if (r && r.t.trim()) { nb.title = r.t.trim(); await db.put('notebooks', nb); this.updTop(); }
      } },
      nb.kind !== 'daily' && { icon: 'move', label: 'Mover a carpeta', run: async () => {
        const to = await FD.pickFolder(`Mover «${nb.title}» a…`, { current: nb.parent || '' });
        if (to !== null && await FD.moveTo(nb, to)) toast('Movido');
      } },
      { icon: 'tag', label: 'Etiquetas', run: async () => {
        const r = await prompt('Etiquetas', [{ name: 't', label: 'Separadas por comas', value: (nb.tags || []).join(', ') }]);
        if (r) { nb.tags = r.t.split(',').map(s => s.trim()).filter(Boolean); await db.put('notebooks', nb); toast('Etiquetas guardadas'); }
      } },
      { icon: p.locked ? 'unlock' : 'lock', label: p.locked ? 'Desbloquear página' : 'Bloquear página', run: () => { p.locked = !p.locked; this.clearSel(); this.updTop(); this.dirty(); } },
      { icon: 'bookmark', label: p.mark ? 'Quitar marcador' : 'Marcar página', run: () => { p.mark = !p.mark; this.updTop(); this.dirty(); } },
      { icon: 'picking', label: 'Enviar página a Recortes', run: async () => {
        const c = await pageCanvas(p, nb, 1);
        await store.newPicking({ src: c.toDataURL('image/jpeg', 0.9), w: c.width, h: c.height }, nb.title + ' · pág. ' + (this.idx + 1));
        toast('Página guardada en Recortes');
      } },
      { icon: 'download', label: 'Exportar página (PNG)', run: async () => {
        await this.flushSave();
        download(await pagePNG(p, nb), `${safeName(nb.title)}-p${this.idx + 1}.png`);
      } },
      { icon: 'download', label: 'Exportar cuaderno (PDF)', run: () => this.exportPdf(false) },
      { icon: 'share', label: 'Compartir PDF (correo, Drive…)', run: () => this.exportPdf(true) },
      { icon: 'trash', label: 'Eliminar esta página', danger: true, run: async () => {
        if (nb.pages.length === 1) return toast('Un cuaderno necesita al menos una página');
        if (await confirm(`¿Eliminar la página ${this.idx + 1}?`, 'Eliminar', 'Esta acción no se puede deshacer.')) this.deletePage(this.idx);
      } }
    ], { side: 'below' });
  }

  async exportPdf(share) {
    await this.flushSave();
    const t = toast('Preparando PDF…', 60000);
    try {
      const pages = (await Promise.all(this.nb.pages.map(id => db.get('pages', id)))).filter(Boolean);
      const blob = await notebookPDF(this.nb, pages, (i, n) => { t.textContent = `Preparando PDF… ${i}/${n}`; });
      const name = safeName(this.nb.title) + '.pdf';
      share ? await shareOrDownload(blob, name, this.nb.title) : download(blob, name);
    } catch (e) { toast('No se pudo crear el PDF (¿sin conexión la primera vez?)'); console.error(e); }
    finally { t.remove(); }
  }

  // ---------------- reuniones: grabación de voz ----------------
  setupExtra() {
    const ex = this.q('.extra');
    ex.innerHTML = `<button class="btn sm ghost" data-a="marks" title="Índice y destacados">${icon('listN')} Índice</button>
      <button class="btn sm rec" data-a="rec" title="Grabar audio mientras escribes">${icon('rec')} Grabar</button><span class="rt sub"></span>
      <button class="btn sm ghost" data-a="recs" title="Grabaciones">${icon('headphones')} <span class="rc">${(this.nb.recs || []).length}</span></button>`;
  }

  async toggleRec(btn) {
    if (this.mr) { this.mr.stop(); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { return toast('No se pudo usar el micrófono. Revisa el permiso del navegador.'); }
    const chunks = [], mr = new MediaRecorder(stream), t0 = Date.now(), nb = this.nb, page = this.idx, id = uid();
    this.mr = mr; this.recId = id; this.recT0 = t0;
    mr.ondataavailable = e => e.data.size && chunks.push(e.data);
    mr.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      clearInterval(this.recT); this.mr = null;
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
      this.recId = null;
      await db.put('blobs', { id, kind: 'audio', nb: nb.id, data: blob, created: t0, dur: Date.now() - t0, page });
      (nb.recs = nb.recs || []).push(id);
      await db.put('notebooks', nb);
      if (this.el.isConnected) {
        btn.innerHTML = `${icon('rec')} Grabar`; btn.classList.remove('pri');
        this.q('.rt').textContent = ''; this.q('.rc').textContent = nb.recs.length;
      }
      toast('Grabación guardada');
    };
    mr.start(1000);
    btn.innerHTML = `${icon('stop')} Parar`; btn.classList.add('pri');
    this.recT = setInterval(() => { this.q('.rt').textContent = '● ' + fmtDur(Date.now() - t0); }, 500);
  }

  async playAt(recId, ms) {
    const r = await db.get('blobs', recId);
    if (!r) return toast('La grabación ya no está disponible');
    const au = h('<audio controls style="width:100%"></audio>');
    au.src = URL.createObjectURL(r.data);
    au.addEventListener('loadedmetadata', () => { au.currentTime = Math.max(0, ms / 1000 - 2); au.play().catch(() => {}); }, { once: true });
    modal('Lo que se decía mientras escribías', au, [{ label: 'Cerrar', value: null }]).then(() => { au.pause(); URL.revokeObjectURL(au.src); });
  }

  async marksView() {
    await this.flushSave();
    const nb = this.nb, ids = nb.pages;
    const marks = (nb.marks || []).filter(m => ids.includes(m.pid)).map(m => ({ ...m, pi: ids.indexOf(m.pid) })).sort((a, b) => a.pi - b.pi || a.box.y - b.box.y);
    const row = m => `<div class="li mk" data-pid="${m.pid}" data-mid="${m.id}"><b class="pn">p. ${m.pi + 1}</b>${m.label ? `<span class="tx">${esc(m.label)}</span>` : ''}<img src="${m.img}" alt=""><div class="grow"></div><button class="ib del" title="Quitar">${icon('trash')}</button></div>`;
    const heads = marks.filter(m => m.type === 'head'), stars = marks.filter(m => m.type === 'star');
    const el = h(`<div><h3 class="row">${icon('listN')} Índice</h3><div class="list">${heads.map(row).join('') || '<div class="li sub">Rodea un título con el lazo y pulsa «Índice».</div>'}</div>
      <h3 class="row">${icon('star')} Destacados</h3><div class="list">${stars.map(row).join('') || '<div class="li sub">Rodea algo importante con el lazo y pulsa «Destacar».</div>'}</div></div>`);
    let close;
    el.addEventListener('click', async e => {
      const r = e.target.closest('[data-mid]'); if (!r) return;
      if (e.target.closest('.del')) {
        const p = r.dataset.pid === this.page.id ? this.page : await db.get('pages', r.dataset.pid);
        p.marks = (p.marks || []).filter(m => m.id !== r.dataset.mid);
        nb.marks = (nb.marks || []).filter(m => m.id !== r.dataset.mid);
        if (p === this.page) { this.renderInk(); await this.save(); } else { await db.put('pages', p); await db.put('notebooks', nb); }
        r.remove(); return;
      }
      close(); this.loadPage(ids.indexOf(r.dataset.pid));
    });
    modal('Índice · ' + nb.title, el, [{ label: 'Cerrar', value: null }], { wide: true, mount: c => { close = c; } });
  }

  async recsPop(btn) {
    const recs = (await Promise.all((this.nb.recs || []).map(id => db.get('blobs', id)))).filter(Boolean);
    const el = h(`<div class="recs"><div class="pop-t">Grabaciones</div>${recs.length ? '' : '<p class="sub">Aún no hay grabaciones. Pulsa «Grabar».</p>'}</div>`);
    recs.forEach((r, i) => {
      const row = h(`<div class="recrow"><div class="row"><b>Grabación ${i + 1}</b><span class="sub">${fmtDate(r.created, { day: 'numeric', month: 'short' })} · ${fmtDur(r.dur)} · pág. ${r.page + 1}</span><div class="grow"></div>
        <button class="ib" data-g="go" title="Ir a la página">${icon('pages')}</button><button class="ib" data-g="del" title="Eliminar">${icon('trash')}</button></div><audio controls preload="none"></audio></div>`);
      row.querySelector('audio').src = URL.createObjectURL(r.data);
      row.querySelector('[data-g=go]').onclick = () => { closePop(); if (r.page < this.nb.pages.length) this.loadPage(r.page); };
      row.querySelector('[data-g=del]').onclick = async () => {
        if (!await confirm('¿Eliminar esta grabación?', 'Eliminar')) return;
        await db.del('blobs', r.id);
        this.nb.recs = this.nb.recs.filter(x => x !== r.id);
        await db.put('notebooks', this.nb);
        this.q('.rc').textContent = this.nb.recs.length;
      };
      el.append(row);
    });
    pop(btn, el, { side: 'below' });
  }
}
