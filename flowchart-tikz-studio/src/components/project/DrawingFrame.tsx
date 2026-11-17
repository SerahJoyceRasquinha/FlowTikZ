import { useEffect, useRef, useState } from 'react';
import { useProject } from '../../state/projectStore';
import { useEditor } from '../../state/store';
import { CanvasStage } from '../../canvas/CanvasStage';
import { SelectionBar } from '../SelectionBar';
import { ErrorBoundary } from '../ErrorBoundary';
import { Icon } from '../Icon';

/**
 * The drawing board, opened inside the page at the chosen spot. It is the
 * full editor - palette, inspector, templates, maths and chemistry all work -
 * and the text below it is pushed down for as long as it is open.
 */
export function DrawingFrame({ widthPx }: { widthPx: number }) {
  const frame = useProject((s) => s.frame);
  const update = useProject((s) => s.updateFrame);
  const cancel = useProject((s) => s.cancelFrame);
  const commit = useProject((s) => s.commitFrame);
  const count = useEditor((s) => s.doc.order.length);
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ y: number; h: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      update({ height: Math.max(240, Math.min(1400, d.h + e.clientY - d.y)) });
    };
    const onUp = () => {
      drag.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [update]);

  if (!frame) return null;
  const doCommit = async () => {
    setBusy(true);
    await commit();
    setBusy(false);
  };

  return (
    <div
      className="tx-frame"
      ref={ref}
      style={{ width: widthPx }}
      role="region"
      aria-label="Drawing in the document"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Ctrl+Enter inserts, as in the other editors.
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !(e.target as HTMLElement).closest('.text-overlay')) {
          e.preventDefault();
          void doCommit();
        }
      }}
    >
      <div className="tx-frame-head">
        <span className="tx-frame-title">
          <Icon name="sparkles" size={15} /> {frame.mode === 'edit' ? 'Editing drawing' : 'New drawing'}
        </span>
        <label className="tx-frame-caption">
          <span>Caption</span>
          <input
            value={frame.caption}
            placeholder="Optional, e.g. Login process"
            onChange={(e) => update({ caption: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label="Figure caption"
            data-native-undo=""
          />
        </label>
        <div className="segmented small" role="group" aria-label="Placement">
          <button
            className={frame.placement === 'here' ? 'on' : ''}
            onClick={() => update({ placement: 'here' })}
            title="Exactly here: the drawing stays at this spot in the text"
            aria-pressed={frame.placement === 'here'}
          >
            Exactly here
          </button>
          <button
            className={frame.placement === 'float' ? 'on' : ''}
            onClick={() => update({ placement: 'float' })}
            title="As a floating figure, placed by LaTeX like the document's other figures"
            aria-pressed={frame.placement === 'float'}
          >
            Floating figure
          </button>
        </div>
        <span className="spacer" />
        <button className="btn tiny" onClick={cancel} data-action="frame-cancel">
          Cancel
        </button>
        <button className="btn tiny success" onClick={() => void doCommit()} disabled={busy || count === 0} data-action="frame-insert" title="Put the drawing into the document (Ctrl+Enter)">
          <Icon name="check" size={14} /> {frame.mode === 'edit' ? 'Save changes' : 'Insert into document'}
        </button>
      </div>
      <div className="canvas-wrap tx-frame-canvas" style={{ height: frame.height }}>
        <ErrorBoundary area="Canvas">
          <CanvasStage onReady={() => undefined} />
        </ErrorBoundary>
        <SelectionBar />
        {count === 0 && (
          <div className="tx-frame-empty" aria-hidden="true">
            Pick a symbol on the left (or <b>Templates</b>, <b>Math</b>, <b>Physics</b>, <b>Chem</b>) and click here to draw.
          </div>
        )}
      </div>
      <div
        className="tx-frame-resize"
        role="separator"
        aria-label="Resize the drawing area"
        onPointerDown={(e) => {
          drag.current = { y: e.clientY, h: frame.height };
          e.preventDefault();
        }}
        title="Drag to make the drawing area taller or shorter"
      />
    </div>
  );
}
