import { useEffect } from 'react';
import { useEditor } from '../state/store';
import { diagramBounds } from '../model/diagram';

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

  const nodeCount = Object.keys(doc.nodes).length;
  const edgeCount = Object.keys(doc.edges).length;
  const b = diagramBounds(doc);

  return (
    <div className="status-bar">
      <span className="dot" data-dirty={dirty ? '1' : '0'} />
      <span>{doc.name}</span>
      <span className="sep" />
      <span>{nodeCount} shapes</span>
      <span>{edgeCount} connectors</span>
      <span>{selection.length} selected</span>
      <span className="sep" />
      <span>
        {Math.round(b.w)} x {Math.round(b.h)} du
      </span>
      <span>{doc.settings.unitsPerCm} du/cm</span>
      <span>{Math.round(view.zoom * 100)}%</span>
      <span className="spacer" />
      {status && <span className="status-msg">{status}</span>}
    </div>
  );
}
