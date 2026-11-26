// Tareas: todas las de la Agenda, las sacadas de los cuadernos y las de Google Tasks, con fecha y seguimiento.
import { db, uid } from './db.js';
import { h, icon, esc, modal, confirm, toast, dkey, fromKey, fmtDate, fmtTime, cap } from './ui.js';

export const STATES = [['pendiente', 'Pendiente'], ['curso', 'En curso'], ['espera', 'En espera'], ['hecha', 'Hecha']];
const stName = s => (STATES.find(x => x[0] === s) || STATES[0])[1];
export const stateOf = t => t.done ? 'hecha' : (t.state && t.state !== 'hecha' ? t.state : 'pendiente');

const note = (t, text) => { (t.log = t.log || []).push({ at: Date.now(), text }); };

// Nueva tarea con su historial desde el principio.
export function make(o) {
  const t = { id: uid(), date: o.date || dkey(), text: o.text || '', done: false, created: Date.now(), state: 'pendiente', prio: o.prio || 0, ...o };
  note(t, o.origin || 'Tarea creada');
  delete t.origin;
  return t;
}

export async function setDone(t, v = !t.done) {
  t.done = v; t.state = v ? 'hecha' : 'pendiente'; t.doneAt = v ? Date.now() : null;
  note(t, v ? 'Marcada como hecha' : 'Vuelve a estar pendiente');
  await db.put('todos', t);
}

const addD = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return dkey(d); };

// Casillas de las listas escritas en los cuadernos (se recogen al guardar cada página).
async function notebookChecks() {
  const out = [];
  for (const nb of await db.all('notebooks')) for (const c of nb.cks || []) if (nb.pages.includes(c.pid)) out.push({ ...c, nb });
  return out;
}

export async function toggleCheck(c) {
  const p = await db.get('pages', c.pid); if (!p) return;
  for (const L of p.layers) for (const o of L.objs) if (o.t === 'c' && o.id === c.oid && o.items[c.i]) { o.items[c.i].done = !o.items[c.i].done; }
  p.updated = Date.now(); await db.put('pages', p);
  const nb = await db.get('notebooks', c.nb.id);
  nb.cks = (nb.cks || []).map(x => x.pid === c.pid && x.oid === c.oid && x.i === c.i ? { ...x, done: !x.done } : x);
  await db.put('notebooks', nb);
}

const V = { f: 'pend', q: '' };

export async function view(v, { route, openSrc, go }) {
  const today = dkey(), all = await db.all('todos'), cks = await notebookChecks();
  const q = V.q.trim().toLowerCase();
  const match = t => !q || (t.text || '').toLowerCase().includes(q) || (t.log || []).some(l => l.text.toLowerCase().includes(q));
  const F = {
    pend: t => !t.done, hoy: t => !t.done && t.date <= today, prox: t => !t.done && t.date > today,
    atr: t => !t.done && t.date < today, hechas: t => t.done, todas: () => true
  };
  const list = all.filter(t => F[V.f](t) && match(t));
  const groups = new Map();
  const put = (k, t) => { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); };
  for (const t of list) {
    if (t.done) { put(t.doneAt ? 'Hechas · ' + fmtDate(t.doneAt, { day: 'numeric', month: 'long' }) : 'Hechas', t); continue; }
    put(t.date < today ? '1Atrasadas' : t.date === today ? '2Hoy' : t.date === addD(today, 1) ? '3Mañana' : t.date <= addD(today, 7) ? '4Próximos 7 días' : '5Más adelante', t);
  }
  const keys = [...groups.keys()].sort((a, b) => /^\d/.test(a) && /^\d/.test(b) ? a.localeCompare(b) : /^\d/.test(a) ? -1 : 1);
  const sorter = (a, b) => (b.prio || 0) - (a.prio || 0) || a.date.localeCompare(b.date) || (a.created || 0) - (b.created || 0);
  const pend = all.filter(t => !t.done), late = pend.filter(t => t.date < today).length;
  const ckPend = cks.filter(c => !c.done && (!q || c.text.toLowerCase().includes(q)));
  const row = t => `<div class="li task ${t.done ? 'done' : ''} ${!t.done && t.date < today ? 'late' : ''}" data-id="${t.id}">
      <button class="chk" data-chk="${t.id}">${t.done ? icon('check') : ''}</button>
      <div class="tx"><b>${t.prio ? '<span class="prio">!</span> ' : ''}${esc(t.text || (t.img ? 'Tarea escrita a mano' : 'Tarea'))}</b>
        <span class="sub">${icon('calendar', 'inl')} ${cap(fmtDate(fromKey(t.date), { weekday: 'short', day: 'numeric', month: 'short' }))}${stateOf(t) !== 'pendiente' && !t.done ? ` · <span class="st st-${stateOf(t)}">${stName(stateOf(t))}</span>` : ''}${(t.log || []).length > 1 ? ` · ${icon('memo', 'inl')} ${(t.log || []).length - 1}` : ''}${t.src ? ` · ${icon('notebook', 'inl')} en un cuaderno` : ''}${t.gid ? ` · ${icon('cloud', 'inl')}` : ''}</span></div>
      ${t.img ? `<img src="${t.img}" alt="">` : ''}</div>`;
  v.innerHTML = `<div class="tkview"><div class="row head"><h1>Tareas</h1><div class="grow"></div>
      <label class="search">${icon('search')}<input placeholder="Buscar tarea o nota" value="${esc(V.q)}"></label>
      <button class="btn pri new">${icon('plus')} Nueva tarea</button></div>
    <p class="sub intro">${pend.length} pendientes${late ? ` · <b>${late} atrasadas</b>` : ''}${ckPend.length ? ` · ${ckPend.length} casillas sin marcar en tus cuadernos` : ''}. Aquí están todas: las que creas aquí o en la Agenda, las que sacas de un cuaderno con el lazo y las de Google Tasks.</p>
    <div class="seg flt">${[['pend', 'Pendientes'], ['hoy', 'Hoy'], ['atr', 'Atrasadas'], ['prox', 'Próximas'], ['hechas', 'Hechas'], ['todas', 'Todas']].map(([k, n]) => `<button data-f="${k}" class="${V.f === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="tasks">${keys.map(k => `<h3>${esc(k.replace(/^\d/, ''))} <span class="sub">${groups.get(k).length}</span></h3><div class="list">${groups.get(k).sort(sorter).map(row).join('')}</div>`).join('') || `<div class="empty">${icon('task')}<b>Nada por aquí</b><span>Crea una tarea o cambia el filtro.</span></div>`}</div>
    ${ckPend.length && V.f !== 'hechas' ? `<h3>${icon('checks', 'inl')} Casillas en tus cuadernos</h3><div class="list cks">${ckPend.map((c, i) => `<div class="li" data-ck="${i}"><button class="chk" data-ckt="${i}"></button><div class="tx"><b>${esc(c.text || 'Casilla para escribir a mano')}</b><span class="sub">${esc(c.nb.title)} · p. ${c.nb.pages.indexOf(c.pid) + 1}${c.title ? ' · ' + esc(c.title) : ''}</span></div></div>`).join('')}</div>` : ''}</div>`;
  v.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { V.f = b.dataset.f; route(); });
  const inp = v.querySelector('.search input');
  let st; inp.oninput = () => { clearTimeout(st); st = setTimeout(() => { V.q = inp.value; route().then(() => { const i = document.querySelector('.search input'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 350); };
  v.querySelector('.new').onclick = async () => { const t = await editTask(null); if (t) route(); };
  // El contenedor es nuevo en cada visita: así no se acumulan escuchadores en la vista.
  v.firstElementChild.addEventListener('click', async e => {
    const chk = e.target.closest('[data-chk]');
    if (chk) { e.stopPropagation(); await setDone(all.find(t => t.id === chk.dataset.chk)); route(); return; }
    const ckt = e.target.closest('[data-ckt]');
    if (ckt) { e.stopPropagation(); await toggleCheck(ckPend[+ckt.dataset.ckt]); toast('Casilla marcada en el cuaderno'); route(); return; }
    const ck = e.target.closest('[data-ck]');
    if (ck) { const c = ckPend[+ck.dataset.ck]; go(`#/ed/${c.nb.id}/${c.nb.pages.indexOf(c.pid)}`); return; }
    const r = e.target.closest('[data-id]');
    if (r) { const t = all.find(x => x.id === r.dataset.id); const res = await editTask(t, openSrc); if (res) route(); }
  });
}

// Ficha de una tarea: texto, fecha, prioridad, estado y seguimiento (notas con fecha y hora).
export async function editTask(t, openSrc) {
  const isNew = !t;
  t = t || make({ date: dkey() });
  const el = h(`<div class="tform">
    <label class="field"><span>Tarea</span><input name="text" value="${esc(t.text || '')}" placeholder="¿Qué hay que hacer?"></label>
    ${t.img ? `<img src="${t.img}" alt="" style="max-width:100%;max-height:140px;background:#fff;border-radius:8px;border:1px solid var(--line2);margin:-4px 0 12px">` : ''}
    <div class="row" style="gap:12px;flex-wrap:wrap">
      <label class="field"><span>Fecha</span><input type="date" name="date" value="${esc(t.date)}"></label>
      <label class="field"><span>Estado</span><select name="state">${STATES.map(([k, n]) => `<option value="${k}" ${stateOf(t) === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="field"><span>Prioridad</span><select name="prio"><option value="0">Normal</option><option value="1" ${t.prio ? 'selected' : ''}>Alta</option></select></label></div>
    <div class="field"><span>Seguimiento</span></div>
    <div class="list log">${(t.log || []).slice().reverse().map(l => `<div class="li"><span class="sub" style="min-width:118px">${fmtDate(l.at, { day: 'numeric', month: 'short' })} ${fmtTime(l.at)}</span><span class="tx">${esc(l.text)}</span></div>`).join('') || '<div class="li sub">Sin anotaciones</div>'}</div>
    <div class="row" style="margin-top:10px;gap:8px"><input name="note" placeholder="Añadir una nota de seguimiento" style="flex:1;padding:10px;border:1.5px solid var(--line2);border-radius:10px;background:var(--paper);color:var(--ink)"></div>
    <p class="sub">Creada ${t.created ? fmtDate(t.created, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}${t.doneAt ? ' · hecha ' + fmtDate(t.doneAt, { day: 'numeric', month: 'short' }) : ''}</p></div>`);
  const btns = [{ label: 'Cancelar', value: null }];
  if (!isNew) btns.unshift({ label: 'Eliminar', value: 'del' });
  if (t.src && openSrc) btns.splice(1, 0, { label: 'Abrir en el cuaderno', value: 'src' });
  btns.push({ label: isNew ? 'Crear' : 'Guardar', pri: true, value: mb => ({ text: mb.querySelector('[name=text]').value.trim(), date: mb.querySelector('[name=date]').value, state: mb.querySelector('[name=state]').value, prio: +mb.querySelector('[name=prio]').value, note: mb.querySelector('[name=note]').value.trim() }) });
  const r = await modal(isNew ? 'Nueva tarea' : 'Tarea', el, btns, { wide: true });
  if (!r) return null;
  if (r === 'src') { openSrc(t.src); return null; }
  if (r === 'del') { if (await confirm('¿Eliminar esta tarea?', 'Eliminar')) { await db.del('todos', t.id); return true; } return null; }
  if (isNew && !r.text) { toast('Escribe la tarea'); return null; }
  if (!isNew) {
    if (r.text !== (t.text || '')) note(t, 'Texto cambiado');
    if (r.date && r.date !== t.date) note(t, 'Fecha cambiada al ' + fmtDate(fromKey(r.date), { day: 'numeric', month: 'short' }));
    if (r.prio !== (t.prio || 0)) note(t, r.prio ? 'Prioridad alta' : 'Prioridad normal');
  }
  if (r.state !== stateOf(t)) {
    if (!isNew) note(t, 'Estado: ' + stName(r.state));
    t.done = r.state === 'hecha'; t.doneAt = t.done ? Date.now() : null;
  }
  Object.assign(t, { text: r.text, date: r.date || t.date, state: r.state, prio: r.prio });
  if (r.note) note(t, r.note);
  await db.put('todos', t);
  return t;
}

export async function pendingCount() { const today = dkey(); const all = (await db.all('todos')).filter(t => !t.done); return { n: all.length, late: all.filter(t => t.date < today).length }; }
