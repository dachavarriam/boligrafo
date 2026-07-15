// ============================================================
// seed.js — Datos de ejemplo la primera vez que abres la app
// ============================================================
import { db, uid, createDoc } from './db.js';
import { reindexLinks } from './links.js';

const p = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const h2 = (text) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] });

export async function seedIfEmpty() {
  if (await db.projects.count()) return (await db.projects.toArray())[0];

  const project = {
    id: uid(),
    name: 'La Ciudad de las Mareas',
    kind: 'novela', // novela | light-novel | novella | cuento
    dailyGoal: 1000,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.projects.add(project);

  // --- Estructura raíz ---
  const manuscrito = await createDoc({ projectId: project.id, type: 'folder', title: 'Manuscrito', emoji: '✒️', order: 1 });
  const mundo = await createDoc({ projectId: project.id, type: 'folder', title: 'Mundo', emoji: '🌍', order: 2 });

  const parte1 = await createDoc({ projectId: project.id, parentId: manuscrito.id, type: 'folder', title: 'Parte I — El Puerto', order: 1 });

  const escena = await createDoc({
    projectId: project.id,
    parentId: parte1.id,
    type: 'scene',
    title: 'El faro apagado',
    order: 2,
    meta: { status: 'borrador', pov: 'Mara', location: 'Puerto de Alcandora', notes: [] },
    content: {
      type: 'doc',
      content: [
        p('El faro llevaba tres noches sin encenderse, y nadie en [[Alcandora]] parecía dispuesto a hablar de ello. [[Mara Solís]] caminó por el muelle con el abrigo cerrado hasta el cuello, contando los barcos amarrados como quien cuenta las horas de un insomnio.'),
        p('—Ya nadie sube ahí —dijo una voz a su espalda. Era [[Tomás Reyes]], el viejo farero—. Desde lo de la marea grande, la ciudad prefiere la oscuridad.'),
        p(''),
      ],
    },
  });
  await createDoc({ projectId: project.id, parentId: parte1.id, type: 'scene', title: 'La llegada de Mara', order: 1, meta: { status: 'idea', pov: 'Mara', location: '', notes: [] } });

  // --- Fichas de mundo ---
  await createDoc({
    projectId: project.id, parentId: mundo.id, type: 'world', title: 'Alcandora', emoji: '🏛️', order: 1,
    content: { type: 'doc', content: [
      p('Ciudad portuaria construida sobre siete plataformas que suben y bajan con la marea. Sus habitantes miden el tiempo en pleamares.'),
      h2('Datos'),
      { type: 'table', content: [
        { type: 'tableRow', content: [
          { type: 'tableHeader', content: [p('Dato')] },
          { type: 'tableHeader', content: [p('Valor')] },
        ]},
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [p('Población')] },
          { type: 'tableCell', content: [p('~48,000')] },
        ]},
        { type: 'tableRow', content: [
          { type: 'tableCell', content: [p('Gobierno')] },
          { type: 'tableCell', content: [p('Consejo de las Siete Plataformas')] },
        ]},
      ]},
      h2('Notas'),
      p('El faro apagado es su símbolo roto. Ver también [[Tomás Reyes]].'),
    ]},
  });
  await createDoc({ projectId: project.id, parentId: mundo.id, type: 'world', title: 'Mara Solís', emoji: '👤', order: 2,
    content: { type: 'doc', content: [p('Protagonista, 27 años. Cartógrafa que regresa a [[Alcandora]] tras la muerte de su madre. Guarda un mapa inacabado.')] } });
  await createDoc({ projectId: project.id, parentId: mundo.id, type: 'world', title: 'Tomás Reyes', emoji: '👤', order: 3,
    content: { type: 'doc', content: [p('Último farero de [[Alcandora]]. Sabe por qué se apagó el faro, pero un juramento antiguo le impide decirlo.')] } });

  // indexar wikilinks de los docs sembrados
  for (const d of await db.docs.where('projectId').equals(project.id).toArray()) {
    await reindexLinks(d);
  }
  return project;
}
