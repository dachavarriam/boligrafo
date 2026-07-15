-- Bolígrafo Sync — esquema D1
-- Guardamos el objeto completo como JSON (columna data) y solo
-- indexamos lo que consultamos: id + updatedAt. Patrón "documento
-- con índice" — máxima flexibilidad, cero migraciones al agregar
-- campos al cliente.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  updatedAt INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS docs (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docs_updated ON docs(updatedAt);
CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updatedAt);
