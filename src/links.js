// ============================================================
// links.js — El sistema nervioso: [[wikilinks]] bidireccionales
// ------------------------------------------------------------
// Estrategia MVP (simple y robusta):
//  1. Al guardar un doc, extraemos todo su texto plano.
//  2. Regex encuentra cada [[Nombre]].
//  3. Reemplazamos las filas del índice `links` de ese doc.
//  4. Los backlinks de una ficha = query inversa por título.
//
// ¿Por qué indexar en tabla en vez de buscar en vivo?
// Buscar "¿quién menciona a Mara?" recorriendo TODOS los docs
// sería O(n·tamaño). Con el índice es una query directa. Es el
// mismo principio que un índice de base de datos.
// ============================================================
import { db, uid } from './db.js';

const WIKI_RE = /\[\[([^\[\]]+)\]\]/g;

export const normalize = (s) => s.trim().toLowerCase();

// Extrae texto plano de un documento TipTap (JSON) recursivamente
export function plainText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(plainText).join(' ');
}

export async function reindexLinks(doc) {
  const text = plainText(doc.content);
  const targets = new Set();
  for (const m of text.matchAll(WIKI_RE)) targets.add(normalize(m[1]));

  await db.transaction('rw', db.links, async () => {
    await db.links.where('fromId').equals(doc.id).delete();
    await db.links.bulkAdd(
      [...targets].map((toName) => ({ id: uid(), fromId: doc.id, toName }))
    );
  });
}

// ¿Qué docs mencionan este título? (backlinks)
export async function backlinksTo(title) {
  const rows = await db.links.where('toName').equals(normalize(title)).toArray();
  if (!rows.length) return [];
  const docs = await db.docs.bulkGet(rows.map((r) => r.fromId));
  return docs.filter(Boolean);
}

// ¿A qué fichas EXISTENTES apunta este doc? (menciones salientes)
export async function outgoingFrom(docId, projectId) {
  const rows = await db.links.where('fromId').equals(docId).toArray();
  if (!rows.length) return [];
  const all = await db.docs.where('projectId').equals(projectId).toArray();
  const byTitle = new Map(all.map((d) => [normalize(d.title), d]));
  return rows.map((r) => byTitle.get(r.toName)).filter(Boolean);
}
