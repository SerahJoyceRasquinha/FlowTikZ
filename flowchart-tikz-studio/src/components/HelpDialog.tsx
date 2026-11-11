import { useEffect, useRef } from 'react';
import { SHORTCUTS } from '../hooks/useKeyboardShortcuts';
import { Icon } from './Icon';

interface Props {
  onClose: () => void;
  onStartTour?: () => void;
}

export function HelpDialog({ onClose, onStartTour }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal help-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Help"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header>
          <span className="eyebrow">Help</span>
          <h2>How FlowTikZ works</h2>
          <button ref={closeRef} className="btn" onClick={onClose}>
            <Icon name="x" size={16} />
            Close
          </button>
        </header>

        {onStartTour && (
          <div className="help-tour-card">
            <span className="htc-icon">
              <Icon name="play" size={26} />
            </span>
            <div>
              <b>Guided tour (demo)</b>
              <span>
                An animated, step-by-step walkthrough that points at every part of the screen and shows what it
                does. Go back and forth at your own pace.
              </span>
            </div>
            <button className="btn primary" onClick={onStartTour} data-action="help-start-tour">
              Start the tour
            </button>
          </div>
        )}

        <section className="help-notes help-quickstart">
          <h3>Quick start</h3>
          <ol>
            <li>
              <b>Flowchart:</b> click a symbol in the <b>Flowchart symbols</b> list, then click the
              canvas. Double-click a shape to type in it. Drag from one of the round blue
              points next to a shape onto another shape to connect them.
            </li>
            <li>
              <b>Chart from data:</b> press <b>Chart from data</b> in the toolbar, load an Excel
              (.xlsx) or CSV file, pick a chart type and drag columns into <b>Axis</b>,{' '}
              <b>Values</b>, <b>Legend</b> and <b>Filters</b>. Press <b>Insert chart</b>.
            </li>
            <li>
              <b>Maths, physics, chemistry:</b> the <b>Σ</b>, atom and flask buttons open the
              formula editor, the circuit and physics parts (in the left panel) and the chemistry
              editors. Drag a circuit part onto the canvas and drag between its round terminals to
              wire it. Double-click anything you inserted to edit it again.
            </li>
            <li>
              The LaTeX on the left updates as you work. Press <b>Copy LaTeX</b> and paste it into
              Overleaf. The chart's data and field names travel inside the code, so the
              spreadsheet is not needed afterwards.
            </li>
          </ol>
        </section>

        <h3 className="help-subhead">Keyboard shortcuts</h3>
        <div className="shortcut-grid">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="shortcut">
              <kbd>{s.keys}</kbd>
              <span>{s.description}</span>
            </div>
          ))}
        </div>

        <section className="help-notes">
          <h3>Handles on a shape</h3>
          <p>
            The <b>square teal handles</b> on the outline resize the shape. The{' '}
            <b>round blue points</b> floating just outside it start a connector:
            drag one onto another shape and the target point lights up red before
            you release.
          </p>
          <h3>Charts</h3>
          <p>
            Select a chart to edit it in the panel on the right: change the chart type,
            the fields, the aggregation (sum, average, count, minimum, maximum,
            median, distinct count), filters, sorting, colours, labels and legend. Every
            change is reflected in the PGFPlots code immediately, using the same
            colours, numbers and labels you see on the canvas. Drag a chart's corner
            handles to resize it.
          </p>
          <h3>Working with the code</h3>
          <p>
            Select a shape or chart and its generated lines light up on the left. Click any
            generated line to select the object that produced it.
          </p>
          <h3>Menus and the selection bar</h3>
          <p>
            Use <b>File → Open</b> to reopen a saved diagram and <b>File → Import diagram</b> to turn a
            picture, SVG or draw.io file into editable shapes. When you select something, a bar with
            <b> Align, Arrange, Duplicate, Group, Lock</b> and <b>Delete</b> appears above the canvas.
          </p>
          <h3>Using the output in Overleaf</h3>
          <p>
            <b>Standalone</b> compiles on its own: paste it into a new Overleaf
            project as <code>main.tex</code> and press Recompile. <b>Snippet</b>
            {' '}drops into an existing document; copy the commented
            <code> \usepackage</code> lines into your preamble first.
          </p>
        </section>
      </div>
    </div>
  );
}
