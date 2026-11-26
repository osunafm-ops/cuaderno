// Tablas tipo hoja de cálculo (objeto t:'t'): {id, x, y, w, h, size, c, head, cells:[[texto]], cw:[ancho relativo]}
// Admite fórmulas sencillas: =A1+B2*2, =SUMA(A1:A5), =PROMEDIO(…), =MIN(…), =MAX(…), =CONTAR(…)
import { h, icon, esc, modal, toast } from './ui.js';

const FONT = 'Inter, system-ui, sans-serif';
const mctx = document.createElement('canvas').getContext('2d');
export const colName = i => { let s = ''; i++; while (i) { s = String.fromCharCode(65 + (i - 1) % 26) + s; i = Math.floor((i - 1) / 26); } return s; };

// ---------- fórmulas ----------
const ref = s => { const m = /^([A-Z]+)(\d+)$/.exec(s); if (!m) return null; let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64; return [+m[2] - 1, c - 1]; };
const num = v => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; };

export function value(o, r, c, seen = new Set()) {
  const raw = String(o.cells[r]?.[c] ?? '');
  if (!raw.startsWith('=')) return raw;
  const key = r + ',' + c;
  if (seen.has(key)) return '#CICLO';
  seen.add(key);
  try {
    const v = calc(raw.slice(1).toUpperCase(), o, seen);
    seen.delete(key);
    return Number.isFinite(v) ? +v.toFixed(6) : '#ERROR';
  } catch (e) { return '#ERROR'; }
}

function calc(src, o, seen) {
  const toks = src.match(/[A-Z]+\d+:[A-Z]+\d+|[A-Z]+\d+|[A-ZÁÉÍÓÚ]+(?=\()|\d+(?:[.,]\d+)?|[-+*/();]/g) || [];
  if (toks.join('') !== src.replace(/\s+/g, '')) throw new Error('fórmula');
  let i = 0;
  const cellNum = s => { const p = ref(s); if (!p) throw new Error('ref'); return num(value(o, p[0], p[1], seen)); };
  const range = s => {
    const [a, b] = s.split(':').map(ref), out = [];
    for (let r = Math.min(a[0], b[0]); r <= Math.max(a[0], b[0]); r++) for (let c = Math.min(a[1], b[1]); c <= Math.max(a[1], b[1]); c++) {
      const v = value(o, r, c, seen); if (String(v).trim() !== '') out.push(num(v));
    }
    return out;
  };
  const FN = { SUMA: a => a.reduce((x, y) => x + y, 0), SUM: a => a.reduce((x, y) => x + y, 0), PROMEDIO: a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0, MIN: a => a.length ? Math.min(...a) : 0, MAX: a => a.length ? Math.max(...a) : 0, CONTAR: a => a.length };
  const expr = () => { let v = term(); while (toks[i] === '+' || toks[i] === '-') v = toks[i++] === '+' ? v + term() : v - term(); return v; };
  const term = () => { let v = fac(); while (toks[i] === '*' || toks[i] === '/') v = toks[i++] === '*' ? v * fac() : v / fac(); return v; };
  const fac = () => {
    const t = toks[i++];
    if (t === '-') return -fac();
    if (t === '(') { const v = expr(); i++; return v; }
    if (FN[t]) {
      i++; const vals = [];
      while (toks[i] !== ')' && i < toks.length) { if (toks[i]?.includes(':')) vals.push(...range(toks[i++])); else vals.push(expr()); if (toks[i] === ';') i++; }
      i++; return FN[t](vals);
    }
    if (/^\d/.test(t)) return num(t);
    if (/^[A-Z]+\d+$/.test(t)) return cellNum(t);
    throw new Error('fórmula');
  };
  const v = expr();
  if (i !== toks.length) throw new Error('fórmula');
  return v;
}
const show = v => typeof v === 'number' ? v.toLocaleString('es-ES', { maximumFractionDigits: 2 }) : v;

// ---------- dibujo ----------
export function layout(o) {
  const cols = o.cells[0]?.length || 1, tot = (o.cw || []).slice(0, cols).reduce((a, b) => a + b, 0) || cols;
  const xs = [0];
  for (let c = 0; c < cols; c++) xs.push(xs[c] + o.w * ((o.cw?.[c] || 1) / tot));
  const rh = o.size * 1.7;
  return { xs, rh, h: o.cells.length * rh };
}

export function draw(ctx, o) {
  const L = layout(o), s = o.size, c = o.c || '#141414';
  ctx.save();
  if (o.head) { ctx.fillStyle = 'rgba(20,20,20,.08)'; ctx.fillRect(o.x, o.y, o.w, L.rh); }
  ctx.strokeStyle = c; ctx.lineWidth = Math.max(1.2, s * 0.05);
  ctx.strokeRect(o.x, o.y, o.w, L.h);
  ctx.beginPath();
  for (let r = 1; r < o.cells.length; r++) { ctx.moveTo(o.x, o.y + r * L.rh); ctx.lineTo(o.x + o.w, o.y + r * L.rh); }
  for (let k = 1; k < L.xs.length - 1; k++) { ctx.moveTo(o.x + L.xs[k], o.y); ctx.lineTo(o.x + L.xs[k], o.y + L.h); }
  ctx.stroke();
  ctx.textBaseline = 'middle'; ctx.fillStyle = c;
  o.cells.forEach((row, r) => row.forEach((_, k) => {
    const v = value(o, r, k), t = show(v); if (t === '' || t == null) return;
    const bold = o.head && r === 0, cw = L.xs[k + 1] - L.xs[k] - s * 0.5;
    ctx.font = `${bold ? 700 : 400} ${s}px ${FONT}`;
    let txt = String(t);
    if (ctx.measureText(txt).width > cw) { while (txt.length > 1 && ctx.measureText(txt + '…').width > cw) txt = txt.slice(0, -1); txt += '…'; }
    const isNum = typeof v === 'number' || /^-?[\d.,]+\s*[€%]?$/.test(String(v).trim());
    ctx.textAlign = isNum && !bold ? 'right' : 'left';
    ctx.fillText(txt, isNum && !bold ? o.x + L.xs[k + 1] - s * 0.25 : o.x + L.xs[k] + s * 0.25, o.y + r * L.rh + L.rh / 2);
  }));
  ctx.restore();
}

export function cellAt(o, p) {
  const L = layout(o);
  if (p.x < o.x || p.y < o.y || p.x > o.x + o.w || p.y > o.y + L.h) return null;
  const r = Math.floor((p.y - o.y) / L.rh);
  let c = 0; while (c < L.xs.length - 2 && p.x > o.x + L.xs[c + 1]) c++;
  return [r, c];
}

export const text = o => o.cells.flat().filter(v => v && !String(v).startsWith('=')).join(' ');

export function make(rows, cols, at, size = 26) {
  const o = { t: 't', id: Math.random().toString(36).slice(2, 10), x: at.x, y: at.y, w: Math.min(1000, Math.max(300, cols * 190)), h: 0, size, c: '#141414', head: true, cells: Array.from({ length: rows }, () => Array(cols).fill('')), cw: Array(cols).fill(1) };
  o.h = layout(o).h;
  return o;
}

// ---------- editor tipo hoja de cálculo ----------
export async function edit(o, focus = [0, 0]) {
  let cells = o.cells.map(r => r.slice()), cw = (o.cw || []).slice(), head = !!o.head, cur = focus.slice();
  const el = h(`<div class="tbled"><div class="row tbtools">
      <button type="button" class="btn sm" data-k="addR">${icon('plus')} Fila</button><button type="button" class="btn sm" data-k="addC">${icon('plus')} Columna</button>
      <button type="button" class="btn sm ghost" data-k="delR">${icon('x')} Quitar fila</button><button type="button" class="btn sm ghost" data-k="delC">${icon('x')} Quitar columna</button>
      <button type="button" class="btn sm ghost" data-k="wider" title="Ensanchar la columna">↔ Más ancha</button><button type="button" class="btn sm ghost" data-k="narrow" title="Estrechar la columna">→← Más estrecha</button>
      <label class="row sub" style="gap:6px"><input type="checkbox" class="hd" ${head ? 'checked' : ''}> Primera fila en negrita</label></div>
    <div class="row sub fbar"><b class="cref"></b><input class="fx" placeholder="Contenido de la celda o fórmula, p. ej. =SUMA(B2:B6)"></div>
    <div class="tbwrap"><table class="grid"></table></div>
    <p class="sub">Toca una celda para escribir. Enter o ↓ baja, Tab pasa a la derecha. Puedes pegar celdas copiadas de Excel. Fórmulas: =A1+B1, =SUMA(B2:B9), =PROMEDIO(…), =MIN(…), =MAX(…), =CONTAR(…).</p></div>`);
  const grid = el.querySelector('.grid'), fx = el.querySelector('.fx'), cref = el.querySelector('.cref');
  const preview = () => ({ cells, cw, head, size: 1, w: 1 });
  const draw = () => {
    const cols = cells[0].length;
    grid.innerHTML = `<tr><th></th>${cells[0].map((_, c) => `<th style="min-width:${Math.round(60 + (cw[c] || 1) * 70)}px">${colName(c)}</th>`).join('')}</tr>` +
      cells.map((row, r) => `<tr><th>${r + 1}</th>${row.map((v, c) => `<td><input data-r="${r}" data-c="${c}" value="${esc(v)}" class="${head && r === 0 ? 'b' : ''}"></td>`).join('')}</tr>`).join('');
    sel(cur[0], cur[1], false);
    void cols;
  };
  const inp = (r, c) => grid.querySelector(`input[data-r="${r}"][data-c="${c}"]`);
  const sel = (r, c, focus = true) => {
    r = Math.max(0, Math.min(cells.length - 1, r)); c = Math.max(0, Math.min(cells[0].length - 1, c)); cur = [r, c];
    grid.querySelectorAll('td.on').forEach(t => t.classList.remove('on'));
    const i = inp(r, c); if (!i) return;
    i.parentElement.classList.add('on'); cref.textContent = colName(c) + (r + 1); fx.value = cells[r][c];
    if (focus) { i.focus(); i.select(); }
  };
  const showVals = () => { const pv = preview(); grid.querySelectorAll('input').forEach(i => { if (i === document.activeElement) return; const r = +i.dataset.r, c = +i.dataset.c; if (String(cells[r][c]).startsWith('=')) i.value = show(value(pv, r, c)); }); };
  grid.addEventListener('focusin', e => { const i = e.target.closest('input'); if (!i) return; const r = +i.dataset.r, c = +i.dataset.c; i.value = cells[r][c]; sel(r, c, false); showVals(); });
  grid.addEventListener('input', e => { const i = e.target; cells[+i.dataset.r][+i.dataset.c] = i.value; fx.value = i.value; });
  grid.addEventListener('focusout', () => setTimeout(showVals));
  fx.addEventListener('input', () => { cells[cur[0]][cur[1]] = fx.value; const i = inp(cur[0], cur[1]); if (i) i.value = fx.value; });
  grid.addEventListener('keydown', e => {
    const i = e.target.closest('input'); if (!i) return;
    const r = +i.dataset.r, c = +i.dataset.c, end = i.selectionStart === i.value.length, start = i.selectionStart === 0;
    const mv = (dr, dc) => { e.preventDefault(); e.stopPropagation(); if (dr > 0 && r === cells.length - 1) { cells.push(Array(cells[0].length).fill('')); draw(); } sel(r + dr, c + dc); };
    if (e.key === 'Enter' || e.key === 'ArrowDown') mv(1, 0);
    else if (e.key === 'ArrowUp') mv(-1, 0);
    else if (e.key === 'Tab') mv(0, e.shiftKey ? -1 : 1);
    else if (e.key === 'ArrowRight' && end) mv(0, 1);
    else if (e.key === 'ArrowLeft' && start) mv(0, -1);
  });
  grid.addEventListener('paste', e => {
    const t = e.clipboardData?.getData('text') || '';
    if (!/[\t\n]/.test(t.trim())) return;
    e.preventDefault();
    const rows = t.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(l => l.split('\t'));
    const [r0, c0] = cur;
    while (cells.length < r0 + rows.length) cells.push(Array(cells[0].length).fill(''));
    const need = c0 + Math.max(...rows.map(r => r.length));
    while (cells[0].length < need) { cells.forEach(r => r.push('')); cw.push(1); }
    rows.forEach((row, i) => row.forEach((v, j) => { cells[r0 + i][c0 + j] = v.trim(); }));
    draw(); toast(`Pegadas ${rows.length} filas`);
  });
  el.querySelector('.tbtools').addEventListener('click', e => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    const [r, c] = cur;
    switch (b.dataset.k) {
      case 'addR': cells.splice(r + 1, 0, Array(cells[0].length).fill('')); cur = [r + 1, c]; break;
      case 'addC': cells.forEach(row => row.splice(c + 1, 0, '')); cw.splice(c + 1, 0, 1); cur = [r, c + 1]; break;
      case 'delR': if (cells.length > 1) { cells.splice(r, 1); cur = [Math.min(r, cells.length - 1), c]; } break;
      case 'delC': if (cells[0].length > 1) { cells.forEach(row => row.splice(c, 1)); cw.splice(c, 1); cur = [r, Math.min(c, cells[0].length - 1)]; } break;
      case 'wider': cw[c] = Math.min(6, (cw[c] || 1) * 1.35); break;
      case 'narrow': cw[c] = Math.max(0.3, (cw[c] || 1) / 1.35); break;
    }
    draw(); sel(cur[0], cur[1]);
  });
  el.querySelector('.hd').onchange = e => { head = e.target.checked; draw(); };
  draw();
  setTimeout(() => sel(cur[0], cur[1]), 80);
  const ok = await modal(o.cells.some(r => r.some(Boolean)) ? 'Editar tabla' : 'Nueva tabla', el, [{ label: 'Cancelar', value: false }, { label: 'Guardar', pri: true, value: true }], { wide: true });
  if (!ok) return null;
  return { cells, cw, head };
}

// Columnas y filas al crearla.
export async function ask() {
  const el = h(`<div class="row" style="gap:16px;flex-wrap:wrap"><label class="field"><span>Filas</span><input type="number" class="r" min="1" max="60" value="5"></label>
    <label class="field"><span>Columnas</span><input type="number" class="c" min="1" max="15" value="3"></label></div>`);
  const v = await modal('Nueva tabla', el, [{ label: 'Cancelar', value: null }, { label: 'Crear', pri: true, value: () => [Math.max(1, Math.min(60, +el.querySelector('.r').value || 1)), Math.max(1, Math.min(15, +el.querySelector('.c').value || 1))] }]);
  return v;
}
