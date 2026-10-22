import { useMemo } from 'react';
import { SHORTCUTS } from '../hooks/useKeyboardShortcuts';
import { shapeShortcutRows, shortcutLabel } from '../model/shortcuts';

interface Props {
  onClose: () => void;
}

export function HelpDialog({ onClose }: Props) {
  /*
   * The symbol table is derived from the same map the key handler reads, so
   * this list cannot describe a binding the application does not have.
   */
  const shapeGroups = useMemo(() => {
    const rows = shapeShortcutRows().filter((r) => r.shortcut);
    const order: string[] = [];
    const byCategory = new Map<string, typeof rows>();
    for (const row of rows) {
      if (!byCategory.has(row.category)) {
        byCategory.set(row.category, []);
        order.push(row.category);
      }
      byCategory.get(row.category)!.push(row);
    }
    return order.map((category) => ({ category, rows: byCategory.get(category)! }));
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header>
          <span className="eyebrow">Reference</span>
          <h2>Keyboard shortcuts</h2>
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="shortcut-grid">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="shortcut">
              <kbd>{s.keys}</kbd>
              <span>{s.description}</span>
            </div>
          ))}
        </div>

        <section className="help-notes">
          <h3>Symbols</h3>
          <p>
            Press a letter to arm that symbol, then click the canvas — exactly as
            if you had clicked it in the palette. Press it again to disarm.
            Letter shortcuts act on the <b>drawing board</b>, so they only fire
            while it has focus: click the canvas once and it takes a teal ring.
            While you are typing in a shape, the inspector or the code panel,
            letters are just letters. <kbd>{'⇧'}</kbd> means hold Shift.
          </p>
        </section>

        <div className="shape-key-table">
          {shapeGroups.map((group) => (
            <section key={group.category}>
              <h4>{group.category}</h4>
              <ul>
                {group.rows.map((row) => (
                  <li key={row.kind}>
                    <kbd>{shortcutLabel(row.shortcut!)}</kbd>
                    <span>{row.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <section className="help-notes">
          <h3>Handles on a shape</h3>
          <p>
            The <b>square teal handles</b> on the outline resize the shape. The{' '}
            <b>round blue points</b> floating just outside it start a connector —
            drag one onto another shape and the target point lights up red before
            you release. The two never overlap, so neither can be hit by mistake.
          </p>
          <h3>Working with the code</h3>
          <p>
            Select a shape and its generated lines light up on the left. Click any
            generated line to select the object that produced it.
          </p>
          <h3>Using the output in Overleaf</h3>
          <p>
            <b>Standalone</b> compiles on its own — paste it into a new Overleaf
            project as <code>main.tex</code> and press Recompile. <b>Snippet</b>
            {' '}drops into an existing document; copy the commented
            <code> \usepackage</code> and <code>\usetikzlibrary</code> lines into your
            preamble first.
          </p>
        </section>
      </div>
    </div>
  );
}
