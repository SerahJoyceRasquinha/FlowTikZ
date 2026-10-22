import { useRef, useState } from 'react';
import { useEditor } from '../state/store';
import { serialize, deserialize, LoadError } from '../persistence/schema';
import { downloadText, downloadBlob, readFileAsText, slugify } from '../export/file';
import { buildSvgString } from '../export/svg';
import { exportPng } from '../export/raster';
import { exportPdf } from '../export/pdf';
import { clearAutosave } from '../persistence/autosave';
import { requestImport } from '../import/controller';
import { IMPORT_ACCEPT, SUPPORTED_SUMMARY } from '../import/detector';
import { useImport } from '../state/importStore';

interface Props {
  svgRef: React.MutableRefObject<SVGSVGElement | null>;
  onShowHelp: () => void;
  canvasSize: { width: number; height: number };
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="tool-group" role="group" aria-label={label}>
      {children}
    </div>
  );
}

export function Toolbar({ svgRef, onShowHelp, canvasSize }: Props) {
  const s = useEditor();
  const fileInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const importing = useImport((st) => st.session?.status === 'running');
  const [exportOpen, setExportOpen] = useState(false);

  const hasSelection = s.selection.length > 0;
  const multi = s.selection.length > 1;

  const doExport = async (kind: 'svg' | 'png' | 'pdf') => {
    setExportOpen(false);
    const svg = svgRef.current;
    if (!svg) return;
    const name = slugify(s.doc.name);
    try {
      if (kind === 'svg') {
        downloadText(buildSvgString(svg, s.doc), `${name}.svg`, 'image/svg+xml');
        s.setStatus(`Saved ${name}.svg`);
      } else if (kind === 'png') {
        const blob = await exportPng(svg, s.doc, 2);
        downloadBlob(blob, `${name}.png`);
        s.setStatus(`Saved ${name}.png`);
      } else {
        exportPdf(svg, s.doc);
      }
    } catch (err) {
      s.setStatus(err instanceof Error ? err.message : 'Export failed.');
    }
  };

  const saveJson = () => {
    downloadText(serialize(s.doc), `${slugify(s.doc.name)}.json`, 'application/json');
    s.markSaved();
    s.setStatus('Diagram saved as JSON.');
  };

  const openJson = async (file: File) => {
    try {
      const text = await readFileAsText(file);
      const { diagram, warnings } = deserialize(text);
      s.loadDocument(diagram, { markSaved: true });
      s.setStatus(
        warnings.length
          ? `Opened with ${warnings.length} warnings: ${warnings[0]}`
          : `Opened ${diagram.name}.`,
      );
    } catch (err) {
      s.setStatus(
        err instanceof LoadError ? err.message : 'That file could not be opened.',
      );
    }
  };

  const confirmDestructive = (message: string) =>
    !s.dirty || s.doc.order.length === 0 || window.confirm(message);

  return (
    <div className="toolbar">
      <Group label="Tools">
        <button
          className={`btn tool${s.tool === 'select' ? ' on' : ''}`}
          onClick={() => s.setTool('select')}
          title="Select (V)"
        >
          Select
        </button>
        <button
          className={`btn tool${s.tool === 'pan' ? ' on' : ''}`}
          onClick={() => s.setTool('pan')}
          title="Pan (H, or hold Alt)"
        >
          Pan
        </button>
        <button
          className={`btn tool${s.tool === 'connect' ? ' on' : ''}`}
          onClick={() => s.setTool('connect')}
          title="Connect (C)"
        >
          Connect
        </button>
        <button
          className={`btn tool${s.pendingShape === 'text' ? ' on' : ''}`}
          onClick={() => s.armShape('text')}
          title="Text label (T, with the drawing board focused)"
        >
          Text
        </button>
      </Group>

      <Group label="History">
        <button className="btn" onClick={s.undo} disabled={!s.canUndo()} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button className="btn" onClick={s.redo} disabled={!s.canRedo()} title="Redo (Ctrl+Y)">
          Redo
        </button>
      </Group>

      <Group label="View">
        <button className="btn" onClick={() => s.zoomBy(1.2)} title="Zoom in (Ctrl+=)">
          +
        </button>
        <button className="btn" onClick={() => s.zoomBy(1 / 1.2)} title="Zoom out (Ctrl+-)">
          &minus;
        </button>
        <button className="btn" onClick={s.resetZoom} title="Reset zoom (Ctrl+0)">
          100%
        </button>
        <button
          className="btn"
          onClick={() => s.fitToView(canvasSize)}
          title="Fit diagram (Ctrl+1)"
        >
          Fit
        </button>
        <button
          className={`btn${s.doc.settings.showGrid ? ' on' : ''}`}
          onClick={() => s.updateSettings({ showGrid: !s.doc.settings.showGrid })}
          title="Toggle grid"
        >
          Grid
        </button>
        <button
          className={`btn${s.doc.settings.snapToGrid ? ' on' : ''}`}
          onClick={() => s.updateSettings({ snapToGrid: !s.doc.settings.snapToGrid })}
          title="Snap to grid"
        >
          Snap
        </button>
      </Group>

      <Group label="Arrange">
        <button className="btn" disabled={!multi} onClick={() => s.align('left')} title="Align left">
          &#8676;
        </button>
        <button
          className="btn"
          disabled={!multi}
          onClick={() => s.align('center-h')}
          title="Align horizontal centres"
        >
          &#8660;
        </button>
        <button className="btn" disabled={!multi} onClick={() => s.align('right')} title="Align right">
          &#8677;
        </button>
        <button className="btn" disabled={!multi} onClick={() => s.align('top')} title="Align top">
          &#8673;
        </button>
        <button
          className="btn"
          disabled={!multi}
          onClick={() => s.align('center-v')}
          title="Align vertical centres"
        >
          &#8661;
        </button>
        <button className="btn" disabled={!multi} onClick={() => s.align('bottom')} title="Align bottom">
          &#8675;
        </button>
        <button
          className="btn"
          disabled={s.selection.length < 3}
          onClick={() => s.distribute('h')}
          title="Distribute horizontally"
        >
          Dist H
        </button>
        <button
          className="btn"
          disabled={s.selection.length < 3}
          onClick={() => s.distribute('v')}
          title="Distribute vertically"
        >
          Dist V
        </button>
      </Group>

      <Group label="Order">
        <button className="btn" disabled={!hasSelection} onClick={() => s.reorderSelection('front')}>
          Front
        </button>
        <button className="btn" disabled={!hasSelection} onClick={() => s.reorderSelection('forward')}>
          Fwd
        </button>
        <button className="btn" disabled={!hasSelection} onClick={() => s.reorderSelection('backward')}>
          Back
        </button>
        <button className="btn" disabled={!hasSelection} onClick={() => s.reorderSelection('back')}>
          Bottom
        </button>
        <button className="btn" disabled={!multi} onClick={s.group} title="Group (Ctrl+G)">
          Group
        </button>
        <button className="btn" disabled={!hasSelection} onClick={s.ungroup}>
          Ungroup
        </button>
        <button className="btn" disabled={!hasSelection} onClick={s.toggleLock}>
          Lock
        </button>
        <button className="btn danger" disabled={!hasSelection} onClick={s.deleteSelection}>
          Delete
        </button>
      </Group>

      <span className="spacer" />

      <Group label="File">
        <button
          className="btn"
          onClick={() => {
            if (confirmDestructive('Start a new diagram? Unsaved changes will be lost.')) {
              s.newDocument();
              clearAutosave();
            }
          }}
        >
          New
        </button>
        <button
          className="btn"
          onClick={() => fileInput.current?.click()}
          title="Open a diagram saved by this app (.json)"
        >
          Open
        </button>
        <button
          className={`btn${importing ? ' on' : ''}`}
          onClick={() => importInput.current?.click()}
          disabled={importing}
          title={`Import an external diagram and convert it to editable shapes: ${SUPPORTED_SUMMARY}`}
          data-action="import"
        >
          {importing ? 'Importing…' : 'Import'}
        </button>
        <button className="btn" onClick={saveJson} title="Save (Ctrl+S)">
          Save
        </button>
        <div className="menu-wrap">
          <button className={`btn${exportOpen ? ' on' : ''}`} onClick={() => setExportOpen((v) => !v)}>
            Export
          </button>
          {exportOpen && (
            <div className="menu" onMouseLeave={() => setExportOpen(false)}>
              <button onClick={() => doExport('svg')}>SVG (vector)</button>
              <button onClick={() => doExport('png')}>PNG (2x)</button>
              <button onClick={() => doExport('pdf')}>PDF (via print)</button>
              <button onClick={saveJson}>Diagram JSON</button>
            </div>
          )}
        </div>
        <button
          className="btn danger"
          onClick={() => {
            if (confirmDestructive('Clear the canvas? Unsaved changes will be lost.')) {
              s.clearCanvas();
            }
          }}
        >
          Clear
        </button>
        <button className="btn ghost" onClick={onShowHelp} title="Shortcuts (?)">
          ?
        </button>
      </Group>

      <input
        ref={importInput}
        type="file"
        accept={IMPORT_ACCEPT}
        style={{ display: 'none' }}
        aria-label="Import external diagram"
        data-input="import"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) requestImport(file);
          e.target.value = '';
        }}
      />
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void openJson(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
