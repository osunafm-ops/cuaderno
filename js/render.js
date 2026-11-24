// Dibujo completo de páginas y exportación a PNG / PDF.
import { W, H, drawObj, preload, unionBox } from './ink.js';
import { drawTemplate, drawInfinite } from './templates.js';
import { settings, PAPER } from './settings.js';
import { pdfBitmap, fitRect } from './pdf.js';
import { loadScript } from './ui.js';

export async function drawBackground(ctx, page, nb, q = 1.5) {
  ctx.fillStyle = PAPER[settings.tone] || PAPER.eink;
  ctx.fillRect(0, 0, W, H);
  if (page.pdf && nb && nb.blob) {
    try {
      const bm = await pdfBitmap(nb.blob, page.pdf, q);
      const r = fitRect(bm.width, bm.height);
      ctx.fillStyle = PAPER[settings.tone] || PAPER.eink;
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(bm, r.x, r.y, r.w, r.h);
    } catch (e) { console.warn('PDF', e); }
  }
  drawTemplate(ctx, page.tpl, W, H);
}

export function drawObjects(ctx, page, onload) {
  for (const L of page.layers) if (L.vis) for (const o of L.objs) drawObj(ctx, o, onload);
}

// Zona que ocupa una página infinita (lo escrito con margen; como mínimo, una página normal).
export function pageArea(page) {
  if (!page.inf) return { x: 0, y: 0, w: W, h: H };
  const objs = page.layers.filter(l => l.vis).flatMap(l => l.objs);
  if (!objs.length) return { x: 0, y: 0, w: W, h: H };
  const b = unionBox(objs), m = 60;
  return { x: b.x - m, y: b.y - m, w: Math.max(W / 2, b.w + 2 * m), h: Math.max(H / 2, b.h + 2 * m) };
}

export async function pageCanvas(page, nb, scale = 1) {
  if (page.inf) {
    const a = pageArea(page), s = Math.min(scale, 4000 / Math.max(a.w, a.h)), c = document.createElement('canvas');
    c.width = Math.round(a.w * s); c.height = Math.round(a.h * s);
    const x = c.getContext('2d');
    x.fillStyle = PAPER[settings.tone] || PAPER.eink; x.fillRect(0, 0, c.width, c.height);
    x.setTransform(s, 0, 0, s, -a.x * s, -a.y * s);
    drawInfinite(x, page.tpl, a.x, a.y, a.w, a.h, s);
    await preload(page.layers.flatMap(l => l.objs));
    drawObjects(x, page);
    return c;
  }
  const c = document.createElement('canvas');
  c.width = Math.round(W * scale); c.height = Math.round(H * scale);
  const x = c.getContext('2d');
  x.scale(scale, scale);
  await drawBackground(x, page, nb, Math.max(1, scale));
  await preload(page.layers.flatMap(l => l.objs));
  drawObjects(x, page);
  return c;
}

export async function pagePNG(page, nb) {
  const c = await pageCanvas(page, nb, 1);
  return new Promise(r => c.toBlob(r, 'image/png'));
}

export async function notebookPDF(nb, pages, onProgress) {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  const { jsPDF } = window.jspdf;
  const fmt = [432, 576];
  const doc = new jsPDF({ unit: 'pt', format: fmt, compress: true });
  for (let i = 0; i < pages.length; i++) {
    const c = await pageCanvas(pages[i], nb, 1);
    const a = pageArea(pages[i]), kk = Math.min(0.36, 5000 / Math.max(a.w, a.h));
    const sz = pages[i].inf ? [a.w * kk, a.h * kk] : fmt, or = sz[0] > sz[1] ? 'landscape' : 'portrait';
    doc.addPage(sz, or);
    doc.addImage(c.toDataURL('image/jpeg', 0.88), 'JPEG', 0, 0, sz[0], sz[1]);
    if (!i) doc.deletePage(1);
    onProgress && onProgress(i + 1, pages.length);
  }
  return doc.output('blob');
}

export const safeName = s => (s || 'cuaderno').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
