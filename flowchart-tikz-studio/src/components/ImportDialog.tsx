import { useEffect, useRef } from 'react';
import { useEditor } from '../state/store';
import { useImport } from '../state/importStore';
import { chooseImportMode } from '../import/controller';
import { formatBytes } from '../import/validation';
import { extensionOf } from '../import/detector';

/**
 * Asked only when the canvas already holds work: where should the imported
 * diagram go? Replacing is one undoable step, inserting never touches the
 * existing objects, and opening as a new document is the one choice that
 * discards history - which is said plainly next to it.
 */
export function ImportDialog() {
  const file = useImport((s) => s.pending);
  const dirty = useEditor((s) => s.dirty);
  const count = useEditor((s) => s.doc.order.length);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, [file]);

  if (!file) return null;
  const ext = extensionOf(file.name).toUpperCase() || 'file';

  return (
    <div
      className="modal-backdrop"
      onClick={() => chooseImportMode(null)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          chooseImportMode(null);
        }
      }}
    >
      <div
        className="modal import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <span className="eyebrow">Import {ext}</span>
          <h2 id="import-dialog-title">Where should “{file.name}” go?</h2>
          <button className="btn ghost" onClick={() => chooseImportMode(null)}>
            Cancel
          </button>
        </header>
        <p className="import-dialog-lede">
          The canvas already has {count} object{count === 1 ? '' : 's'}
          {dirty ? ', with unsaved changes' : ''}. The imported file ({formatBytes(file.size)}) becomes fully
          editable shapes and connectors in any case.
        </p>
        <div className="import-choices">
          <button ref={first} className="import-choice" data-mode="replace" onClick={() => chooseImportMode('replace')}>
            <b>Replace current diagram</b>
            <span>Swap the canvas contents for the import. One Ctrl+Z brings your diagram back.</span>
          </button>
          <button className="import-choice" data-mode="insert" onClick={() => chooseImportMode('insert')}>
            <b>Insert into current diagram</b>
            <span>Add the import beside your existing work, selected, so it can be moved as one.</span>
          </button>
          <button className="import-choice" data-mode="new" onClick={() => chooseImportMode('new')}>
            <b>Open as new document</b>
            <span>
              Start a fresh document from the import.
              {dirty ? ' Unsaved changes in the current diagram will be discarded and cannot be undone.' : ''}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
