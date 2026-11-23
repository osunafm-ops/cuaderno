// Texto con formato: párrafos con trozos (runs) de estilo propio, dibujados en el lienzo.
// Estilo de un trozo: b negrita, i cursiva, u subrayado, st tachado, sz tamaño, c color, hl resaltado, f letra.
export const FAM = {
  serif: 'Literata, Georgia, serif',
  sans: 'Inter, system-ui, sans-serif',
  mono: 'ui-monospace, Consolas, "Courier New", monospace',
  mano: 'Caveat, "Comic Sans MS", cursive'
};
export const FAM_NAMES = { serif: 'Libro', sans: 'Moderna', mono: 'Máquina', mano: 'A mano' };

const mctx = document.createElement('canvas').getContext('2d');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function fromPlain(text) {
  return String(text || '').split('\n').map(l => ({ runs: l ? [{ t: l }] : [], align: 'left', list: null }));
}
export function plain(o) { normalize(o); return o.paras.map(p => p.runs.map(r => r.t).join('')).join('\n'); }

// Textos antiguos (solo texto plano) → párrafos.
export function normalize(o) {
  if (!o.paras) o.paras = fromPlain(o.text || '');
  return o;
}

const fontOf = (r, o) => `${r.i ? 'italic ' : ''}${r.b ? 700 : 400} ${r.sz || o.size}px ${FAM[r.f || o.f || 'serif']}`;

export function layout(o) {
  normalize(o);
  const maxW = o.w || Infinity, lines = [];
  let y = 0, num = 0, widest = 0;
  for (const p of o.paras) {
    num = p.list === 'number' ? num + 1 : 0;
    const indent = p.list ? o.size * 1.4 : 0, avail = maxW - indent, align = p.align || 'left';
    const toks = [];
    for (const r of p.runs) for (const t of (r.t.match(/\s+|[^\s]+/g) || [])) toks.push({ t, r });
    let line = { segs: [], w: 0, h: 0, indent, align, bullet: p.list ? (p.list === 'bullet' ? '•' : num + '.') : null };
    const push = () => {
      const m = Math.max(line.h, line.segs.length ? 0 : o.size, o.size * 0.6);
      line.y = y; line.lh = m * 1.3; line.base = y + m * 1.05;
      y += line.lh; lines.push(line); widest = Math.max(widest, line.w + indent);
    };
    for (const tk of toks) {
      mctx.font = fontOf(tk.r, o);
      const w = mctx.measureText(tk.t).width, sp = /^\s+$/.test(tk.t);
      if (line.segs.length && !sp && line.w + w > avail) {
        // quitar el espacio final de la línea antes de saltar
        const last = line.segs[line.segs.length - 1];
        if (last && /^\s+$/.test(last.t)) { line.w -= last.w; line.segs.pop(); }
        push();
        line = { segs: [], w: 0, h: 0, indent, align, bullet: null, cont: true };
      }
      if (sp && !line.segs.length && line.cont) continue;
      line.segs.push({ x: line.w, t: tk.t, r: tk.r, w });
      line.w += w; line.h = Math.max(line.h, tk.r.sz || o.size);
    }
    push();
  }
  return { lines, w: Math.max(o.w || widest, 10), h: Math.max(y, o.size * 1.3) };
}

export function box(o) { const L = layout(o); return { x: o.x, y: o.y, w: L.w, h: L.h }; }

export function draw(ctx, o) {
  const L = layout(o);
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  for (const ln of L.lines) {
    const avail = L.w - ln.indent;
    const off = ln.align === 'center' ? (avail - ln.w) / 2 : ln.align === 'right' ? avail - ln.w : 0;
    const by = o.y + ln.base;
    if (ln.bullet) {
      ctx.font = `400 ${o.size}px ${FAM[o.f || 'serif']}`;
      ctx.fillStyle = o.c || '#141414';
      ctx.fillText(ln.bullet, o.x + o.size * 0.2, by);
    }
    for (const s of ln.segs) {
      const r = s.r, sz = r.sz || o.size, x = o.x + ln.indent + off + s.x;
      if (r.hl) { ctx.fillStyle = r.hl; ctx.globalAlpha = 0.55; ctx.fillRect(x, by - sz * 0.95, s.w, sz * 1.25); ctx.globalAlpha = 1; }
      ctx.font = fontOf(r, o);
      ctx.fillStyle = r.c || o.c || '#141414';
      ctx.fillText(s.t, x, by);
      if (r.u || r.st) {
        ctx.fillRect(x, r.u ? by + sz * 0.12 : by - sz * 0.3, s.w, Math.max(1, sz / 15));
      }
    }
  }
  ctx.restore();
}

export function scale(o, k) {
  normalize(o);
  o.size *= k; if (o.w) o.w *= k;
  for (const p of o.paras) for (const r of p.runs) if (r.sz) r.sz *= k;
}

// ---------- edición (contenteditable) ----------
export function toHTML(o) {
  normalize(o);
  const run = r => {
    const st = [];
    if (r.b) st.push('font-weight:700');
    if (r.i) st.push('font-style:italic');
    if (r.u || r.st) st.push(`text-decoration:${r.u ? 'underline ' : ''}${r.st ? 'line-through' : ''}`);
    if (r.sz) st.push(`font-size:${Math.round(r.sz * 10) / 10}px`);
    if (r.c) st.push(`color:${r.c}`);
    if (r.hl) st.push(`background-color:${r.hl}`);
    if (r.f) st.push(`font-family:${FAM[r.f].replace(/"/g, "'")}`);
    return st.length ? `<span style="${st.join(';')}">${esc(r.t)}</span>` : esc(r.t);
  };
  let html = '', open = null;
  for (const p of o.paras) {
    const inner = p.runs.map(run).join('') || '<br>';
    const al = p.align && p.align !== 'left' ? ` style="text-align:${p.align}"` : '';
    if (p.list) {
      const tag = p.list === 'number' ? 'ol' : 'ul';
      if (open !== tag) { if (open) html += `</${open}>`; html += `<${tag}>`; open = tag; }
      html += `<li${al}>${inner}</li>`;
    } else {
      if (open) { html += `</${open}>`; open = null; }
      html += `<div${al}>${inner}</div>`;
    }
  }
  if (open) html += `</${open}>`;
  return html || '<div><br></div>';
}

const hex = c => {
  const m = String(c).match(/rgba?\(([^)]+)\)/);
  if (!m) return c;
  const [r, g, b, a] = m[1].split(',').map(s => parseFloat(s));
  if (a === 0) return null;
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
};
const famKey = f => /caveat|cursive/i.test(f) ? 'mano' : /mono|consol|courier/i.test(f) ? 'mono' : /inter|sans|system/i.test(f) ? 'sans' : 'serif';

export function fromDOM(root) {
  const paras = [];
  let cur = null;
  const newPara = (align, list) => { cur = { runs: [], align: align || 'left', list: list || null }; paras.push(cur); };
  const walk = (node, st, blk) => {
    if (node.nodeType === 3) {
      const t = node.nodeValue.replace(/ /g, ' ').replace(/[\r\n]+/g, ' ');
      if (!t) return;
      if (!cur) newPara(blk.align, blk.list);
      const last = cur.runs[cur.runs.length - 1], s = { ...st, t };
      if (last && JSON.stringify({ ...last, t: '' }) === JSON.stringify({ ...s, t: '' })) last.t += t; else cur.runs.push(s);
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName, cs = node.style, s = { ...st }, b = { ...blk };
    if (tag === 'B' || tag === 'STRONG') s.b = 1;
    if (tag === 'I' || tag === 'EM') s.i = 1;
    if (tag === 'U') s.u = 1;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') s.st = 1;
    if (tag === 'FONT') { if (node.color) s.c = node.color; if (node.face) s.f = famKey(node.face); }
    if (cs) {
      if (cs.fontWeight) { if (cs.fontWeight === 'bold' || +cs.fontWeight >= 600) s.b = 1; else delete s.b; }
      if (cs.fontStyle) { if (cs.fontStyle === 'italic') s.i = 1; else delete s.i; }
      const td = cs.textDecorationLine || cs.textDecoration;
      if (td) { if (td.includes('underline')) s.u = 1; if (td.includes('line-through')) s.st = 1; if (td === 'none') { delete s.u; delete s.st; } }
      if (cs.color) { const c = hex(cs.color); if (c) s.c = c; }
      if (cs.backgroundColor) { const c = hex(cs.backgroundColor); if (c && c !== 'transparent') s.hl = c; else delete s.hl; }
      if (cs.fontSize && cs.fontSize.endsWith('px')) s.sz = parseFloat(cs.fontSize);
      if (cs.fontFamily) s.f = famKey(cs.fontFamily);
      if (cs.textAlign) b.align = cs.textAlign === 'start' ? 'left' : cs.textAlign;
    }
    if (node.getAttribute && node.getAttribute('align')) b.align = node.getAttribute('align');
    if (tag === 'UL') b.list = 'bullet';
    if (tag === 'OL') b.list = 'number';
    if (tag === 'BR') {
      const rest = [...node.parentNode.childNodes].slice([...node.parentNode.childNodes].indexOf(node) + 1).some(n => n.textContent.length || n.nodeName === 'BR');
      if (rest) newPara(b.align, b.list);
      else if (!cur) newPara(b.align, b.list);
      return;
    }
    const block = /^(DIV|P|LI|H[1-6]|BLOCKQUOTE|UL|OL)$/.test(tag);
    if (!block) { for (const ch of node.childNodes) walk(ch, s, b); return; }
    if (tag !== 'LI' && tag !== 'UL' && tag !== 'OL') b.list = blk.list && tag === 'DIV' && node.parentNode?.tagName === 'LI' ? blk.list : null;
    // Un bloque empieza párrafo nuevo; si queda vacío, es una línea en blanco.
    const before = paras.length;
    cur = null;
    for (const ch of node.childNodes) walk(ch, s, b);
    if (paras.length === before && tag !== 'UL' && tag !== 'OL') newPara(b.align, b.list);
    cur = null;
  };
  for (const ch of root.childNodes) walk(ch, {}, { align: 'left', list: null });
  // quitar párrafos vacíos al final
  while (paras.length > 1 && !paras[paras.length - 1].runs.length) paras.pop();
  return paras;
}
