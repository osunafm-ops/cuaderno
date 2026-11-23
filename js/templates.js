// Plantillas de página dibujadas por código.
export const TEMPLATES = [
  ['blanco', 'En blanco'], ['rayas', 'Rayas'], ['rayas_f', 'Rayas finas'], ['cuadros', 'Cuadros'],
  ['puntos', 'Puntos'], ['cornell', 'Cornell'], ['tareas', 'Tareas'], ['dia', 'Día'],
  ['semana', 'Semana'], ['reunion', 'Reunión'], ['pentagrama', 'Pentagrama'],
  ['storyboard', 'Storyboard'], ['isometrico', 'Isométrico']
].map(([id, n]) => ({ id, n }));

export function drawTemplate(ctx, id, W, H, { thick = 1, alpha = 1 } = {}) {
  if (!id || id === 'blanco') return;
  ctx.save();
  const C = `rgba(20,20,20,${0.2 * alpha})`, CS = `rgba(20,20,20,${0.12 * alpha})`, C2 = `rgba(20,20,20,${0.5 * alpha})`;
  ctx.strokeStyle = C; ctx.fillStyle = C; ctx.lineWidth = 1.5 * thick;
  const hl = (y, x0 = 60, x1 = W - 60) => { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); };
  const vl = (x, y0 = 0, y1 = H) => { ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); };
  const box = (x, y, w, h) => { ctx.strokeRect(x, y, w, h); };
  const label = (t, x, y, size = 24) => {
    ctx.save(); ctx.fillStyle = C2; ctx.font = `600 ${size}px Inter, system-ui, sans-serif`; ctx.textBaseline = 'top';
    ctx.fillText(t, x, y); ctx.restore();
  };
  switch (id) {
    case 'rayas':
      for (let y = 200; y < H - 50; y += 64) hl(y);
      ctx.strokeStyle = C2; ctx.lineWidth = 1 * thick; vl(150, 120, H - 40);
      break;
    case 'rayas_f':
      for (let y = 160; y < H - 40; y += 46) hl(y);
      break;
    case 'cuadros':
      ctx.strokeStyle = CS; ctx.lineWidth = 1.2 * thick;
      for (let x = 0; x <= W; x += 50) vl(x);
      for (let y = 0; y <= H; y += 50) hl(y, 0, W);
      break;
    case 'puntos':
      for (let x = 50; x < W; x += 50) for (let y = 50; y < H; y += 50) { ctx.beginPath(); ctx.arc(x, y, 2.6 * Math.max(1, thick * 0.6), 0, 7); ctx.fill(); }
      break;
    case 'cornell':
      ctx.lineWidth = 2 * thick; hl(170, 0, W); vl(360, 170, H - 360); hl(H - 360, 0, W);
      ctx.lineWidth = 1.5 * thick;
      for (let y = 234; y < H - 380; y += 64) hl(y, 380, W - 40);
      label('Ideas clave', 30, 190); label('Notas', 380, 190); label('Resumen', 30, H - 340);
      label('Tema', 30, 40, 26);
      break;
    case 'tareas':
      label('Tareas', 60, 60, 34);
      for (let y = 170; y < H - 80; y += 80) { ctx.lineWidth = 2 * thick; box(66, y + 8, 34, 34); ctx.lineWidth = 1.5 * thick; hl(y + 48, 130, W - 60); }
      break;
    case 'dia': {
      label('Fecha', 60, 50, 26); hl(90, 150, 600);
      label('Prioridades', 700, 50, 26);
      const top = 150, rows = 16, rh = (H - top - 60) / rows;
      ctx.lineWidth = 2 * thick; vl(660, top, H - 60);
      ctx.lineWidth = 1.5 * thick;
      for (let i = 0; i <= rows; i++) {
        const y = top + i * rh; hl(y, 60, 640);
        if (i < rows) label(`${7 + i}:00`, 66, y + 10, 20);
      }
      for (let y = top + 60; y < H - 60; y += 64) { box(684, y - 30, 24, 24); hl(y, 720, W - 60); }
      break;
    }
    case 'semana': {
      const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo', 'Notas'];
      const m = 50, cw = (W - 2 * m) / 2, rh = (H - 140) / 4;
      label('Semana del ____', m, 40, 30);
      ctx.lineWidth = 2 * thick;
      days.forEach((d, i) => { const x = m + (i % 2) * cw, y = 110 + Math.floor(i / 2) * rh; box(x, y, cw, rh); label(d, x + 16, y + 14); });
      break;
    }
    case 'reunion': {
      label('Fecha', 60, 50); hl(84, 160, 560); label('Hora', 620, 50); hl(84, 700, W - 60);
      label('Asistentes', 60, 120); hl(154, 220, W - 60);
      label('Tema', 60, 190); hl(224, 160, W - 60);
      label('Notas', 60, 280, 26);
      for (let y = 380; y < H - 360; y += 60) hl(y);
      ctx.lineWidth = 2 * thick; box(60, H - 330, W - 120, 280); label('Acciones', 80, H - 314, 26);
      ctx.lineWidth = 1.5 * thick;
      for (let y = H - 260; y < H - 60; y += 60) { box(84, y, 26, 26); hl(y + 30, 130, W - 90); }
      break;
    }
    case 'pentagrama':
      for (let top = 150; top + 72 < H - 40; top += 150) for (let k = 0; k < 5; k++) hl(top + k * 18);
      break;
    case 'storyboard': {
      const m = 60, gap = 40, fw = (W - 2 * m - gap) / 2, fh = fw * 9 / 16, rh = (H - 2 * m) / 3;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
        const x = m + c * (fw + gap), y = m + r * rh;
        ctx.lineWidth = 2 * thick; box(x, y, fw, fh); ctx.lineWidth = 1.5 * thick;
        hl(y + fh + 50, x, x + fw); hl(y + fh + 100, x, x + fw);
      }
      break;
    }
    case 'isometrico': {
      const s = 50, dy = s * Math.sin(Math.PI / 3);
      for (let r = 0, y = 30; y < H; r++, y += dy) for (let x = (r % 2) * s / 2 + 20; x < W; x += s) { ctx.beginPath(); ctx.arc(x, y, 2.4 * Math.max(1, thick * 0.6), 0, 7); ctx.fill(); }
      break;
    }
  }
  ctx.restore();
}
