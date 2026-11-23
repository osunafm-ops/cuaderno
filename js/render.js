// Dibujo completo de páginas y exportación a PNG / PDF.
import { W, H, drawObj, preload } from './ink.js';
import { drawTemplate } from './templates.js';
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

export async function pageCanvas(page, nb, scale = 1) {
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
    if (i) doc.addPage(fmt);
    const c = await pageCanvas(pages[i], nb, 1);
    doc.addImage(c.toDataURL('image/jpeg', 0.88), 'JPEG', 0, 0, fmt[0], fmt[1]);
    onProgress && onProgress(i + 1, pages.length);
  }
  return doc.output('blob');
}

export const safeName = s => (s || 'cuaderno').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
