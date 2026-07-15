// ============================================================
// db.js — Base de datos local (IndexedDB via Dexie)
// ------------------------------------------------------------
// v2: soft-delete (papelera), multi-proyecto, timestamps
// listos para sincronización last-write-wins.
//
// Regla de oro del sync: TODA mutación pasa por touch()/update
// con updatedAt = Date.now(). Ese timestamp decide quién gana.
// ============================================================
import Dexie from 'dexie';

export const db = new Dexie('boligrafo');

// Nota Dexie: los índices no soportan booleanos → deleted es 0/1.
db.version(2).stores({
  projects: 'id, updatedAt',
  docs: 'id, projectId, parentId, updatedAt, deleted',
  snapshots: 'id, docId, createdAt',
  links: 'id, fromId, toName',
  sessions: 'id',
});

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const today = () => new Date().toISOString().slice(0, 10);
export const now = () => Date.now();

// --- Proyectos -------------------------------------------------
export const TEMPLATES = {
  novela: {
    label: 'Novela', goal: 1000,
    folders: [{ t: 'Parte I', kids: ['Capítulo 1'] }],
  },
  'light-novel': {
    label: 'Light novel', goal: 1500,
    folders: [{ t: 'Volumen 1', kids: ['Prólogo', 'Capítulo 1'] }],
  },
  novella: {
    label: 'Novella', goal: 800,
    folders: [{ t: 'Acto I', kids: ['Escena 1'] }],
  },
  cuento: {
    label: 'Cuento / Short story', goal: 500,
    folders: [{ t: 'Borradores', kids: ['Borrador 1'] }],
  },
};

export async function createProject(name, kind = 'novela') {
  const tpl = TEMPLATES[kind] ?? TEMPLATES.novela;
  const project = { id: uid(), name, kind, dailyGoal: tpl.goal, createdAt: now(), updatedAt: now() };
  await db.projects.add(project);

  const manuscrito = await createDoc({ projectId: project.id, type: 'folder', title: 'Manuscrito', emoji: '✒️', order: 1 });
  const mundo = await createDoc({ projectId: project.id, type: 'folder', title: 'Mundo', emoji: '🌍', order: 2 });
  await createDoc({ projectId: project.id, parentId: mundo.id, type: 'world', title: 'Personaje ejemplo', emoji: '👤', order: 1 });

  let order = 1;
  for (const f of tpl.folders) {
    const folder = await createDoc({ projectId: project.id, parentId: manuscrito.id, type: 'folder', title: f.t, order: order++ });
    let ko = 1;
    for (const k of f.kids) {
      await createDoc({ projectId: project.id, parentId: folder.id, type: 'scene', title: k, order: ko++ });
    }
  }
  return project;
}

// --- Docs -----------------------------------------------------
export async function createDoc(partial) {
  const doc = {
    id: uid(),
    projectId: partial.projectId,
    parentId: partial.parentId ?? null,
    order: partial.order ?? now(),
    type: partial.type ?? 'scene',
    title: partial.title ?? 'Sin título',
    emoji: partial.emoji ?? (partial.type === 'folder' ? '📖' : partial.type === 'world' ? '🌍' : '📄'),
    meta: partial.meta ?? { status: 'idea', pov: '', location: '', notes: [] },
    content: partial.content ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    words: partial.words ?? 0,
    deleted: 0,
    updatedAt: now(),
  };
  await db.docs.add(doc);
  return doc;
}

export async function touchDoc(docId, changes) {
  await db.docs.update(docId, { ...changes, updatedAt: now() });
}

export async function saveDocContent(docId, content, words) {
  await touchDoc(docId, { content, words });
}

export async function docTree(projectId) {
  const all = (await db.docs.where('projectId').equals(projectId).toArray())
    .filter((d) => !d.deleted);
  all.sort((a, b) => a.order - b.order);
  const byParent = new Map();
  for (const d of all) {
    const key = d.parentId ?? 'root';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(d);
  }
  return { all, byParent };
}

export async function trashedDocs(projectId) {
  return (await db.docs.where('projectId').equals(projectId).toArray())
    .filter((d) => d.deleted === 1);
}

// Soft delete: el doc (y sus hijos, recursivo) van a la papelera.
export async function trashDoc(docId) {
  const kids = await db.docs.where('parentId').equals(docId).toArray();
  for (const k of kids) await trashDoc(k.id);
  await touchDoc(docId, { deleted: 1 });
}
export async function restoreDoc(docId) {
  await touchDoc(docId, { deleted: 0 });
}
export async function purgeDoc(docId) {
  await db.snapshots.where('docId').equals(docId).delete();
  await db.links.where('fromId').equals(docId).delete();
  await db.docs.delete(docId);
}

// --- Snapshots -------------------------------------------------
export async function createSnapshot(doc, reason = 'auto') {
  await db.snapshots.add({
    id: uid(), docId: doc.id, createdAt: now(),
    reason, words: doc.words, content: doc.content,
  });
  const list = await db.snapshots.where('docId').equals(doc.id).sortBy('createdAt');
  if (list.length > 30) {
    await db.snapshots.bulkDelete(list.slice(0, list.length - 30).map((s) => s.id));
  }
}

// --- Sesiones ---------------------------------------------------
export async function addWordsToday(delta) {
  if (delta <= 0) return;
  const id = today();
  const s = await db.sessions.get(id);
  if (s) await db.sessions.update(id, { words: s.words + delta });
  else await db.sessions.add({ id, words: delta });
}
export async function wordsToday() {
  return (await db.sessions.get(today()))?.words ?? 0;
}

// --- Export / Import .boligrafo ---------------------------------
export async function exportProjectFile(projectId) {
  const project = await db.projects.get(projectId);
  const docs = await db.docs.where('projectId').equals(projectId).toArray();
  const snapshots = [];
  for (const d of docs) {
    snapshots.push(...(await db.snapshots.where('docId').equals(d.id).toArray()));
  }
  return { format: 'boligrafo', version: 2, exportedAt: now(), project, docs, snapshots };
}

export async function importProjectFile(data) {
  if (data.format !== 'boligrafo') throw new Error('No es un archivo .boligrafo válido');
  // Importa como copia con IDs nuevos → nunca pisa lo existente.
  const idMap = new Map();
  const newProjectId = uid();
  await db.projects.add({ ...data.project, id: newProjectId, name: data.project.name + ' (importado)', updatedAt: now() });
  for (const d of data.docs) idMap.set(d.id, uid());
  for (const d of data.docs) {
    await db.docs.add({
      ...d,
      id: idMap.get(d.id),
      projectId: newProjectId,
      parentId: d.parentId ? idMap.get(d.parentId) ?? null : null,
      updatedAt: now(),
    });
  }
  for (const s of data.snapshots ?? []) {
    if (idMap.has(s.docId)) await db.snapshots.add({ ...s, id: uid(), docId: idMap.get(s.docId) });
  }
  return newProjectId;
}
