// ============================================================
// Bolígrafo Sync — Cloudflare Worker + D1
// ------------------------------------------------------------
// Sin frameworks: un Worker puro. Dos endpoints:
//   GET  /pull?since=<ms>  → cambios remotos desde ese momento
//   POST /push             → guarda cambios del cliente
// Auth: Bearer token (secret SYNC_TOKEN). Un solo usuario: tú.
//
// Deploy:
//   cd worker
//   pnpm dlx wrangler d1 create boligrafo        # copia el id a wrangler.toml
//   pnpm dlx wrangler d1 execute boligrafo --remote --file=schema.sql
//   pnpm dlx wrangler secret put SYNC_TOKEN      # inventa un token largo
//   pnpm dlx wrangler deploy
// ============================================================

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  // CORS: la PWA vive en otro dominio (Pages), el Worker en otro.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: JSON_HEADERS });

    // --- Auth ---
    const auth = request.headers.get('Authorization') ?? '';
    if (auth !== `Bearer ${env.SYNC_TOKEN}`) return json({ error: 'unauthorized' }, 401);

    // --- GET /pull?since=ms ---
    if (request.method === 'GET' && url.pathname === '/pull') {
      const since = Number(url.searchParams.get('since') ?? 0);
      const projects = await env.DB
        .prepare('SELECT data FROM projects WHERE updatedAt > ?').bind(since).all();
      const docs = await env.DB
        .prepare('SELECT data FROM docs WHERE updatedAt > ?').bind(since).all();
      return json({
        projects: projects.results.map((r) => JSON.parse(r.data)),
        docs: docs.results.map((r) => JSON.parse(r.data)),
      });
    }

    // --- POST /push {projects:[], docs:[]} ---
    if (request.method === 'POST' && url.pathname === '/push') {
      const body = await request.json();
      const stmts = [];
      for (const p of body.projects ?? []) {
        stmts.push(env.DB
          .prepare(`INSERT INTO projects (id, updatedAt, data) VALUES (?1, ?2, ?3)
                    ON CONFLICT(id) DO UPDATE SET updatedAt=?2, data=?3
                    WHERE excluded.updatedAt > projects.updatedAt`)
          .bind(p.id, p.updatedAt, JSON.stringify(p)));
      }
      for (const d of body.docs ?? []) {
        stmts.push(env.DB
          .prepare(`INSERT INTO docs (id, projectId, updatedAt, data) VALUES (?1, ?2, ?3, ?4)
                    ON CONFLICT(id) DO UPDATE SET updatedAt=?3, data=?4
                    WHERE excluded.updatedAt > docs.updatedAt`)
          .bind(d.id, d.projectId, d.updatedAt, JSON.stringify(d)));
      }
      // batch = transacción atómica en D1 (todo o nada)
      if (stmts.length) await env.DB.batch(stmts);
      return json({ ok: true, saved: stmts.length });
    }

    return json({ error: 'not found' }, 404);
  },
};
