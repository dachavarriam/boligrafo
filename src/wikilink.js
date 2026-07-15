// ============================================================
// wikilink.js — Extensión TipTap para [[wikilinks]] visuales
// ------------------------------------------------------------
// ProseMirror tiene "decorations": estilos visuales que NO
// forman parte del documento. Perfecto aquí — el texto guardado
// sigue siendo "[[Mara]]" plano (portable, exportable), pero en
// pantalla se ve azul y clickeable. Separar dato de presentación
// es lo que hace esto robusto.
// ============================================================
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const WIKI_RE = /\[\[([^\[\]]+)\]\]/g;

function buildDecorations(doc) {
  const decos = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const m of node.text.matchAll(WIKI_RE)) {
      const from = pos + m.index;
      const to = from + m[0].length;
      decos.push(
        Decoration.inline(from, to, {
          class: 'wikilink',
          'data-wikilink': m[1].trim(),
        })
      );
    }
  });
  return DecorationSet.create(doc, decos);
}

export const Wikilink = Extension.create({
  name: 'wikilink',

  addOptions() {
    return { onNavigate: null };
  },

  addProseMirrorPlugins() {
    const { onNavigate } = this.options;
    return [
      new Plugin({
        key: new PluginKey('wikilink'),
        state: {
          init: (_, { doc }) => buildDecorations(doc),
          // Solo recalculamos si el doc cambió (rendimiento):
          apply: (tr, old) => (tr.docChanged ? buildDecorations(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
          handleClick(view, pos, event) {
            const el = event.target.closest?.('[data-wikilink]');
            if (el && onNavigate) {
              onNavigate(el.getAttribute('data-wikilink'));
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
