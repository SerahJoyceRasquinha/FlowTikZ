import { useEditor } from '../state/store';
import { useTour } from '../state/tourStore';
import { requestImportPicker } from './emptyStateActions';
import { Icon } from './Icon';

/** Shown on a blank canvas: a friendly invitation to act, not decoration. */
export function EmptyState() {
  const armShape = useEditor((s) => s.armShape);
  const openChartBuilder = useEditor((s) => s.openChartBuilder);
  const startTour = useTour((t) => t.start);
  return (
    <div className="empty-state">
      <div className="empty-card">
        <span className="empty-badge" aria-hidden="true">
          <Icon name="sparkles" size={22} />
        </span>
        <h3>Let’s make something!</h3>
        <p className="empty-lede">Draw a flowchart or build a chart. The LaTeX code appears on the left as you go.</p>
        <ol>
          <li>
            <span className="num">1</span>
            <span>Pick a symbol from the list on the left, then click here.</span>
          </li>
          <li>
            <span className="num">2</span>
            <span>Double-click the shape to type in it.</span>
          </li>
          <li>
            <span className="num">3</span>
            <span>
              Drag a shape’s <b className="c-blue">blue dot</b> onto another shape to connect them.
            </span>
          </li>
        </ol>
        <div className="button-row">
          <button className="btn primary" onClick={() => armShape('terminator')}>
            <Icon name="plus" size={16} />
            Start a flowchart
          </button>
          <button className="btn primary alt" onClick={() => openChartBuilder({ mode: 'new' })}>
            Chart from Excel / CSV
          </button>
        </div>
        <div className="empty-links">
          <button className="link" onClick={() => requestImportPicker()}>
            <Icon name="image" size={15} />
            Import a picture or draw.io file
          </button>
          <button className="link" onClick={() => startTour(0)}>
            <Icon name="play" size={15} />
            Take the guided tour
          </button>
        </div>
      </div>
    </div>
  );
}
