// ============================================================
// main.js — Orquestador de Bolígrafo (v1.0 "live")
// ------------------------------------------------------------
// Ciclo: estado (S) → render → eventos → mutan estado → render.
// ============================================================
import './styles.css';
import {
  db, uid, createDoc, createProject, saveDocContent, touchDoc, docTree,
  trashedDocs, trashDoc, restoreDoc, purgeDoc, createSnapshot,
  addWordsToday, wordsToday, exportProjectFile, importProjectFile, TEMPLATES,
} from './db.js';
import { seedIfEmpty } from './seed.js';
import { reindexLinks, backlinksTo, outgoingFrom, normalize } from './links.js';
import { createEditor, countWords, debounce, fileToDataUrl } from './editor.js';
import { syncNow, syncEnabled, syncConfig, startAutoSync } from './sync.js';

const S = {
  project: null, tree: null, currentDoc: null, editor: null,
  lastSavedWords: 0, zoom: 1,
  collapsed: new Set(JSON.parse(localStorage.getItem('bg.collapsed') ?? '[]')),
};
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const isMobile = () => window.matchMedia('(max-width: 980px)').matches;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------- Shell ----------------------------
document.querySelector('#app').innerHTML = `
<div class="app">
  <header class="topbar">
    <button class="icon-btn on" id="btnBinder" title="Manuscrito">◧</button>
    <div class="logo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 3l4 4L8 20l-5 1 1-5L17 3z"/></svg>
      <span class="hide-mobile">Bolígrafo</span>
    </div>
    <button class="btn" id="projBtn" title="Cambiar de proyecto">…</button>
    <div class="spacer"></div>
    <span class="save-state hide-mobile" id="saveState">Guardado</span>
    <span class="save-state hide-mobile" id="syncState" style="display:none"></span>
    <div class="zoom-ctl hide-mobile">
      <button id="zoomOut">−</button><span class="val" id="zoomVal">100%</span><button id="zoomIn">＋</button>
    </div>
    <button class="icon-btn on" id="btnComments" title="Notas ancladas">💬</button>
    <button class="icon-btn" id="btnSync" title="Sincronizar ahora">⇅</button>
    <button class="icon-btn" id="btnSettings" title="Ajustes">⚙️</button>
    <button class="icon-btn on" id="btnPanel" title="Panel de contexto">◨</button>
  </header>
  <nav class="binder" id="binder"></nav>
  <main class="editor-wrap">
    <div class="page-holder">
      <article class="page" id="page">
        <div class="scene-meta" id="sceneMeta"></div>
        <input class="doc-title" id="docTitle" placeholder="Título…" />
        <div class="toolbar" id="toolbar"></div>
        <div id="editorMount"></div>
      </article>
    </div>
  </main>
  <aside class="panel" id="panel"></aside>
</div>
<div class="statusbar">
  <span><b id="wc">0</b> palabras</span>
  <span class="sep"></span>
  <button class="act" id="btnSnap">📸 Snapshot</button>
  <span class="sep hide-mobile"></span>
  <button class="act hide-mobile" id="btnFocus">☾ Modo enfoque</button>
</div>
<nav class="mobile-nav">
  <button id="mnavWrite"><span class="ic">✒️</span>Escribir</button>
  <button id="mnavBinder"><span class="ic">📚</span>Manuscrito</button>
  <button id="mnavPanel"><span class="ic">🗂️</span>Contexto</button>
</nav>
<div class="scrim" id="scrim"></div>
<div class="ctx-menu" id="ctxMenu"></div>
<div class="ac-menu" id="acMenu"></div>
<div class="modal-back" id="modalBack"><div class="modal" id="modal"></div></div>
<input type="file" id="imgInput" accept="image/*" style="display:none" />
<input type="file" id="importInput" accept=".boligrafo,.json" style="display:none" />
`;

// ------------------------- Toolbar --------------------------
const TOOLS = [
  { ic: '𝐁', t: 'Negrita', run: (e) => e.chain().focus().toggleBold().run(), is: 'bold' },
  { ic: '𝐼', t: 'Cursiva', run: (e) => e.chain().focus().toggleItalic().run(), is: 'italic' },
  { sep: true },
  { ic: 'H2', t: 'Título', run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), is: 'heading' },
  { ic: 'H3', t: 'Subtítulo', run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { ic: '≡', t: 'Lista', run: (e) => e.chain().focus().toggleBulletList().run(), is: 'bulletList' },
  { ic: '❝', t: 'Cita', run: (e) => e.chain().focus().toggleBlockquote().run(), is: 'blockquote' },
  { sep: true },
  { ic: '▦', t: 'Tabla', run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { ic: '🖼', t: 'Imagen', run: () => $('#imgInput').click() },
  { ic: '—', t: 'Separador', run: (e) => e.chain().focus().setHorizontalRule().run() },
  { sep: true },
  { ic: '[[', t: 'Wikilink', run: (e) => e.chain().focus().insertContent('[[').run() },
  { ic: '📝', t: 'Nota anclada a la selección', run: () => addNoteToSelection() },
];
function renderToolbar() {
  $('#toolbar').innerHTML = TOOLS.map((t, i) =>
    t.sep ? '<span class="tb-sep"></span>'
      : `<button class="tb" data-tool="${i}" title="${t.t}">${t.ic}</button>`
  ).join('');
}
$('#toolbar').addEventListener('mousedown', (e) => e.preventDefault()); // no robar foco
$('#toolbar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tool]');
  if (b && S.editor) TOOLS[+b.dataset.tool].run(S.editor);
});
$('#imgInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !S.editor) return;
  const src = await fileToDataUrl(file);
  S.editor.chain().focus().setImage({ src }).run();
  e.target.value = '';
});

// ------------------------- Binder ---------------------------
function renderBinder() {
  const { byParent } = S.tree;
  const roots = byParent.get('root') ?? [];
  const renderItems = (items) => items.map((d) => {
    const kids = byParent.get(d.id) ?? [];
    const isFolder = d.type === 'folder';
    const collapsed = S.collapsed.has(d.id);
    const active = S.currentDoc?.id === d.id ? ' active' : '';
    const words = !isFolder && d.words ? `<span class="count">${fmtWords(d.words)}</span>` : '';
    return `
      <div class="tree-item${isFolder ? ' folder' : ''}${collapsed ? ' collapsed' : ''}${active}" data-id="${d.id}">
        ${isFolder ? '<span class="chev">▾</span>' : ''}
        <span class="em">${esc(d.emoji)}</span><span class="t">${esc(d.title)}</span>${words}
        <button class="dots" data-ctx="${d.id}">⋯</button>
      </div>
      ${kids.length ? `<div class="tree-children" ${collapsed ? 'style="display:none"' : ''}>${renderItems(kids)}</div>` : ''}`;
  }).join('');

  const sections = roots.map((root) => `
    <div class="binder-section">
      <div class="binder-label">${esc(root.emoji)} ${esc(root.title)}
        <span>
          <button class="add" data-addfolder="${root.id}" title="Nueva carpeta">🗀</button>
          <button class="add" data-add="${root.id}" data-kind="${root.title === 'Mundo' ? 'world' : 'scene'}" title="Nuevo documento">＋</button>
        </span>
      </div>
      ${renderItems(byParent.get(root.id) ?? [])}
    </div>`).join('');

  $('#binder').innerHTML = sections + `
    <div class="binder-section">
      <div class="binder-label">🗑️ Papelera
        <button class="add" id="openTrash" title="Ver papelera">↗</button>
      </div>
    </div>
    <div class="word-goal">
      Meta de hoy — <b id="goalNums">…</b> palabras
      <div class="bar"><div id="goalBar" style="width:0%"></div></div>
    </div>`;
  $('#openTrash').addEventListener('click', openTrashModal);
  refreshGoal();
}
function fmtWords(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }
async function refreshGoal() {
  const w = await wordsToday();
  const goal = S.project.dailyGoal ?? 1000;
  const el = $('#goalNums'); if (!el) return;
  el.textContent = `${w.toLocaleString('es')} / ${goal.toLocaleString('es')}`;
  $('#goalBar').style.width = Math.min(100, (w / goal) * 100) + '%';
}

$('#binder').addEventListener('click', async (e) => {
  const ctx = e.target.closest('[data-ctx]');
  if (ctx) { e.stopPropagation(); openCtxMenu(ctx.dataset.ctx, ctx); return; }
  const addF = e.target.closest('[data-addfolder]');
  if (addF) {
    const title = prompt('Nombre de la carpeta:');
    if (!title) return;
    await createDoc({ projectId: S.project.id, parentId: addF.dataset.addfolder, type: 'folder', title });
    await reloadTree(); renderBinder(); return;
  }
  const add = e.target.closest('[data-add]');
  if (add) {
    const title = prompt(add.dataset.kind === 'world' ? 'Nombre de la ficha:' : 'Título de la escena:');
    if (!title) return;
    const doc = await createDoc({ projectId: S.project.id, parentId: add.dataset.add, type: add.dataset.kind, title });
    await reloadTree(); openDoc(doc.id); return;
  }
  const row = e.target.closest('.tree-item');
  if (!row) return;
  const doc = S.tree.all.find((d) => d.id === row.dataset.id);
  if (doc.type === 'folder') {
    S.collapsed.has(doc.id) ? S.collapsed.delete(doc.id) : S.collapsed.add(doc.id);
    localStorage.setItem('bg.collapsed', JSON.stringify([...S.collapsed]));
    renderBinder();
  } else {
    openDoc(doc.id);
    if (isMobile()) closeMobilePanels();
  }
});
async function reloadTree() { S.tree = await docTree(S.project.id); }

// ------------------------- Menú contextual ------------------
function openCtxMenu(docId, anchor) {
  const doc = S.tree.all.find((d) => d.id === docId);
  const menu = $('#ctxMenu');
  const isFolder = doc.type === 'folder';
  menu.innerHTML = `
    <button data-act="rename">✏️ Renombrar</button>
    <button data-act="up">↑ Subir</button>
    <button data-act="down">↓ Bajar</button>
    <button data-act="move">📂 Mover a…</button>
    ${isFolder ? '<button data-act="newsub">🗀 Nueva subcarpeta</button>' : ''}
    <button data-act="emoji">😀 Cambiar emoji</button>
    <button data-act="trash" class="danger">🗑️ Enviar a papelera</button>`;
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.min(r.left, innerWidth - 210) + 'px';
  menu.style.top = r.bottom + 4 + 'px';
  menu.classList.add('open');

  menu.onclick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    menu.classList.remove('open');
    if (!act) return;
    if (act === 'rename') {
      const t = prompt('Nuevo nombre:', doc.title);
      if (t) { await touchDoc(doc.id, { title: t }); if (S.currentDoc?.id === doc.id) { S.currentDoc.title = t; $('#docTitle').value = t; } }
    }
    if (act === 'emoji') {
      const em = prompt('Emoji:', doc.emoji);
      if (em) await touchDoc(doc.id, { emoji: em });
    }
    if (act === 'up' || act === 'down') {
      // intercambia `order` con el hermano vecino — swap clásico
      const siblings = (S.tree.byParent.get(doc.parentId ?? 'root') ?? []);
      const i = siblings.findIndex((x) => x.id === doc.id);
      const j = act === 'up' ? i - 1 : i + 1;
      if (j >= 0 && j < siblings.length) {
        await touchDoc(doc.id, { order: siblings[j].order });
        await touchDoc(siblings[j].id, { order: doc.order });
      }
    }
    if (act === 'move') {
      const folders = S.tree.all.filter((d) => d.type === 'folder' && d.id !== doc.id);
      const pick = prompt('Mover a:\n' + folders.map((f, i) => `${i + 1}. ${f.title}`).join('\n') + '\n\nEscribe el número:');
      const f = folders[+pick - 1];
      if (f) await touchDoc(doc.id, { parentId: f.id, order: Date.now() });
    }
    if (act === 'newsub') {
      const t = prompt('Nombre de la subcarpeta:');
      if (t) await createDoc({ projectId: S.project.id, parentId: doc.id, type: 'folder', title: t });
    }
    if (act === 'trash') {
      if (confirm(`¿Enviar «${doc.title}» a la papelera?${doc.type === 'folder' ? ' (incluye su contenido)' : ''}`)) {
        await trashDoc(doc.id);
        if (S.currentDoc?.id === doc.id) S.currentDoc = null;
      }
    }
    await reloadTree(); renderBinder();
  };
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('#ctxMenu') && !e.target.closest('[data-ctx]')) $('#ctxMenu').classList.remove('open');
  if (!e.target.closest('#acMenu')) hideAutocomplete();
});

// ------------------------- Papelera -------------------------
async function openTrashModal() {
  const items = await trashedDocs(S.project.id);
  openModal(`
    <h3>🗑️ Papelera</h3>
    ${items.length ? items.map((d) => `
      <div class="snap-item">
        <span>${esc(d.emoji)} ${esc(d.title)}</span>
        <span>
          <button data-restore-doc="${d.id}">Restaurar</button>
          <button data-purge-doc="${d.id}" class="danger">Borrar definitivo</button>
        </span>
      </div>`).join('')
      : '<div class="empty-hint">La papelera está vacía.</div>'}
  `);
  $('#modal').onclick = async (e) => {
    const r = e.target.closest('[data-restore-doc]');
    const p = e.target.closest('[data-purge-doc]');
    if (r) { await restoreDoc(r.dataset.restoreDoc); await reloadTree(); renderBinder(); openTrashModal(); }
    if (p && confirm('¿Borrar PARA SIEMPRE? No hay vuelta atrás.')) {
      await purgeDoc(p.dataset.purgeDoc); openTrashModal();
    }
  };
}

// ------------------------- Abrir documento -------------------
async function openDoc(docId) {
  await flushSave();
  const doc = await db.docs.get(docId);
  if (!doc || doc.deleted) return;
  S.currentDoc = doc;
  S.lastSavedWords = doc.words ?? 0;
  localStorage.setItem('bg.lastDoc', docId);

  const last = (await db.snapshots.where('docId').equals(docId).sortBy('createdAt')).pop();
  if (!last || Date.now() - last.createdAt > 10 * 60 * 1000) await createSnapshot(doc, 'apertura');

  $('#docTitle').value = doc.title;
  $('#page').classList.toggle('is-scene', doc.type === 'scene');
  renderSceneMeta();

  S.editor?.destroy();
  $('#editorMount').innerHTML = '';
  S.editor = createEditor({
    element: $('#editorMount'),
    content: doc.content,
    onUpdate: () => {
      $('#saveState').classList.add('dirty');
      $('#saveState').textContent = 'Escribiendo…';
      updateWordCount(); autosave(); checkAutocomplete();
    },
    onCommentClick: highlightNote,
    onWikilinkNavigate: navigateToTitle,
  });
  updateWordCount(); renderBinder(); renderPanel();
}

// wikilink click → navega, y si no existe la ficha, ofrece crearla
async function navigateToTitle(title) {
  await flushSave();
  const target = S.tree.all.find((d) => normalize(d.title) === normalize(title));
  if (target) return openDoc(target.id);
  if (confirm(`La ficha «${title}» no existe. ¿Crearla en Mundo?`)) {
    const mundo = S.tree.all.find((d) => d.parentId === null && d.title === 'Mundo');
    const doc = await createDoc({ projectId: S.project.id, parentId: mundo?.id ?? null, type: 'world', title });
    await reloadTree(); openDoc(doc.id);
  }
}

function renderSceneMeta() {
  const d = S.currentDoc;
  const label = d.type === 'world' ? 'Mundo · Ficha' : 'Manuscrito · Escena';
  const chip = d.type === 'world'
    ? `<span class="status-chip world">Ficha viva</span>`
    : `<button class="status-chip" id="statusChip">${esc(d.meta.status ?? 'idea')}</button>`;
  $('#sceneMeta').innerHTML = `<span>${label}</span>${chip}`;
  $('#statusChip')?.addEventListener('click', async () => {
    const order = ['idea', 'borrador', 'revisado', 'final'];
    d.meta.status = order[(order.indexOf(d.meta.status) + 1) % order.length];
    await touchDoc(d.id, { meta: d.meta });
    renderSceneMeta();
  });
}

// ------------------------- Autocompletado [[ -----------------
function checkAutocomplete() {
  const ed = S.editor; if (!ed) return hideAutocomplete();
  const { $from, empty } = ed.state.selection;
  if (!empty) return hideAutocomplete();
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
  const m = before.match(/\[\[([^\[\]]*)$/);
  if (!m) return hideAutocomplete();
  const query = normalize(m[1]);
  const matches = S.tree.all
    .filter((d) => d.type !== 'folder' && normalize(d.title).includes(query))
    .slice(0, 6);
  if (!matches.length) return hideAutocomplete();

  const menu = $('#acMenu');
  menu.innerHTML = matches.map((d) =>
    `<button data-ac="${esc(d.title)}">${esc(d.emoji)} ${esc(d.title)}</button>`).join('');
  const coords = ed.view.coordsAtPos(ed.state.selection.from);
  menu.style.left = Math.min(coords.left, innerWidth - 240) + 'px';
  menu.style.top = coords.bottom + 6 + 'px';
  menu.classList.add('open');
  menu.onclick = (e) => {
    const b = e.target.closest('[data-ac]'); if (!b) return;
    const title = b.dataset.ac;
    // completa lo que falta del título + cierra ]]
    ed.chain().focus().insertContent(title.slice(m[1].length) + ']]').run();
    hideAutocomplete();
  };
}
function hideAutocomplete() { $('#acMenu').classList.remove('open'); }

// ------------------------- Guardado -------------------------
async function doSave() {
  if (!S.currentDoc || !S.editor) return;
  const content = S.editor.getJSON();
  const words = countWords(S.editor);
  await saveDocContent(S.currentDoc.id, content, words);
  S.currentDoc.content = content;
  await addWordsToday(words - S.lastSavedWords);
  S.lastSavedWords = words;
  S.currentDoc.words = words;
  await reindexLinks(S.currentDoc);
  await reloadTree();
  $('#saveState').classList.remove('dirty');
  $('#saveState').textContent = 'Guardado';
  refreshGoal(); refreshLinksPanel();
}
const autosave = debounce(doSave, 900);
async function flushSave() { if ($('#saveState')?.classList.contains('dirty')) await doSave(); }

$('#docTitle').addEventListener('change', async (e) => {
  if (!S.currentDoc) return;
  S.currentDoc.title = e.target.value.trim() || 'Sin título';
  await touchDoc(S.currentDoc.id, { title: S.currentDoc.title });
  await reloadTree(); renderBinder(); renderPanel();
});
function updateWordCount() { $('#wc').textContent = countWords(S.editor).toLocaleString('es'); }

// ------------------------- Panel derecho --------------------
async function renderPanel() {
  const d = S.currentDoc; if (!d) return;
  const isScene = d.type === 'scene';
  $('#panel').innerHTML = `
    ${isScene ? `
    <h4>Escena</h4>
    <div class="meta-grid">
      <label>POV</label><input id="mPov" value="${esc(d.meta.pov)}" placeholder="¿Quién narra?" />
      <label>Lugar</label><input id="mLoc" value="${esc(d.meta.location)}" placeholder="¿Dónde ocurre?" />
    </div>` : ''}
    <h4>Notas ancladas <button class="mini" id="addNote">＋</button></h4>
    <div id="notesList"></div>
    <h4>Menciones salientes</h4>
    <div id="outLinks"></div>
    <h4>Backlinks — ¿quién menciona «${esc(d.title)}»?</h4>
    <div id="backLinks"></div>
    <h4>Historial <button class="mini" id="snapNow">📸</button></h4>
    <div id="snapList"></div>`;
  $('#mPov')?.addEventListener('change', (e) => { d.meta.pov = e.target.value; touchDoc(d.id, { meta: d.meta }); });
  $('#mLoc')?.addEventListener('change', (e) => { d.meta.location = e.target.value; touchDoc(d.id, { meta: d.meta }); });
  $('#addNote').addEventListener('click', addNoteToSelection);
  $('#snapNow').addEventListener('click', async () => { await flushSave(); await createSnapshot(S.currentDoc, 'manual'); renderSnapshots(); });
  renderNotes(); refreshLinksPanel(); renderSnapshots();
}
async function refreshLinksPanel() {
  const d = S.currentDoc; if (!d || !$('#outLinks')) return;
  const out = await outgoingFrom(d.id, S.project.id);
  const back = (await backlinksTo(d.title)).filter((x) => x.id !== d.id && !x.deleted);
  const item = (x) => `<div class="link-item" data-open="${x.id}"><span class="em">${esc(x.emoji)}</span> ${esc(x.title)}</div>`;
  $('#outLinks').innerHTML = out.length ? out.map(item).join('') : `<div class="empty-hint">Escribe [[Nombre]] para vincular fichas — con autocompletado.</div>`;
  $('#backLinks').innerHTML = back.length ? back.map(item).join('') : `<div class="empty-hint">Nadie menciona este documento todavía.</div>`;
}
$('#panel').addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]');
  if (open) openDoc(open.dataset.open);
});

// ------------------------- Notas ancladas -------------------
function addNoteToSelection() {
  const ed = S.editor;
  if (!ed || ed.state.selection.empty) return alert('Selecciona primero el texto donde anclar la nota ✍️');
  const text = prompt('Texto de la nota:');
  if (!text) return;
  const noteId = uid();
  ed.chain().focus().setComment(noteId).run();
  S.currentDoc.meta.notes ??= [];
  S.currentDoc.meta.notes.push({ id: noteId, text, createdAt: Date.now() });
  touchDoc(S.currentDoc.id, { meta: S.currentDoc.meta });
  doSave(); renderNotes();
}
function renderNotes() {
  const notes = S.currentDoc?.meta?.notes ?? [];
  $('#notesList').innerHTML = notes.length ? notes.map((n) => `
    <div class="note-card" data-note="${n.id}">
      <div class="nc-top">Nota <button class="x" data-del-note="${n.id}">✕</button></div>${esc(n.text)}
    </div>`).join('') : `<div class="empty-hint">Selecciona texto y usa ＋ (o 📝 en la toolbar).</div>`;
  $$('#notesList [data-del-note]').forEach((btn) =>
    btn.addEventListener('click', () => deleteNote(btn.dataset.delNote)));
}
function deleteNote(noteId) {
  const ed = S.editor;
  const ranges = [];
  ed.state.doc.descendants((node, pos) => {
    node.marks?.forEach((m) => {
      if (m.type.name === 'comment' && m.attrs.noteId === noteId)
        ranges.push({ from: pos, to: pos + node.nodeSize });
    });
  });
  let chain = ed.chain();
  for (const r of ranges) chain = chain.setTextSelection(r).unsetComment();
  chain.run();
  S.currentDoc.meta.notes = (S.currentDoc.meta.notes ?? []).filter((n) => n.id !== noteId);
  touchDoc(S.currentDoc.id, { meta: S.currentDoc.meta });
  doSave(); renderNotes();
}
function highlightNote(noteId) {
  if (isMobile()) document.body.classList.add('show-panel');
  const card = $(`#notesList [data-note="${noteId}"]`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.style.outline = '2px solid var(--pen)';
    setTimeout(() => (card.style.outline = ''), 1200);
  }
}

// ------------------------- Snapshots ------------------------
async function renderSnapshots() {
  const list = (await db.snapshots.where('docId').equals(S.currentDoc.id).sortBy('createdAt')).reverse().slice(0, 8);
  $('#snapList').innerHTML = list.length ? list.map((s) => `
    <div class="snap-item">
      <span><span class="when">${new Date(s.createdAt).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span> · ${fmtWords(s.words)} pal.</span>
      <button data-restore="${s.id}">Restaurar</button>
    </div>`).join('') : `<div class="empty-hint">Snapshots automáticos al abrir, o con 📸.</div>`;
  $$('#snapList [data-restore]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('¿Restaurar esta versión? El estado actual se respalda primero.')) return;
      await flushSave();
      await createSnapshot(S.currentDoc, 'pre-restauración');
      const snap = await db.snapshots.get(btn.dataset.restore);
      S.editor.commands.setContent(snap.content);
      await doSave(); renderSnapshots();
    }));
}

// ------------------------- Modales --------------------------
function openModal(html) {
  $('#modal').innerHTML = html + '<button class="btn modal-close" id="modalClose">Cerrar</button>';
  $('#modalBack').classList.add('open');
  $('#modalClose').addEventListener('click', closeModal);
}
function closeModal() { $('#modalBack').classList.remove('open'); }
$('#modalBack').addEventListener('click', (e) => { if (e.target.id === 'modalBack') closeModal(); });

// --- Proyectos ---
async function openProjectModal() {
  const projects = await db.projects.toArray();
  openModal(`
    <h3>📚 Tus proyectos</h3>
    ${projects.map((p) => `
      <div class="snap-item">
        <span>${p.id === S.project.id ? '● ' : ''}<b>${esc(p.name)}</b> <span class="when">${esc(TEMPLATES[p.kind]?.label ?? p.kind)}</span></span>
        <span>
          ${p.id !== S.project.id ? `<button data-switch="${p.id}">Abrir</button>` : ''}
          <button data-export="${p.id}">Exportar .boligrafo</button>
        </span>
      </div>`).join('')}
    <hr class="modal-hr">
    <h3>＋ Nuevo proyecto</h3>
    <div class="meta-grid">
      <label>Nombre</label><input id="npName" placeholder="Mi nueva historia" />
      <label>Tipo</label>
      <select id="npKind">${Object.entries(TEMPLATES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
    </div>
    <div class="modal-row">
      <button class="btn primary" id="npCreate">Crear proyecto</button>
      <button class="btn" id="npImport">Importar .boligrafo</button>
    </div>`);

  $('#npCreate').addEventListener('click', async () => {
    const name = $('#npName').value.trim();
    if (!name) return alert('Ponle nombre a tu historia ✍️');
    const p = await createProject(name, $('#npKind').value);
    await switchProject(p.id); closeModal();
  });
  $('#npImport').addEventListener('click', () => $('#importInput').click());
  $('#modal').addEventListener('click', async (e) => {
    const sw = e.target.closest('[data-switch]');
    const ex = e.target.closest('[data-export]');
    if (sw) { await switchProject(sw.dataset.switch); closeModal(); }
    if (ex) {
      const data = await exportProjectFile(ex.dataset.export);
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = data.project.name.replace(/\s+/g, '-').toLowerCase() + '.boligrafo';
      a.click(); URL.revokeObjectURL(a.href);
    }
  });
}
$('#importInput').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const pid = await importProjectFile(data);
    await switchProject(pid); closeModal();
    alert('Proyecto importado ✓');
  } catch (err) { alert('Error al importar: ' + err.message); }
  e.target.value = '';
});
async function switchProject(projectId) {
  await flushSave();
  S.project = await db.projects.get(projectId);
  localStorage.setItem('bg.lastProject', projectId);
  $('#projBtn').textContent = S.project.name;
  await reloadTree(); renderBinder();
  const first = S.tree.all.find((d) => d.type !== 'folder');
  S.currentDoc = null;
  if (first) openDoc(first.id);
}
$('#projBtn').addEventListener('click', openProjectModal);

// --- Ajustes ---
function openSettingsModal() {
  openModal(`
    <h3>⚙️ Ajustes</h3>
    <h4>Proyecto actual</h4>
    <div class="meta-grid">
      <label>Nombre</label><input id="setName" value="${esc(S.project.name)}" />
      <label>Meta/día</label><input id="setGoal" type="number" value="${S.project.dailyGoal}" />
    </div>
    <h4>Sincronización (Cloudflare Worker)</h4>
    <div class="meta-grid">
      <label>URL</label><input id="setSyncUrl" value="${esc(syncConfig.url)}" placeholder="https://boligrafo-sync.tu-cuenta.workers.dev" />
      <label>Token</label><input id="setSyncToken" type="password" value="${esc(syncConfig.token)}" placeholder="tu SYNC_TOKEN" />
    </div>
    <div class="empty-hint">Instrucciones de deploy del Worker en el README (carpeta worker/).</div>
    <div class="modal-row">
      <button class="btn primary" id="setSave">Guardar ajustes</button>
      <button class="btn" id="setSyncNow">⇅ Sincronizar ahora</button>
    </div>`);
  $('#setSave').addEventListener('click', async () => {
    S.project.name = $('#setName').value.trim() || S.project.name;
    S.project.dailyGoal = +$('#setGoal').value || 1000;
    S.project.updatedAt = Date.now();
    await db.projects.put(S.project);
    syncConfig.url = $('#setSyncUrl').value.trim();
    syncConfig.token = $('#setSyncToken').value.trim();
    $('#projBtn').textContent = S.project.name;
    startAutoSync(setSyncStatus);
    refreshGoal(); closeModal();
  });
  $('#setSyncNow').addEventListener('click', () => runSync());
}
$('#btnSettings').addEventListener('click', openSettingsModal);

// --- Sync UI ---
function setSyncStatus(msg) {
  const el = $('#syncState');
  el.style.display = ''; el.textContent = msg;
  clearTimeout(setSyncStatus._t);
  setSyncStatus._t = setTimeout(() => (el.style.display = 'none'), 4000);
}
async function runSync() {
  if (!syncEnabled()) return openSettingsModal();
  try {
    await flushSave();
    await syncNow(setSyncStatus);
    await reloadTree(); renderBinder();
    if (S.currentDoc) { const fresh = await db.docs.get(S.currentDoc.id); if (fresh && fresh.updatedAt > S.currentDoc.updatedAt) openDoc(fresh.id); }
  } catch (err) { setSyncStatus('Sync error: ' + err.message); }
}
$('#btnSync').addEventListener('click', runSync);

// ------------------------- Exportar MD ----------------------
function nodeToMd(node) {
  const kids = (node.content ?? []).map(nodeToMd).join('');
  switch (node.type) {
    case 'text': {
      let t = node.text ?? '';
      for (const m of node.marks ?? []) {
        if (m.type === 'bold') t = `**${t}**`;
        if (m.type === 'italic') t = `*${t}*`;
      }
      return t;
    }
    case 'paragraph': return kids + '\n\n';
    case 'heading': return '#'.repeat(node.attrs.level) + ' ' + kids + '\n\n';
    case 'bulletList': return (node.content ?? []).map((li) => '- ' + nodeToMd(li).trim() + '\n').join('') + '\n';
    case 'orderedList': return (node.content ?? []).map((li, i) => `${i + 1}. ` + nodeToMd(li).trim() + '\n').join('') + '\n';
    case 'listItem': return kids.trim();
    case 'blockquote': return kids.trim().split('\n').map((l) => '> ' + l).join('\n') + '\n\n';
    case 'horizontalRule': return '---\n\n';
    case 'image': return `![](${node.attrs?.src?.slice(0, 60)}…)\n\n`;
    case 'table': {
      const rows = (node.content ?? []).map((row) =>
        '| ' + (row.content ?? []).map((c) => nodeToMd(c).trim().replace(/\n+/g, ' ')).join(' | ') + ' |');
      if (rows.length > 1) rows.splice(1, 0, '|' + ' --- |'.repeat((node.content[0].content ?? []).length));
      return rows.join('\n') + '\n\n';
    }
    default: return kids;
  }
}

// ------------------------- UI global ------------------------
function toggleSidebar(which) {
  if (isMobile()) {
    const cls = which === 'binder' ? 'show-binder' : 'show-panel';
    const other = which === 'binder' ? 'show-panel' : 'show-binder';
    document.body.classList.remove(other);
    document.body.classList.toggle(cls);
  } else {
    document.body.classList.toggle(which === 'binder' ? 'hide-binder' : 'hide-panel');
    $('#btnBinder').classList.toggle('on', !document.body.classList.contains('hide-binder'));
    $('#btnPanel').classList.toggle('on', !document.body.classList.contains('hide-panel'));
  }
}
function closeMobilePanels() { document.body.classList.remove('show-binder', 'show-panel'); }
$('#btnBinder').addEventListener('click', () => toggleSidebar('binder'));
$('#btnPanel').addEventListener('click', () => toggleSidebar('panel'));
$('#mnavBinder').addEventListener('click', () => toggleSidebar('binder'));
$('#mnavPanel').addEventListener('click', () => toggleSidebar('panel'));
$('#mnavWrite').addEventListener('click', closeMobilePanels);
$('#scrim').addEventListener('click', closeMobilePanels);
$('#btnFocus').addEventListener('click', () => document.body.classList.toggle('focus-mode'));
$('#btnSnap').addEventListener('click', async () => { await flushSave(); await createSnapshot(S.currentDoc, 'manual'); renderSnapshots(); });
$('#btnComments').addEventListener('click', () => {
  const off = document.body.classList.toggle('hide-comments');
  $('#btnComments').classList.toggle('on', !off);
});
function setZoom(z) {
  S.zoom = Math.min(1.6, Math.max(0.7, +z.toFixed(2)));
  document.documentElement.style.setProperty('--zoom', S.zoom);
  $('#zoomVal').textContent = Math.round(S.zoom * 100) + '%';
  localStorage.setItem('bg.zoom', S.zoom);
}
$('#zoomIn').addEventListener('click', () => setZoom(S.zoom + 0.1));
$('#zoomOut').addEventListener('click', () => setZoom(S.zoom - 0.1));
document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(S.zoom + 0.1); }
  if (mod && e.key === '-') { e.preventDefault(); setZoom(S.zoom - 0.1); }
  if (mod && e.key === 's') { e.preventDefault(); flushSave(); }
  if (e.key === 'Escape') { document.body.classList.remove('focus-mode'); closeMobilePanels(); hideAutocomplete(); $('#ctxMenu').classList.remove('open'); }
});
window.addEventListener('beforeunload', () => { flushSave(); });

// ------------------------- Init -----------------------------
(async function init() {
  // Pide al navegador NO purgar IndexedDB (crítico en Safari).
  if (navigator.storage?.persist) {
    const granted = await navigator.storage.persist();
    console.log('Almacenamiento persistente:', granted ? '✓' : 'denegado (exporta .boligrafo seguido)');
  }

  await seedIfEmpty();
  const lastPid = localStorage.getItem('bg.lastProject');
  S.project = (lastPid && await db.projects.get(lastPid)) ?? (await db.projects.toArray())[0];
  $('#projBtn').textContent = S.project.name;

  await reloadTree();
  setZoom(+localStorage.getItem('bg.zoom') || 1);
  renderToolbar(); renderBinder();

  const lastId = localStorage.getItem('bg.lastDoc');
  const first = S.tree.all.find((d) => d.id === lastId) ??
    S.tree.all.find((d) => d.type === 'scene') ?? S.tree.all[0];
  if (first) openDoc(first.id);

  if (syncEnabled()) { runSync(); startAutoSync(setSyncStatus); }

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js');
  }
})();
