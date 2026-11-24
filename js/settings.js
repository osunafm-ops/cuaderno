import { db } from './db.js';

export const settings = {
  penOnly: true,        // solo el S Pen escribe; el dedo mueve, desplaza y hace gestos
  gestures: true,       // 2 dedos = deshacer, 3 dedos = rehacer
  swipe: true,          // deslizar el dedo para pasar página
  shapes: true,         // mantener el lápiz quieto al final del trazo = forma perfecta
  holdMs: 600,
  color: false,         // tinta en color (la tableta E Ink es solo grises)
  tone: 'eink',         // eink | white | cream
  dark: false,
  refresh: 'fast',      // best (parpadeo E Ink) | fast
  leftHanded: false,
  penButton: 'eraser',  // botón del S Pen: eraser | lasso | hl
  eraserMode: 'trazo',  // trazo | area
  eraserSize: 18,
  textSize: 36,
  defaultTpl: 'rayas',
  pens: [{ b: 'pluma', w: 2.5, c: '#141414' }, { b: 'fino', w: 1.5, c: '#141414' }],
  hl: { w: 8, c: '#9a9a9a' },
  // Sincronización con Google
  gClientId: '',
  gConnected: false,
  gDrive: true,
  gCal: true,
  gTasks: true,
  gCalShow: true,   // ver también tus otros calendarios de Google (solo lectura)
  gScopes: [],
  gFolder: null,
  gLast: null,
  // Gemini (IA): la clave se guarda solo en esta tablet
  aiKey: '',
  aiModel: '',
  // Office 365 (solo lectura)
  msClientId: '', msConnected: false, msLast: null,
  // Copia de seguridad de cada noche
  bkOn: true, bkHour: 3, bkDrive: true, deviceName: '',
  pin: ''          // huella SHA-256 del PIN (vacío = sin bloqueo)
};

export const PAPER = { eink: '#f4f3ee', white: '#ffffff', cream: '#f7f1e3' };

export async function loadSettings() {
  try {
    const r = await db.get('kv', 'settings');
    if (r) Object.assign(settings, r.v);
  } catch (e) { console.warn(e); }
  applyTheme();
}

export function saveSettings() {
  db.put('kv', { id: 'settings', v: settings });
  applyTheme();
}

export function applyTheme() {
  const c = document.documentElement.classList;
  c.toggle('dark', !!settings.dark);
  c.toggle('tone-white', settings.tone === 'white');
  c.toggle('tone-cream', settings.tone === 'cream');
}
