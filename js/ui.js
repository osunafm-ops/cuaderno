import { ICONS } from './icons.js';
import { settings } from './settings.js';

export const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[n] || ''}"/></svg>`;

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(msg, ms = 2400) {
  const el = h(`<div class="toast">${esc(msg)}</div>`);
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
  return el;
}

// Ventana modal. buttons: [{label, value, pri}] — value puede ser función(cuerpo) -> resultado.
export function modal(title, body, buttons = [{ label: 'Cerrar', value: null }], { wide = false, mount } = {}) {
  return new Promise(res => {
    const bg = h(`<div class="modal-bg"><div class="modal ${wide ? 'wide' : ''}"><div class="mh"><h3>${esc(title)}</h3></div><div class="mb"></div><div class="row mf"></div></div></div>`);
    const mb = bg.querySelector('.mb');
    if (typeof body === 'string') mb.innerHTML = body; else if (body) mb.append(body);
    let done = false;
    const close = v => { if (done) return; done = true; bg.remove(); res(v); };
    for (const b of buttons) {
      const btn = h(`<button class="btn ${b.pri ? 'pri' : ''}">${esc(b.label)}</button>`);
      btn.onclick = () => {
        const v = typeof b.value === 'function' ? b.value(mb) : b.value;
        if (v === undefined) return; // validación fallida: no cerrar
        close(v);
      };
      bg.querySelector('.mf').append(btn);
    }
    bg.addEventListener('pointerdown', e => { if (e.target === bg) close(null); });
    bg.addEventListener('keydown', e => {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        const pri = bg.querySelector('.mf .btn.pri');
        if (pri) { e.preventDefault(); pri.click(); }
      }
    });
    document.body.append(bg);
    if (mount) mount(close, mb);
    const f = mb.querySelector('input:not([type=checkbox]),textarea');
    if (f) setTimeout(() => f.focus(), 60);
  });
}

// fields: [{name,label,type,value,options:[{value,label}],list:[...]}]
export function prompt(title, fields, ok = 'Aceptar') {
  const form = h('<div></div>');
  for (const f of fields) {
    let input;
    if (f.type === 'select') {
      input = `<select name="${f.name}">${f.options.map(o => `<option value="${esc(o.value)}" ${o.value == f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea name="${f.name}" rows="3">${esc(f.value)}</textarea>`;
    } else {
      const dl = f.list ? `<datalist id="dl-${f.name}">${f.list.map(x => `<option value="${esc(x)}">`).join('')}</datalist>` : '';
      input = `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.list ? `list="dl-${f.name}"` : ''} placeholder="${esc(f.ph || '')}">${dl}`;
    }
    form.append(h(`<label class="field"><span>${esc(f.label)}</span>${input}</label>`));
  }
  return modal(title, form, [
    { label: 'Cancelar', value: null },
    { label: ok, pri: true, value: mb => { const o = {}; mb.querySelectorAll('[name]').forEach(e => o[e.name] = e.value); return o; } }
  ]);
}

export const confirm = (msg, ok = 'Aceptar', detail = '') =>
  modal(msg, detail ? `<p class="sub">${esc(detail)}</p>` : '', [{ label: 'Cancelar', value: false }, { label: ok, pri: true, value: true }]);

let curPop = null;
export function closePop() { if (curPop) curPop(); }

// Ventana flotante junto a un botón.
export function pop(anchor, content, { side = 'right' } = {}) {
  closePop();
  const scrim = h('<div class="scrim"></div>');
  const p = h('<div class="pop"></div>');
  p.append(content);
  document.body.append(scrim, p);
  const r = anchor.getBoundingClientRect();
  const pw = p.offsetWidth, ph = p.offsetHeight, vw = innerWidth, vh = innerHeight;
  let x, y;
  if (side === 'right') { x = r.right + 8; y = r.top; }
  else if (side === 'left') { x = r.left - pw - 8; y = r.top; }
  else { x = r.right - pw; y = r.bottom + 6; }
  x = Math.max(8, Math.min(x, vw - pw - 8));
  y = Math.max(8, Math.min(y, vh - ph - 8));
  p.style.left = x + 'px'; p.style.top = y + 'px';
  const close = () => { scrim.remove(); p.remove(); if (curPop === close) curPop = null; };
  scrim.addEventListener('pointerdown', e => { e.preventDefault(); close(); });
  curPop = close;
  return close;
}

export function menu(anchor, items, opts = { side: 'below' }) {
  const m = h('<div class="menu"></div>');
  let close;
  for (const it of items) {
    if (!it) continue;
    const b = h(`<button class="${it.danger ? 'danger' : ''}">${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span></button>`);
    b.onclick = () => { close(); it.run(); };
    m.append(b);
  }
  close = pop(anchor, m, opts);
  return close;
}

export function pickFiles(accept, multiple = false) {
  return new Promise(res => {
    const i = h(`<input type="file" accept="${accept}" ${multiple ? 'multiple' : ''} style="display:none">`);
    i.onchange = () => { res([...i.files]); i.remove(); };
    document.body.append(i);
    i.click();
  });
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function shareOrDownload(blob, name, title) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  download(blob, name);
}

// Efecto de refresco de pantalla de tinta electrónica.
export function flash() {
  if (settings.refresh !== 'best') return;
  const f = h('<div class="flash"></div>');
  document.body.append(f);
  setTimeout(() => { f.style.background = '#fff'; }, 70);
  setTimeout(() => f.remove(), 150);
}

const scripts = new Map();
export function loadScript(src) {
  if (!scripts.has(src)) scripts.set(src, new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => { scripts.delete(src); rej(new Error('No se pudo cargar ' + src)); };
    document.head.append(s);
  }));
  return scripts.get(src);
}

export const pad = n => String(n).padStart(2, '0');
export const dkey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const fmtDate = (t, o = { day: 'numeric', month: 'short', year: 'numeric' }) => new Date(t).toLocaleDateString('es-ES', o);
export const fmtTime = t => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
export const fmtDur = ms => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
export const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
