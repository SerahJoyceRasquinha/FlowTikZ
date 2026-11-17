import { useEffect } from 'react';
import { useEditor } from '../state/store';
import { diagramBounds } from '../model/diagram';
import { Icon } from './Icon';
import { useProject } from '../state/projectStore';

/** Messages that report a problem are shown in red; everything else is a success. */
const PROBLEM = /fail|error|could not|cannot|can't|unsupported|invalid|not changed|warning/i;

export function StatusBar() {
  const doc = useEditor((s) => s.doc);
  const view = useEditor((s) => s.view);
  const selection = useEditor((s) => s.selection);
  const dirty = useEditor((s) => s.dirty);
  const status = useEditor((s) => s.statusMessage);
  const setStatus = useEditor((s) => s.setStatus);

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 3500);
    return () => clearTimeout(t);
  }, [status, setStatus]);

  const chartCount = Object.values(doc.nodes).filter((n) => n.kind === 'chart').length;
  const nodeCount = Object.keys(doc.nodes).length - chartCount;
  const edgeCount = Object.keys(doc.edges).length;
  const b = diagramBounds(doc);
  const problem = !!status && PROBLEM.test(status);
  // In a LaTeX project, "saved" means downloaded since the last change.
  const project = useProject((p) => p.project);
  const pjVersion = useProject((p) => p.version);
  const pjSaved = useProject((p) => p.savedVersion);
  const pjDirty = !!project && pjVersion !== pjSaved && useProject.getState().dirtyCount() > 0;
  const isDirty = project ? pjDirty : dirty;

  return (
    <>
      <div className="status-bar" data-tour="status">
        <span
          className={`save-state ${isDirty ? 'is-dirty' : 'is-saved'}`}
          title={
            project
              ? isDirty
                ? 'The document has changes you have not downloaded yet. Press Download .zip (Ctrl+S).'
                : 'Nothing new since the project was opened or last downloaded.'
              : dirty
                ? 'You have changes that are not saved to a file yet. Press Save (Ctrl+S).'
                : 'Everything is saved.'
          }
        >
          <span className="dot" data-dirty={isDirty ? '1' : '0'} />
          {project ? (isDirty ? 'Changes not downloaded' : 'No new changes') : dirty ? 'Unsaved changes' : 'All changes saved'}
        </span>
        <span className="sep" />
        <span className="doc-name">{project ? `${project.name} · ${project.mainPath}` : doc.name}</span>
        <span className="sep" />
        <span>
          {nodeCount} shape{nodeCount === 1 ? '' : 's'}
        </span>
        {chartCount > 0 && (
          <span>
            {chartCount} chart{chartCount === 1 ? '' : 's'}
          </span>
        )}
        <span>
          {edgeCount} connector{edgeCount === 1 ? '' : 's'}
        </span>
        <span>{selection.length} selected</span>
        <span className="spacer" />
        <span className="status-dim" title="Size of the drawing in diagram units">
          {Math.round(b.w)} × {Math.round(b.h)} du · {doc.settings.unitsPerCm} du/cm
        </span>
        <span>Zoom {Math.round(view.zoom * 100)}%</span>
      </div>
      {status && (
        <div className={`toast ${problem ? 'toast-danger' : 'toast-success'}`} role="status" aria-live="polite">
          <span className="toast-icon">
            <Icon name={problem ? 'x' : 'check'} size={15} stroke={3} />
          </span>
          {status}
        </div>
      )}
    </>
  );
}
