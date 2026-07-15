// ============================================================
// editor.js — El editor TipTap
// ============================================================
import { Editor, Mark, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Image from '@tiptap/extension-image';
import { Wikilink } from './wikilink.js';

// --- Marca de comentario (nota anclada) ----------------------
export const CommentMark = Mark.create({
  name: 'comment',
  addAttributes() {
    return {
      noteId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-note-id'),
        renderHTML: (attrs) => ({ 'data-note-id': attrs.noteId }),
      },
    };
  },
  parseHTML() { return [{ tag: 'span[data-note-id]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'cm' }), 0];
  },
  addCommands() {
    return {
      setComment: (noteId) => ({ commands }) => commands.setMark(this.name, { noteId }),
      unsetComment: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },
});

export function countWords(editor) {
  const t = editor.getText().trim();
  return t ? t.split(/\s+/).filter(Boolean).length : 0;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function createEditor({ element, content, onUpdate, onCommentClick, onWikilinkNavigate }) {
  return new Editor({
    element,
    content,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: 'Escribe aquí… usa [[Nombre]] para vincular fichas.' }),
      Table.configure({ resizable: false }),
      TableRow, TableHeader, TableCell,
      Image,
      CommentMark,
      Wikilink.configure({ onNavigate: onWikilinkNavigate }),
    ],
    editorProps: {
      attributes: { class: 'prose', spellcheck: 'true' },
      handleClickOn(view, pos, node, nodePos, event) {
        const el = event.target.closest?.('.cm');
        if (el && onCommentClick) {
          onCommentClick(el.getAttribute('data-note-id'));
          return true;
        }
        return false;
      },
    },
    onUpdate,
  });
}

// --- Imágenes: archivo → canvas (reducir) → dataURL ----------
// ¿Por qué reducir? Una foto de iPhone pesa 4-8 MB; incrustada
// tal cual haría el doc gigante (y el sync lento). A 1400px de
// ancho y JPEG 0.82 queda en ~150-300 KB: nítida y ligera.
export function fileToDataUrl(file, maxW = 1400) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = reject;
    img.src = url;
  });
}
