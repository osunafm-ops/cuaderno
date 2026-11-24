// Listas de tareas con casillas (objeto t:'c'): {x, y, w, h, size, title, c, items:[{text, done}]}
// Una fila sin texto deja sitio para escribir a mano al lado de la casilla.
import { h, icon, esc, modal } from './ui.js';

const FONT = 'Literata, Georgia, serif';
const mctx = document.createElement('canvas').getContext('2d');

export function layout(o) {
  const s = o.size, side = s * 0.9, tx = side + s * 0.5, maxW = Math.max(60, o.w - tx), rows = [];
  let y = o.title ? s * 1.9 : 0;
  mctx.font = `400 ${s}px ${FONT}`;
  o.items.forEach((it, i) => {
    const lines = [];
    let cur = '';
    for (const word of String(it.text || '').split(/\s+/).filter(Boolean)) {
      const t = cur ? cur + ' ' + word : word;
      if (cur && mctx.measureText(t).width > maxW) { lines.push(cur); cur = word; } else cur = t;
    }
    if (cur) lines.push(cur);
    const rh = lines.length ? lines.length * s * 1.3 + s * 0.5 : s * 1.9;
    rows.push({ i, y, h: rh, side, tx, lines, by: y + (lines.length ? s * 0.2 : rh - side - s * 0.2) });
    y += rh;
  });
  return { rows, h: Math.max(y, s) };
}

export function draw(ctx, o) {
  const s = o.size, L = layout(o), c = o.c || '#141414';
  ctx.save();
  ctx.textBaseline = 'alphabetic'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (o.title) { ctx.fillStyle = c; ctx.font = `700 ${s * 1.15}px ${FONT}`; ctx.fillText(o.title, o.x, o.y + s * 1.15, o.w); }
  for (const r of L.rows) {
    const it = o.items[r.i], x = o.x, y = o.y + r.by;
    ctx.strokeStyle = c; ctx.lineWidth = Math.max(1.5, s * 0.07);
    ctx.strokeRect(x, y, r.side, r.side);
    if (it.done) {
      ctx.lineWidth = Math.max(2, s * 0.11);
      ctx.beginPath(); ctx.moveTo(x + r.side * 0.2, y + r.side * 0.52); ctx.lineTo(x + r.side * 0.42, y + r.side * 0.76); ctx.lineTo(x + r.side * 0.84, y + r.side * 0.2); ctx.stroke();
    }
    ctx.font = `400 ${s}px ${FONT}`; ctx.fillStyle = it.done ? '#8a8a8a' : c;
    r.lines.forEach((t, k) => {
      const bx = x + r.tx, by = o.y + r.y + s * (0.98 + k * 1.3);
      ctx.fillText(t, bx, by);
      if (it.done) { ctx.strokeStyle = '#8a8a8a'; ctx.lineWidth = Math.max(1.2, s * 0.05); ctx.beginPath(); ctx.moveTo(bx, by - s * 0.3); ctx.lineTo(bx + ctx.measureText(t).width, by - s * 0.3); ctx.stroke(); }
    });
    if (!r.lines.length) { ctx.strokeStyle = 'rgba(20,20,20,.22)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + r.tx, y + r.side); ctx.lineTo(x + o.w, y + r.side); ctx.stroke(); }
  }
  ctx.restore();
}

// ¿Qué casilla hay en el punto p? (con un poco de margen). -1 = ninguna.
export function boxAt(o, p) {
  const m = o.size * 0.3;
  for (const r of layout(o).rows) {
    const x = o.x, y = o.y + r.by;
    if (p.x >= x - m && p.x <= x + r.side + m && p.y >= y - m && p.y <= y + r.side + m) return r.i;
  }
  return -1;
}

export const text = o => [o.title, ...o.items.map(i => i.text)].filter(Boolean).join(' ');

// Ventana para escribir la lista. Devuelve {title, items} o null.
export async function edit(o) {
  const el = h(`<div class="ckedit"><label class="field"><span>Título (opcional)</span><input class="ckt" value="${esc(o?.title || '')}"></label>
    <div class="ckrows"></div>
    <div class="row" style="margin-top:10px;flex-wrap:wrap;gap:8px"><button type="button" class="btn sm" data-k="add">${icon('plus')} Añadir</button><button type="button" class="btn sm ghost" data-k="blank">${icon('pen')} 5 casillas para escribir a mano</button></div></div>`);
  const box = el.querySelector('.ckrows');
  const row = (it = { text: '', done: false }, after) => {
    const r = h(`<div class="ckrow"><button type="button" class="chk" data-k="chk"></button><input value="${esc(it.text || '')}" placeholder="Vacía: para escribir a mano"><button type="button" class="ib" data-k="up" title="Subir">${icon('up')}</button><button type="button" class="ib" data-k="del" title="Quitar">${icon('x')}</button></div>`);
    r.done = !!it.done;
    r.querySelector('.chk').innerHTML = r.done ? icon('check') : '';
    after ? after.after(r) : box.append(r);
    return r;
  };
  (o?.items?.length ? o.items : [{}, {}, {}]).forEach(it => row(it));
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    const r = b.closest('.ckrow');
    if (b.dataset.k === 'add') row().querySelector('input').focus();
    else if (b.dataset.k === 'blank') for (let i = 0; i < 5; i++) row();
    else if (b.dataset.k === 'del') r.remove();
    else if (b.dataset.k === 'up') r.previousElementSibling?.before(r);
    else if (b.dataset.k === 'chk') { r.done = !r.done; b.innerHTML = r.done ? icon('check') : ''; }
  });
  el.addEventListener('keydown', e => {
    const r = e.target.closest('.ckrow');
    if (e.key === 'Enter' && r) { e.preventDefault(); e.stopPropagation(); row({}, r).querySelector('input').focus(); }
  });
  el.addEventListener('paste', e => {
    const r = e.target.closest('.ckrow'), ls = (e.clipboardData?.getData('text') || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!r || ls.length < 2) return;
    e.preventDefault();
    r.querySelector('input').value += ls.shift();
    let a = r; for (const t of ls) a = row({ text: t }, a);
  });
  const v = await modal(o ? 'Editar lista' : 'Nueva lista de tareas', el, [{ label: 'Cancelar', value: null }, {
    label: o ? 'Guardar' : 'Insertar', pri: true,
    value: () => ({ title: el.querySelector('.ckt').value.trim(), items: [...box.querySelectorAll('.ckrow')].map(r => ({ text: r.querySelector('input').value.trim(), done: r.done })) })
  }], { wide: true });
  return v && v.items.length ? v : null;
}
