// ============================================================
// sync.js — Sincronización con Cloudflare Worker + D1
// ------------------------------------------------------------
// Estrategia: last-write-wins POR DOCUMENTO.
//   PULL: baja todo lo remoto con updatedAt > lastSync;
//         se aplica solo si es más nuevo que la copia local.
//   PUSH: sube todo lo local con updatedAt > lastSync.
// Como cada mutación local pone updatedAt=Date.now(), el doc
// más recientemente editado gana. Simple, predecible, y para
// un solo autor con 2 dispositivos: exactamente suficiente.
// ============================================================
import { db } from './db.js';

const cfg = {
  get url() { return localStorage.getItem('bg.sync.url') ?? ''; },
  set url(v) { localStorage.setItem('bg.sync.url', v); },
  get token() { return localStorage.getItem('bg.sync.token') ?? ''; },
  set token(v) { localStorage.setItem('bg.sync.token', v); },
  get lastAt() { return +(localStorage.getItem('bg.sync.lastAt') ?? 0); },
  set lastAt(v) { localStorage.setItem('bg.sync.lastAt', String(v)); },
};
export const syncConfig = cfg;
export const syncEnabled = () => !!(cfg.url && cfg.token);

async function api(path, options = {}) {
  const res = await fetch(cfg.url.replace(/\/$/, '') + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.token}`,
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`Sync ${path}: HTTP ${res.status}`);
  return res.json();
}

export async function syncNow(onStatus = () => {}) {
  if (!syncEnabled()) throw new Error('Configura URL y token en Ajustes primero');
  const startedAt = Date.now();
  onStatus('Bajando cambios…');

  // ---- PULL ----
  const remote = await api(`/pull?since=${cfg.lastAt}`);
  let applied = 0;
  for (const rp of remote.projects ?? []) {
    const local = await db.projects.get(rp.id);
    if (!local || rp.updatedAt > local.updatedAt) { await db.projects.put(rp); applied++; }
  }
  for (const rd of remote.docs ?? []) {
    const local = await db.docs.get(rd.id);
    if (!local || rd.updatedAt > local.updatedAt) { await db.docs.put(rd); applied++; }
  }

  // ---- PUSH ----
  onStatus('Subiendo cambios…');
  const projects = (await db.projects.toArray()).filter((p) => p.updatedAt > cfg.lastAt);
  const docs = (await db.docs.toArray()).filter((d) => d.updatedAt > cfg.lastAt);
  if (projects.length || docs.length) {
    await api('/push', { method: 'POST', body: JSON.stringify({ projects, docs }) });
  }

  cfg.lastAt = startedAt;
  onStatus(`Sync ✓ (↓${applied} ↑${projects.length + docs.length})`);
  return { pulled: applied, pushed: projects.length + docs.length };
}

// Auto-sync: cada 90s si está configurado y hay conexión.
let timer = null;
export function startAutoSync(onStatus) {
  stopAutoSync();
  if (!syncEnabled()) return;
  timer = setInterval(() => {
    if (navigator.onLine) syncNow(onStatus).catch(() => onStatus('Sync sin conexión'));
  }, 90_000);
}
export function stopAutoSync() { if (timer) clearInterval(timer); timer = null; }
