// Carpetas en árbol. Cada carpeta se guarda como un registro de tipo 'folder' (se sincroniza como los cuadernos).
// Cualquier documento puede estar en una carpeta mediante su campo `parent` ('' = raíz).
import { db, uid } from './db.js';
import { h, esc, icon, modal, toast, prompt } from './ui.js';

export const isFolder = n => n.kind === 'folder';

export async function allFolders() { return (await db.all('notebooks')).filter(isFolder); }

export function childrenOf(pid, folders) {
  return folders.filter(f => (f.parent || '') === (pid || '')).sort((a, b) => a.title.localeCompare(b.title, 'es', { numeric: true }));
}

export function pathOf(id, folders) {
  const out = [], seen = new Set();
  let f = folders.find(x => x.id === id);
  while (f && !seen.has(f.id)) { seen.add(f.id); out.unshift(f); f = folders.find(x => x.id === f.parent); }
  return out;
}

export function descendants(id, folders) {
  const out = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const f of folders) if (!out.has(f.id) && out.has(f.parent)) { out.add(f.id); grew = true; } }
  return out;
}

export async function newFolder(title, parent = '') {
  const f = { id: uid(), kind: 'folder', title, parent, pages: [], created: Date.now(), updated: Date.now() };
  await db.put('notebooks', f);
  return f;
}

// Borra una carpeta: lo que tenía dentro sube a la carpeta superior.
export async function deleteFolder(f) {
  for (const n of await db.all('notebooks')) if ((n.parent || '') === f.id) { n.parent = f.parent || ''; await db.put('notebooks', n); }
  await db.del('notebooks', f.id);
}

// Pasa las carpetas antiguas (texto) al árbol nuevo, una sola vez.
export async function migrate() {
  const all = await db.all('notebooks');
  const old = all.filter(n => !isFolder(n) && n.folder && n.parent === undefined);
  if (!old.length) return;
  const folders = all.filter(isFolder);
  for (const n of old) {
    let f = folders.find(x => !x.parent && x.title === n.folder);
    if (!f) { f = await newFolder(n.folder, ''); folders.push(f); }
    n.parent = f.id; delete n.folder;
    await db.put('notebooks', n);
  }
}

// Ventana para elegir carpeta (árbol). Devuelve el id ('' = raíz) o null si se cancela.
export async function pickFolder(title, { current = '', exclude = null } = {}) {
  let folders = await allFolders();
  const banned = exclude ? descendants(exclude, folders) : new Set();
  let chosen = current || '';
  const el = h('<div class="ftree pick"></div>');
  const draw = () => {
    const rows = [];
    const walk = (pid, depth) => {
      for (const f of childrenOf(pid, folders)) {
        if (banned.has(f.id)) continue;
        rows.push(`<button class="frow ${chosen === f.id ? 'on' : ''}" data-id="${f.id}" style="padding-left:${12 + depth * 22}px">${icon('folder')}<span>${esc(f.title)}</span></button>`);
        walk(f.id, depth + 1);
      }
    };
    walk('', 1);
    el.innerHTML = `<button class="frow ${chosen === '' ? 'on' : ''}" data-id="">${icon('home')}<span>Raíz</span></button>${rows.join('')}
      <button class="btn sm ghost newf" style="margin-top:10px">${icon('folderPlus')} Nueva carpeta aquí</button>`;
  };
  el.addEventListener('click', async e => {
    const r = e.target.closest('[data-id]');
    if (r) { chosen = r.dataset.id; draw(); return; }
    if (e.target.closest('.newf')) {
      const r = await prompt('Nueva carpeta', [{ name: 't', label: 'Nombre', value: '' }], 'Crear');
      if (r && r.t.trim()) { const f = await newFolder(r.t.trim(), chosen); folders = await allFolders(); chosen = f.id; draw(); }
    }
  });
  draw();
  const r = await modal(title, el, [{ label: 'Cancelar', value: null }, { label: 'Mover aquí', pri: true, value: () => ({ id: chosen }) }]);
  return r ? r.id : null;
}

export async function moveTo(item, parent) {
  if (isFolder(item)) {
    const folders = await allFolders();
    if (descendants(item.id, folders).has(parent)) { toast('No se puede mover una carpeta dentro de sí misma'); return false; }
  }
  item.parent = parent;
  delete item.folder;
  await db.put('notebooks', item);
  return true;
}
