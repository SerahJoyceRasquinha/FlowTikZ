import { useEffect, useRef, useState } from 'react';
import { useProject } from '../../state/projectStore';
import { Icon } from '../Icon';

/**
 * Feedback while a LaTeX project zip opens: progress, a clear message when it
 * cannot be opened (with what was found), and a choice of main file when the
 * archive holds more than one complete document.
 */
export function ProjectImportDialog() {
  const importing = useProject((s) => s.importing);
  const pending = useProject((s) => s.pending);
  const dismiss = useProject((s) => s.dismissImport);
  const confirm = useProject((s) => s.confirmMain);
  const [choice, setChoice] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setChoice(pending?.detection.candidates[0]?.path ?? null);
  }, [pending]);
  useEffect(() => {
    if (importing?.error || pending) (ref.current?.querySelector('[data-autofocus]') as HTMLElement | null)?.focus();
  }, [importing?.error, pending]);

  if (pending) {
    return (
      <div className="modal-backdrop">
        <div className="modal pj-modal" role="dialog" aria-modal="true" aria-label="Choose the main file" ref={ref} onKeyDown={(e) => e.key === 'Escape' && dismiss()}>
          <header>
            <span className="eyebrow">LaTeX project</span>
            <h2>Which file is the main document?</h2>
          </header>
          <p className="note">
            This zip has more than one file with <code>\documentclass</code> and <code>\begin{'{'}document{'}'}</code>. Pick the one you
            compile; you can change it later in the Files list.
          </p>
          <div className="pj-candidates" role="radiogroup" aria-label="Main file">
            {pending.detection.candidates.map((c) => (
              <label key={c.path} className={`pj-candidate${choice === c.path ? ' on' : ''}`}>
                <input type="radio" name="main" checked={choice === c.path} onChange={() => setChoice(c.path)} />
                <span>
                  <b>{c.path}</b>
                  <span className="note">
                    {c.className ? `\\documentclass{${c.className}}` : ''}
                    {c.reasons.length ? ` · ${c.reasons.join(', ')}` : ''}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <footer className="pj-foot">
            <button className="btn" onClick={dismiss}>
              Cancel
            </button>
            <button className="btn primary" disabled={!choice} onClick={() => choice && confirm(choice)} data-autofocus data-action="confirm-main">
              Open with this main file
            </button>
          </footer>
        </div>
      </div>
    );
  }

  if (!importing) return null;
  const p = importing.progress;
  if (importing.error) {
    return (
      <div className="modal-backdrop">
        <div className="modal pj-modal" role="alertdialog" aria-modal="true" aria-label="The project could not be opened" ref={ref} onKeyDown={(e) => e.key === 'Escape' && dismiss()}>
          <header>
            <span className="eyebrow">LaTeX project</span>
            <h2>
              <Icon name="x" size={18} /> {importing.name} could not be opened
            </h2>
          </header>
          <p className="pj-error" data-testid="project-error">
            {importing.error.message}
          </p>
          {importing.error.details.length > 0 && (
            <details open>
              <summary>What was found</summary>
              <ul className="pj-details">
                {importing.error.details.map((d, i) => (
                  <li key={i}>
                    <code>{d}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="note">
            A LaTeX project zip is what Overleaf gives you under <b>Menu → Download → Source</b>: the main <code>.tex</code> file with
            its folders of chapters and figures.
          </p>
          <footer className="pj-foot">
            <button className="btn primary" onClick={dismiss} data-autofocus>
              OK
            </button>
          </footer>
        </div>
      </div>
    );
  }
  const pct = p && p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <div className="modal-backdrop">
      <div className="modal pj-modal" role="dialog" aria-modal="true" aria-label="Opening the project" aria-busy="true">
        <header>
          <span className="eyebrow">LaTeX project</span>
          <h2>Opening {importing.name}…</h2>
        </header>
        <div className="pj-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <i style={{ width: `${p?.stage === 'reading' ? 5 : p?.stage === 'detecting' ? 100 : pct}%` }} />
        </div>
        <p className="note">
          {!p || p.stage === 'reading'
            ? 'Reading the list of files…'
            : p.stage === 'scanning'
              ? `Reading the LaTeX files: ${p.done} of ${p.total}${p.detail ? ` (${p.detail})` : ''}`
              : 'Finding the main file…'}
        </p>
        <p className="note">Nothing is uploaded: the zip is read here in your browser.</p>
      </div>
    </div>
  );
}
