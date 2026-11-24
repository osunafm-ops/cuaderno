// Motor de tinta: pinceles, texto, imágenes, selección y reconocimiento de formas.
import * as RT from './richtext.js';
import * as CK from './checklist.js';
export const W = 1200, H = 1600; // tamaño lógico de la página (proporción 3:4)

export const BRUSHES = [
  ['pluma', 'Pluma estilográfica'],
  ['boli', 'Bolígrafo'],
  ['fino', 'Rotulador fino'],
  ['lapiz', 'Lápiz'],
  ['cali', 'Caligrafía'],
  ['pincel', 'Pincel']
];
export const WIDTHS = [1, 1.6, 2.5, 4, 6.5];
export const FONT = 'Literata, Georgia, serif';
const SQ = Math.SQRT1_2;

function wAt(b, w, p, dx, dy) {
  switch (b) {
    case 'pluma': return w * (0.35 + 1.05 * p);
    case 'boli': return w * (0.8 + 0.4 * p);
    case 'pincel': return w * (0.15 + 2.8 * p * p);
    case 'cali': {
      const l = Math.hypot(dx, dy) || 1;
      return w * (0.3 + 2.0 * Math.abs(dx + dy) * SQ / l) * (0.6 + 0.6 * p);
    }
    default: return w;
  }
}

function smoothPath(ctx, p) {
  const n = p.length;
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  if (n === 6) ctx.lineTo(p[3], p[4]);
  else {
    for (let i = 3; i < n - 3; i += 3) ctx.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 3]) / 2, (p[i + 1] + p[i + 4]) / 2);
    ctx.lineTo(p[n - 3], p[n - 2]);
  }
}

export function drawStroke(ctx, s) {
  const p = s.pts, n = p.length / 3;
  if (!n) return;
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = s.c || '#141414';
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const hl = s.b === 'marca';
  if (hl) { ctx.globalAlpha = 0.38; ctx.lineCap = 'butt'; }
  if (s.b === 'lapiz') ctx.globalAlpha = 0.8;
  if (n === 1) {
    const r = (hl ? s.w * 3 : wAt(s.b, s.w, p[2], 1, 0)) / 2;
    ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(r, 0.6), 0, Math.PI * 2); ctx.fill();
    ctx.restore(); return;
  }
  if (hl || s.b === 'fino' || s.b === 'lapiz') {
    let avg = 0.5;
    if (s.b === 'lapiz') { avg = 0; for (let i = 2; i < p.length; i += 3) avg += p[i]; avg /= n; }
    ctx.lineWidth = hl ? s.w * 3 : s.b === 'lapiz' ? s.w * (0.55 + 0.7 * avg) : s.w;
    smoothPath(ctx, p);
    ctx.stroke();
  } else {
    let px = p[0], py = p[1], lmx = p[0], lmy = p[1];
    for (let i = 3; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1];
      const mx = (px + x) / 2, my = (py + y) / 2;
      ctx.lineWidth = Math.max(0.4, wAt(s.b, s.w, (p[i - 1] + p[i + 2]) / 2, x - px, y - py));
      ctx.beginPath(); ctx.moveTo(lmx, lmy); ctx.quadraticCurveTo(px, py, mx, my); ctx.stroke();
      lmx = mx; lmy = my; px = x; py = y;
    }
    ctx.beginPath(); ctx.moveTo(lmx, lmy); ctx.lineTo(px, py); ctx.stroke();
  }
  ctx.restore();
}

export const textBox = o => RT.box(o);
const drawText = (ctx, o) => RT.draw(ctx, o);

const IMG = new Map();
export function loadImage(src) {
  let im = IMG.get(src);
  if (!im) { im = new Image(); im.src = src; IMG.set(src, im); }
  if (im.complete && im.naturalWidth) return Promise.resolve(im);
  return new Promise(r => {
    im.addEventListener('load', () => r(im), { once: true });
    im.addEventListener('error', () => r(null), { once: true });
  });
}

export function drawObj(ctx, o, onload) {
  if (o.t === 's') return drawStroke(ctx, o);
  if (o.t === 'x') return drawText(ctx, o);
  if (o.t === 'c') return CK.draw(ctx, o);
  if (o.t === 'i') {
    const im = IMG.get(o.src);
    if (im && im.complete && im.naturalWidth) ctx.drawImage(im, o.x, o.y, o.w, o.h);
    else loadImage(o.src).then(i => { if (i && onload) onload(); });
  }
}

export async function preload(objs) {
  await Promise.all(objs.filter(o => o.t === 'i').map(o => loadImage(o.src)));
}

// Caja de cada trazo, recordada para no recalcularla en las páginas infinitas.
const BOX = new WeakMap();
export function bbox(o) {
  if (o.t === 's') {
    const p = o.pts, hit = BOX.get(o);
    if (hit && hit.n === p.length) return { ...hit.b };
    let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] < a) a = p[i]; if (p[i] > c) c = p[i];
      if (p[i + 1] < b) b = p[i + 1]; if (p[i + 1] > d) d = p[i + 1];
    }
    const m = o.b === 'marca' ? o.w * 1.5 : o.w * 1.4;
    const box = { x: a - m, y: b - m, w: c - a + 2 * m, h: d - b + 2 * m };
    BOX.set(o, { n: p.length, b: box });
    return { ...box };
  }
  if (o.t === 'x') return textBox(o);
  return { x: o.x, y: o.y, w: o.w, h: o.h };
}

export function unionBox(objs) {
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  for (const o of objs) {
    const r = bbox(o);
    a = Math.min(a, r.x); b = Math.min(b, r.y); c = Math.max(c, r.x + r.w); d = Math.max(d, r.y + r.h);
  }
  return { x: a, y: b, w: c - a, h: d - b };
}

export function translate(o, dx, dy) {
  BOX.delete(o);
  if (o.t === 's') { const p = o.pts; for (let i = 0; i < p.length; i += 3) { p[i] += dx; p[i + 1] += dy; } }
  else { o.x += dx; o.y += dy; }
}

export function scale(o, ox, oy, k) {
  BOX.delete(o);
  if (o.t === 's') {
    const p = o.pts;
    for (let i = 0; i < p.length; i += 3) { p[i] = ox + (p[i] - ox) * k; p[i + 1] = oy + (p[i + 1] - oy) * k; }
    o.w *= k;
  } else {
    o.x = ox + (o.x - ox) * k; o.y = oy + (o.y - oy) * k;
    if (o.t === 'x') RT.scale(o, k); else { o.w *= k; o.h *= k; if (o.t === 'c') { o.size *= k; o.h = CK.layout(o).h; } }
  }
}

export function restore(o, src) {
  BOX.delete(o);
  for (const k in src) { const v = src[k]; o[k] = k === 'paras' || k === 'items' ? JSON.parse(JSON.stringify(v)) : Array.isArray(v) ? v.slice() : v; }
}

export const clone = o => JSON.parse(JSON.stringify(o));

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

export function hitStroke(o, x, y, r) {
  const bb = bbox(o);
  if (x < bb.x - r || x > bb.x + bb.w + r || y < bb.y - r || y > bb.y + bb.h + r) return false;
  const p = o.pts, rr = r + (o.b === 'marca' ? o.w * 1.5 : o.w / 2);
  if (p.length === 3) return Math.hypot(p[0] - x, p[1] - y) <= rr;
  for (let i = 3; i < p.length; i += 3) if (segDist(x, y, p[i - 3], p[i - 2], p[i], p[i + 1]) <= rr) return true;
  return false;
}

export function inPoly(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export function objInPoly(o, poly) {
  if (o.t === 's') {
    let k = 0, n = 0;
    for (let i = 0; i < o.pts.length; i += 3) { n++; if (inPoly(o.pts[i], o.pts[i + 1], poly)) k++; }
    return n && k / n >= 0.5;
  }
  const b = bbox(o);
  return inPoly(b.x + b.w / 2, b.y + b.h / 2, poly);
}

// ---------- Reconocimiento de formas (mantener el lápiz quieto al terminar) ----------
function dens(P, closed) {
  const Q = closed ? [...P, P[0]] : P, out = [];
  for (let i = 0; i < Q.length - 1; i++) {
    const [ax, ay] = Q[i], [bx, by] = Q[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 6));
    for (let k = 0; k < n; k++) out.push(ax + (bx - ax) * k / n, ay + (by - ay) * k / n, 0.6);
  }
  const L = Q[Q.length - 1];
  out.push(L[0], L[1], 0.6);
  return out;
}

function rdp(P, eps) {
  if (P.length < 3) return P;
  let dm = 0, id = 0;
  const a = P[0], b = P[P.length - 1];
  for (let i = 1; i < P.length - 1; i++) {
    const d = segDist(P[i][0], P[i][1], a[0], a[1], b[0], b[1]);
    if (d > dm) { dm = d; id = i; }
  }
  if (dm > eps) return rdp(P.slice(0, id + 1), eps).slice(0, -1).concat(rdp(P.slice(id), eps));
  return [a, b];
}

function dropFlat(v, closed) {
  let changed = true;
  while (changed && v.length > 3) {
    changed = false;
    for (let i = closed ? 0 : 1; i < (closed ? v.length : v.length - 1); i++) {
      const a = v[(i - 1 + v.length) % v.length], b = v[i], c = v[(i + 1) % v.length];
      const a1 = Math.atan2(b[1] - a[1], b[0] - a[0]), a2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
      let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d;
      if (d < 0.45) { v.splice(i, 1); changed = true; break; }
    }
  }
  return v;
}

const axisAligned = (a, b) => { const d = Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI) % 90; return d < 12 || d > 78; };

export function recognize(flat) {
  const P = [];
  for (let i = 0; i < flat.length; i += 3) P.push([flat[i], flat[i + 1]]);
  if (P.length < 4) return null;
  let len = 0;
  for (let i = 1; i < P.length; i++) len += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  if (len < 30) return null;
  const a = P[0], b = P[P.length - 1], chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const size = Math.max(x1 - x0, y1 - y0);

  if (chord > 0.9 * len) { // línea recta
    let [bx, by] = b;
    if (axisAligned(a, b)) { if (Math.abs(bx - a[0]) > Math.abs(by - a[1])) by = a[1]; else bx = a[0]; }
    return dens([a, [bx, by]]);
  }
  if (chord < 0.22 * len) { // figura cerrada
    let v = dropFlat(rdp(P, size * 0.09).slice(0, -1), true);
    if (v.length === 3) return dens(v, true);
    if (v.length === 4) {
      if (v.every((p, i) => axisAligned(p, v[(i + 1) % 4]))) v = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      return dens(v, true);
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2, E = [];
    for (let k = 0; k < 72; k++) { const t = k / 72 * Math.PI * 2; E.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); }
    return dens(E, true);
  }
  const s = dropFlat(rdp(P, size * 0.07), false); // polilínea / flecha
  return s.length <= 5 ? dens(s) : null;
}
