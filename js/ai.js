// Gemini (API de Google AI Studio) para las funciones de IA: letra a texto, resúmenes, tareas, preguntas y transcripción.
import { settings } from './settings.js';
import { FONT } from './ink.js';
import { dkey } from './ui.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const hasKey = () => !!(settings.aiKey || '').trim();

const toB64 = blob => new Promise(r => { const f = new FileReader(); f.onload = () => r(String(f.result).split(',')[1]); f.readAsDataURL(blob); });
export const dataUrlPart = url => { const [h, d] = url.split(','); return { inline_data: { mime_type: h.slice(5, h.indexOf(';')), data: d } }; };
export const canvasPart = (c, q = 0.8) => dataUrlPart(c.toDataURL('image/jpeg', q));
export const blobPart = async b => ({ inline_data: { mime_type: (b.type || 'audio/webm').split(';')[0], data: await toB64(b) } });

let models = null, good = null;
// Lista de modelos a probar, en orden: el que funcionó la última vez, Flash más recientes y, de reserva, los "Lite".
async function candidates() {
  if (settings.aiModel) return [settings.aiModel];
  if (!models) {
    let flash = [], lite = [];
    try {
      const r = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': settings.aiKey.trim() } });
      if (r.ok) {
        const names = ((await r.json()).models || [])
          .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
          .map(m => m.name.replace('models/', ''))
          .filter(n => /flash/.test(n) && !/image|tts|live|audio|embed|exp|thinking|preview/.test(n));
        const byNew = (a, b) => b.localeCompare(a, 'en', { numeric: true });
        flash = names.filter(n => !/lite/.test(n)).sort(byNew).slice(0, 3);
        lite = names.filter(n => /lite/.test(n)).sort(byNew).slice(0, 2);
      }
    } catch (e) { /* se usan los alias */ }
    models = [...new Set(['gemini-flash-latest', ...flash, 'gemini-flash-lite-latest', ...lite])];
  }
  return good ? [good, ...models.filter(m => m !== good)] : models;
}

const wait = ms => new Promise(r => setTimeout(r, ms));

export async function ask(parts, { json = false } = {}) {
  if (!hasKey()) throw new Error('Falta la clave de Gemini (Ajustes → Inteligencia artificial).');
  const body = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.2, ...(json ? { responseMimeType: 'application/json' } : {}) } });
  let r = null, busy = false, limit = false;
  outer:
  for (const m of await candidates()) {
    for (let tryN = 0; tryN < 2; tryN++) {
      try {
        r = await fetch(`${BASE}/models/${m}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': settings.aiKey.trim(), 'Content-Type': 'application/json' }, body });
      } catch (e) { throw new Error('Sin conexión a internet: la IA necesita conexión.'); }
      if (r.ok) { good = m; break outer; }
      let msg = ''; try { msg = (await r.clone().json()).error?.message || ''; } catch (e) {}
      if (r.status === 400 && /API key/i.test(msg)) throw new Error('La clave de Gemini no es válida. Revísala en Ajustes.');
      if (r.status === 403) throw new Error('La clave de Gemini no tiene permiso. Revísala en Ajustes.');
      if (r.status === 503 || r.status === 500) { busy = true; if (tryN === 0) { await wait(2000); continue; } }
      if (r.status === 429) limit = true;
      if ([404, 429, 500, 503].includes(r.status)) { if (good === m) good = null; continue outer; } // probar otro modelo
      throw new Error(`Gemini respondió ${r.status}: ${msg.slice(0, 160)}`);
    }
  }
  if (!r || !r.ok) {
    if (busy) throw new Error('Gemini está saturado en este momento (pasa a veces). Vuelve a intentarlo en unos minutos.');
    if (limit) throw new Error('Has llegado al límite gratuito de Gemini por ahora. Prueba más tarde.');
    throw new Error('No hay ningún modelo de Gemini disponible para tu clave.');
  }
  const j = await r.json();
  const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
  if (!text) throw new Error(j.promptFeedback?.blockReason ? 'Gemini no quiso responder a este contenido.' : 'Gemini no devolvió respuesta.');
  if (!json) return text;
  try { return JSON.parse(text.replace(/^```json\s*|```$/g, '')); } catch (e) { throw new Error('Gemini devolvió una respuesta que no se pudo leer.'); }
}

const ES = 'Responde siempre en español.';
export const P = {
  ocr: `Transcribe exactamente el texto manuscrito de la imagen. Respeta los saltos de línea y las listas. No añadas comentarios ni explicaciones. Si hay dibujos, ignóralos. Si no hay texto, responde "(sin texto)". ${ES}`,
  summary: `Estas imágenes son páginas de un cuaderno escrito a mano. Haz un resumen claro y breve en viñetas con lo más importante. ${ES}`,
  clean: `Pasa a limpio el texto manuscrito de estas páginas: corrige faltas y ordénalo con títulos y viñetas, sin inventar contenido. ${ES}`,
  extract: () => `Hoy es ${dkey()} (${new Date().toLocaleDateString('es-ES', { weekday: 'long' })}). En estas páginas escritas a mano, busca citas/eventos con fecha y tareas pendientes.
Devuelve SOLO JSON con esta forma: {"eventos":[{"titulo":"","fecha":"AAAA-MM-DD","hora":"HH:MM o vacío"}],"tareas":[{"texto":"","fecha":"AAAA-MM-DD"}]}.
Interpreta fechas relativas ("mañana", "el jueves") respecto a hoy. Si una tarea no tiene fecha, usa la de hoy. Si no hay nada, devuelve listas vacías. Textos en español.`,
  question: q => `Estas imágenes son páginas de mis notas escritas a mano. Responde a mi pregunta usando solo lo que aparece en ellas; si no está, dilo. Pregunta: ${q}. ${ES}`,
  meeting: `Esta es la grabación de una reunión. Devuelve: 1) Transcripción resumida por temas, 2) Acuerdos tomados, 3) Tareas con responsable si se menciona. ${ES}`,
  translate: lang => `Transcribe el texto manuscrito de la imagen y tradúcelo al ${lang}. Devuelve solo la traducción. `
};

// Parte un texto en líneas que caben en el ancho dado (para insertarlo en la página).
const mctx = document.createElement('canvas').getContext('2d');
export function wrap(text, size, maxW) {
  mctx.font = `${size}px ${FONT}`;
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      const t = line ? line + ' ' + w : w;
      if (mctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out.join('\n');
}
