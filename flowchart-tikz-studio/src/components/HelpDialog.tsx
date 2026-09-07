import { SHORTCUTS } from '../hooks/useKeyboardShortcuts';

interface Props {
  onClose: () => void;
}

export function HelpDialog({ onClose }: Props) {
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
