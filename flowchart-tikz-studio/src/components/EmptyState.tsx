import { useEditor } from '../state/store';

/** Shown on a blank canvas: an invitation to act, not decoration. */
export function EmptyState() {
  const armShape = useEditor((s) => s.armShape);
  return (
    <div className="empty-state">
      <div className="empty-card">
        <span className="eyebrow">Empty canvas</span>
        <h3>Place a shape and the TikZ appears</h3>
        <ol>
          <li>Pick a symbol from the palette on the left, then click the canvas.</li>
          <li>Double-click a shape to type into it.</li>
          <li>Drag from a shape's edge dot to another shape to connect them.</li>
        </ol>
        <button className="btn primary" onClick={() => armShape('terminator')}>
          Start with a terminator
        </button>
      </div>
    </div>
  );
}
