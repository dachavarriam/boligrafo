# ✒️ Bolígrafo v1.0

Estudio de escritura **local-first** con sincronización multi-dispositivo.
Novelas, light novels, novellas, cuentos + worldbuilding con wikilinks bidireccionales.

## Arrancar en local

```bash
pnpm install
pnpm dev        # → http://localhost:5173
```

## Features completas

**Escritura:** editor TipTap (atajos markdown), toolbar táctil (funciona en cel), zoom ⌘+/−, modo enfoque, contador y meta diaria (solo palabras nuevas), estados de escena (idea→borrador→revisado→final), POV y lugar por escena.

**Worldbuilding:** fichas de mundo con tablas e imágenes (se reducen automáticamente a ~1400px), `[[wikilinks]]` **pintados y clickeables con autocompletado** — escribe `[[` y elige; si la ficha no existe, ofrece crearla. Backlinks automáticos en el panel.

**Organización:** binder con carpetas anidadas, menú ⋯ por documento (renombrar, subir/bajar, mover a carpeta, emoji), **papelera** con restaurar/borrado definitivo, multi-proyecto con plantillas (novela, light novel, novella, cuento).

**Seguridad de datos:** `storage.persist()` contra purgas del navegador, snapshots automáticos + manuales restaurables, exportar/importar **`.boligrafo`** (respaldo completo del proyecto), exportar manuscrito a Markdown.

**Notas:** post-its anclados a texto seleccionado (📝), visibles/ocultables (💬).

**Sync:** Cloudflare Worker + D1, last-write-wins por documento, auto-sync cada 90s, botón ⇅ manual. PWA instalable y offline.

## Salir a producción (30 min)

### 1. Frontend → Cloudflare Pages
```bash
pnpm build
# Sube dist/ con Wrangler o conecta el repo en el dashboard de Pages:
pnpm dlx wrangler pages deploy dist --project-name=boligrafo
```
Ya tienes tu PWA en `https://boligrafo.pages.dev` (o tu dominio `boligrafo.wembla.com`).
Instálala: en iPhone → Compartir → "Agregar a pantalla de inicio"; en Mac/Chrome → icono de instalar en la barra.

### 2. Backend de sync → Worker + D1
```bash
cd worker
pnpm dlx wrangler d1 create boligrafo          # copia el database_id a wrangler.toml
pnpm dlx wrangler d1 execute boligrafo --remote --file=schema.sql
pnpm dlx wrangler secret put SYNC_TOKEN        # inventa un token LARGO (32+ chars)
pnpm dlx wrangler deploy
```

### 3. Conectar
En la app: ⚙️ Ajustes → pega la URL del Worker y tu token → Guardar → ⇅.
Repite en cada dispositivo. Listo: Mac y celular sincronizados.

## Arquitectura

```
src/
├── main.js      → orquestador (estado → render → eventos)
├── db.js        → Dexie v2: docs (árbol, soft-delete), snapshots, links, sessions
├── editor.js    → TipTap + marca de comentarios + reducción de imágenes
├── wikilink.js  → decorations de ProseMirror: [[texto]] plano en disco, azul en pantalla
├── links.js     → índice de wikilinks (backlinks O(1))
├── sync.js      → cliente last-write-wins (updatedAt decide)
└── seed.js      → proyecto de ejemplo
worker/
├── index.js     → Worker puro: GET /pull, POST /push, Bearer auth, D1 batch atómico
├── schema.sql   → patrón "documento con índice" (JSON + updatedAt)
└── wrangler.toml
```

**Por qué last-write-wins:** eres un solo autor con 2 dispositivos. Un CRDT resolvería edición simultánea del mismo párrafo, pero cuesta 20× la complejidad para un caso que no tienes. El timestamp por documento resuelve tu caso real: escribes en la Mac, luego sigues en el cel.

## Roadmap futuro
Corkboard · timeline · export DOCX/EPUB · imágenes en R2 · IA consultora del mundo (pgvector) · recordatorios narrativos.
