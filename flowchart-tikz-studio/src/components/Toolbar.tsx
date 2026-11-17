import { useEffect, useRef, useState } from 'react';
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
import { applyZoom } from '../hooks/useKeyboardShortcuts';
import { useTour, type TourMenu } from '../state/tourStore';
import { Icon } from './Icon';
import { useProject } from '../state/projectStore';

interface Props {
  svgRef: React.MutableRefObject<SVGSVGElement | null>;
  onShowHelp: () => void;
  onStartTour: () => void;
  canvasSize: { width: number; height: number };
}

type MenuId = Exclude<TourMenu, null>;

/** One row inside a dropdown: icon, a clear name, and a line saying what it does. */
export function MenuItem({
  icon,
  label,
  sub,
  keys,
  onClick,
  disabled,
  tone,
  title,
  ...rest
}: {
  icon: string;
  label: string;
  sub?: string;
  keys?: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'danger' | 'featured';
  title?: string;
  [data: `data-${string}`]: string | undefined;
}) {
  return (
    <button
      role="menuitem"
      className={tone ?? ''}
      onClick={onClick}
      disabled={disabled}
      title={title}
      {...rest}
    >
      <span className="mi-icon">
        <Icon name={icon} size={16} />
      </span>
      <span className="mi-text">
        <span className="mi-label">{label}</span>
        {sub && <span className="mi-sub">{sub}</span>}
      </span>
      {keys && <span className="mi-key">{keys}</span>}
    </button>
  );
}

export function Toolbar({ svgRef, onShowHelp, onStartTour, canvasSize }: Props) {
  const s = useEditor();
  const fileInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const projectOpen = useProject((p) => p.project !== null);
  const projectBusy = useProject((p) => p.importing !== null && !p.importing.error);
  /** In project mode a tool first opens a drawing in the page; returns false if it cannot. */
  const ready = () => !projectOpen || useProject.getState().ensureFrame();
  const importing = useImport((st) => st.session?.status === 'running');
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);

  const tourActive = useTour((t) => t.active);
  const tourMenu = useTour((t) => t.menu);
  const menu = tourActive ? tourMenu : openMenu;


  /* Close an open menu on an outside click or Escape. */
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t && t.closest?.('.menu-wrap')) return;
      setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  const toggle = (id: MenuId) => setOpenMenu((m) => (m === id ? null : id));
  const run = (fn: () => void) => () => {
    setOpenMenu(null);
    fn();
  };

  const doExport = async (kind: 'svg' | 'png' | 'pdf') => {
    setOpenMenu(null);
    const svg = svgRef.current?.isConnected ? svgRef.current : (document.querySelector('.canvas-svg') as SVGSVGElement | null);
    if (!svg) {
      s.setStatus(projectOpen ? 'Open a drawing in the document first; Export saves the drawing, and Download .zip saves the project.' : 'Nothing to export.');
      return;
    }
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
    setOpenMenu(null);
    if (projectOpen) {
      void useProject.getState().download();
      return;
    }
    downloadText(serialize(s.doc), `${slugify(s.doc.name)}.json`, 'application/json');
    s.markSaved();
    s.setStatus('Diagram saved as JSON.');
  };

  const openJson = async (file: File) => {
    try {
      const text = await readFileAsText(file);
      const { diagram, warnings } = deserialize(text);
      s.loadDocument(diagram, { markSaved: true });
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(() => applyZoom('fit', canvasSize)));
      }
      s.setStatus(
        warnings.length
          ? `Opened with ${warnings.length} warnings: ${warnings[0]}`
          : `Opened ${diagram.name}.`,
      );
    } catch (err) {
      s.setStatus(err instanceof LoadError ? err.message : 'That file could not be opened.');
    }
  };

  const confirmDestructive = (message: string) =>
    !s.dirty || s.doc.order.length === 0 || window.confirm(message);

  const toolBtn = (
    id: 'select' | 'pan' | 'connect',
    icon: string,
    label: string,
    key: string,
    tip: string,
  ) => (
    <button
      className={`btn tool${s.tool === id && !s.pendingShape ? ' on' : ''}`}
      onClick={() => s.setTool(id)}
      title={tip}
      aria-label={label}
      aria-pressed={s.tool === id}
    >
      <Icon name={icon} />
      <span className="tool-label">{label}</span>
      <span className="kbd-hint" aria-hidden="true">
        {key}
      </span>
    </button>
  );

  return (
    <div className="toolbar">
      {/* ---------------------------------------------------------- tools */}
      <div className="tool-group segment" role="group" aria-label="Tools" data-tour="tools">
        {toolBtn('select', 'select', 'Select', 'V', 'Select tool (V): click shapes to select, drag to move them')}
        {toolBtn('pan', 'pan', 'Pan', 'H', 'Pan tool (H): drag to move around the canvas. Tip: hold Alt to pan with any tool')}
        {toolBtn('connect', 'connect', 'Connect', 'C', 'Connect tool (C): drag from one shape to another to draw an arrow')}
        <button
          className={`btn tool${s.pendingShape === 'text' ? ' on' : ''}`}
          onClick={() => s.armShape('text')}
          title="Text label: click this, then click on the canvas where the text should go"
          aria-label="Text"
        >
          <Icon name="text" />
          <span className="tool-label">Text</span>
        </button>
      </div>

      <button
        className="btn tool chart-btn"
        onClick={() => ready() && s.openChartBuilder({ mode: 'new' })}
        title="Build a bar, line, pie or other chart from an Excel or CSV file"
        data-action="chart"
        data-tour="chart"
      >
        <Icon name="chart" />
        Chart<span className="label-long"> from data</span>
      </button>

      <button
        className="btn tool tpl-btn"
        onClick={() => ready() && s.openTemplates('flow')}
        title="Ready-made flowcharts, formulas, physics circuits and laws, chemical reactions and molecules"
        data-action="templates"
        data-tour="templates"
      >
        <Icon name="templates" />
        Templates
      </button>

      {/* -------------------------------------------------------- science */}
      <div className="tool-group sci-group" role="group" aria-label="Science tools" data-tour="science">
        <button
          className="btn tool"
          onClick={() => ready() && s.openScienceDialog({ kind: 'math' })}
          title="Mathematics: build an equation with a live preview"
          aria-label="Mathematics"
          data-action="math"
        >
          <Icon name="sigma" />
          <span className="sci-label">Math</span>
        </button>
        <div className="menu-wrap" data-tour="physics-menu">
          <button
            className={`btn tool${menu === 'physics' ? ' on' : ''}`}
            onClick={() => toggle('physics')}
            title="Physics: circuit components, diagram parts and symbols"
            aria-label="Physics"
            aria-haspopup="menu"
            aria-expanded={menu === 'physics'}
            data-action="physics"
          >
            <Icon name="bolt" />
            <span className="sci-label">Physics</span>
            <span className="caret"><Icon name="chevronDown" size={14} /></span>
          </button>
          {menu === 'physics' && (
            <div className="menu" role="menu">
              <MenuItem icon="resistor" label="Circuit components" sub="Resistors, sources, transistors, wires" onClick={run(() => s.setPaletteDomain('circuit'))} data-action="physics-circuit" />
              <MenuItem icon="bolt" label="Physics diagram parts" sub="Forces, springs, lenses, fields" onClick={run(() => s.setPaletteDomain('physics'))} data-action="physics-parts" />
              <MenuItem icon="sigma" label="Physics symbols and equations" sub="F, E, λ, constants, units" onClick={run(() => ready() && s.openScienceDialog({ kind: 'math', library: 'physics' }))} data-action="physics-symbols" />
              <div className="menu-sep" />
              <MenuItem icon="templates" label="Physics templates" sub="Ready-made laws, circuits and diagrams" onClick={run(() => ready() && s.openTemplates('physics'))} data-action="physics-templates" />
            </div>
          )}
        </div>
        <div className="menu-wrap" data-tour="chem-menu">
          <button
            className={`btn tool${menu === 'chemistry' ? ' on' : ''}`}
            onClick={() => toggle('chemistry')}
            title="Chemistry: formulas, reactions and molecular structures"
            aria-label="Chemistry"
            aria-haspopup="menu"
            aria-expanded={menu === 'chemistry'}
            data-action="chemistry"
          >
            <Icon name="flask" />
            <span className="sci-label">Chem</span>
            <span className="caret"><Icon name="chevronDown" size={14} /></span>
          </button>
          {menu === 'chemistry' && (
            <div className="menu" role="menu">
              <MenuItem icon="text" label="Chemical formula" sub="H₂SO₄, Fe³⁺, isotopes, states" onClick={run(() => ready() && s.openScienceDialog({ kind: 'chem', tab: 'formula' }))} data-action="chem-formula" />
              <MenuItem icon="connect" label="Reaction" sub="Arrows, conditions, multi-step, balance check" onClick={run(() => ready() && s.openScienceDialog({ kind: 'chem', tab: 'reaction' }))} data-action="chem-reaction" />
              <MenuItem icon="molecule" label="Molecule structure" sub="Draw atoms, bonds and rings" onClick={run(() => ready() && s.openScienceDialog({ kind: 'molecule' }))} data-action="chem-molecule" />
              <div className="menu-sep" />
              <MenuItem icon="templates" label="Chemistry templates" sub="Common reactions, molecules and formulas" onClick={run(() => ready() && s.openTemplates('chem'))} data-action="chem-templates" />
            </div>
          )}
        </div>
      </div>

      <span className="tool-sep" aria-hidden="true" />

      {/* -------------------------------------------------------- history */}
      <div className="tool-group" role="group" aria-label="History" data-tour="history">
        <button className="btn icon-only" onClick={s.undo} disabled={!s.canUndo()} title="Undo the last change (Ctrl+Z)" aria-label="Undo">
          <Icon name="undo" />
        </button>
        <button className="btn icon-only" onClick={s.redo} disabled={!s.canRedo()} title="Redo (Ctrl+Y)" aria-label="Redo">
          <Icon name="redo" />
        </button>
      </div>

      <span className="tool-sep" aria-hidden="true" />

      {/* ----------------------------------------------------------- view */}
      <div className="tool-group" role="group" aria-label="View" data-tour="view">
        <button className="btn icon-only" onClick={() => applyZoom('out', canvasSize)} title="Zoom the drawing out (- key on the canvas). Ctrl + - zooms the whole page" aria-label="Zoom out">
          <Icon name="minus" />
        </button>
        <button
          className="btn zoom-readout"
          onClick={() => applyZoom('reset', canvasSize)}
          title="Drawing zoom. Click to go back to 100% (Shift + 0 on the canvas)"
          aria-label={`Zoom ${Math.round(s.view.zoom * 100)} percent, click to reset`}
        >
          {Math.round(s.view.zoom * 100)}%
        </button>
        <button className="btn icon-only" onClick={() => applyZoom('in', canvasSize)} title="Zoom the drawing in (+ key on the canvas). Ctrl + + zooms the whole page" aria-label="Zoom in">
          <Icon name="plus" />
        </button>
        <button
          className="btn"
          onClick={() => applyZoom('fit', canvasSize)}
          title="Fit the whole diagram on screen (Shift + 1 on the canvas)"
          aria-label="Fit"
        >
          <Icon name="fit" />
          <span className="label-collapse">Fit</span>
        </button>
        <div className="menu-wrap" data-tour="view-menu">
          <button
            className={`btn${menu === 'view' ? ' on' : ''}`}
            onClick={() => toggle('view')}
            title="View: grid and snapping options"
            aria-label="View"
            aria-haspopup="menu"
            aria-expanded={menu === 'view'}
          >
            <Icon name="eye" />
            <span className="label-collapse">View</span>
            <span className="caret">
              <Icon name="chevronDown" size={14} />
            </span>
          </button>
          {menu === 'view' && (
            <div className="menu" role="menu">
              <div className="menu-label">Canvas helpers</div>
              <button
                role="menuitemcheckbox"
                aria-checked={s.doc.settings.showGrid}
                onClick={() => s.updateSettings({ showGrid: !s.doc.settings.showGrid })}
              >
                <span className={`check${s.doc.settings.showGrid ? ' on' : ''}`}>
                  {s.doc.settings.showGrid && <Icon name="check" size={13} stroke={3} />}
                </span>
                <span className="mi-text">
                  <span className="mi-label">Show grid</span>
                  <span className="mi-sub">Faint guide lines on the canvas</span>
                </span>
              </button>
              <button
                role="menuitemcheckbox"
                aria-checked={s.doc.settings.snapToGrid}
                onClick={() => s.updateSettings({ snapToGrid: !s.doc.settings.snapToGrid })}
              >
                <span className={`check${s.doc.settings.snapToGrid ? ' on' : ''}`}>
                  {s.doc.settings.snapToGrid && <Icon name="check" size={13} stroke={3} />}
                </span>
                <span className="mi-text">
                  <span className="mi-label">Snap to grid</span>
                  <span className="mi-sub">Shapes line up neatly as you drag</span>
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      <span className="spacer" />

      {/* ----------------------------------------------------------- file */}
      <div className="menu-wrap" data-tour="file">
        <button
          className={`btn${menu === 'file' ? ' on' : ''}${importing ? ' busy' : ''}`}
          onClick={() => toggle('file')}
          title="New, open, import or clear a diagram"
          aria-haspopup="menu"
          aria-expanded={menu === 'file'}
        >
          <Icon name="folder" />
          {importing ? 'Importing…' : 'File'}
          <span className="caret">
            <Icon name="chevronDown" size={14} />
          </span>
        </button>
        {menu === 'file' && (
          <div className="menu align-right" role="menu">
            <MenuItem
              icon="newFile"
              label="New"
              sub="Start an empty diagram"
              onClick={run(() => {
                if (confirmDestructive('Start a new diagram? Unsaved changes will be lost.')) {
                  s.newDocument();
                  clearAutosave();
                }
              })}
              title="Start a new, empty diagram"
            />
            <MenuItem
              icon="folder"
              label="Open"
              sub="A .json file saved by FlowTikZ"
              onClick={run(() => fileInput.current?.click())}
              title="Open a diagram saved by this app (.json) — Ctrl+O"
              data-action="open"
            />
            <MenuItem
              icon="image"
              label={importing ? 'Importing…' : 'Import diagram'}
              sub="Picture, SVG or draw.io → editable shapes"
              onClick={run(() => importInput.current?.click())}
              disabled={importing}
              title={`Import an external diagram and convert it to editable shapes: ${SUPPORTED_SUMMARY}`}
              data-action="import"
            />
            <MenuItem
              icon="folder"
              label={projectBusy ? 'Opening project…' : 'Open LaTeX project (.zip)'}
              sub="Overleaf-style zip → draw inside the document"
              onClick={run(() => projectInput.current?.click())}
              disabled={projectBusy}
              title="Open a LaTeX project zip (main .tex with its folders), preview it, and draw figures straight into the document"
              data-action="open-project"
            />
            {projectOpen && (
              <MenuItem
                icon="x"
                label="Close LaTeX project"
                sub="Back to the plain drawing board"
                onClick={run(() => useProject.getState().close())}
                data-action="menu-close-project"
              />
            )}
            <div className="menu-sep" />
            <MenuItem
              icon="eraser"
              label="Clear canvas"
              sub="Remove everything (you can undo)"
              tone="danger"
              onClick={run(() => {
                if (confirmDestructive('Clear the canvas? Unsaved changes will be lost.')) {
                  s.clearCanvas();
                }
              })}
              title="Remove everything from the canvas (can be undone)"
              data-action="clear"
            />
          </div>
        )}
      </div>

      <button
        className="btn success"
        onClick={saveJson}
        title={projectOpen ? 'Download the LaTeX project, with your drawings, as a .zip (Ctrl+S)' : 'Save your diagram to a .json file you can open later (Ctrl+S)'}
        data-tour="save"
      >
        <Icon name={projectOpen ? 'download' : 'save'} />
        {projectOpen ? 'Download .zip' : 'Save'}
      </button>

      <div className="menu-wrap" data-tour="export">
        <button
          className={`btn${menu === 'export' ? ' on' : ''}`}
          onClick={() => toggle('export')}
          title="Download the drawing as an image or PDF"
          aria-haspopup="menu"
          aria-expanded={menu === 'export'}
        >
          <Icon name="download" />
          Export
          <span className="caret">
            <Icon name="chevronDown" size={14} />
          </span>
        </button>
        {menu === 'export' && (
          <div className="menu align-right" role="menu">
            <div className="menu-label">Download the drawing as…</div>
            <MenuItem icon="image" label="SVG" sub="Sharp at any size (vector)" onClick={() => void doExport('svg')} />
            <MenuItem icon="image" label="PNG" sub="Picture, double resolution" onClick={() => void doExport('png')} />
            <MenuItem icon="file" label="PDF" sub="Opens your browser's print dialog" onClick={() => void doExport('pdf')} />
            <MenuItem icon="save" label="Diagram JSON" sub="Re-open and edit later" onClick={saveJson} />
          </div>
        )}
      </div>

      <div className="menu-wrap" data-tour="help">
        <button
          className={`btn help-btn${menu === 'help' ? ' on' : ''}`}
          onClick={() => toggle('help')}
          title="Guided tour, tips and keyboard shortcuts"
          aria-haspopup="menu"
          aria-expanded={menu === 'help'}
          data-action="help"
        >
          <Icon name="help" />
          Help
          <span className="caret">
            <Icon name="chevronDown" size={14} />
          </span>
        </button>
        {menu === 'help' && (
          <div className="menu align-right" role="menu">
            <MenuItem
              icon="play"
              label="Guided tour (demo)"
              sub="Step-by-step walkthrough of the app"
              tone="featured"
              onClick={run(onStartTour)}
              data-action="start-tour"
            />
            <MenuItem
              icon="keyboard"
              label="Help & shortcuts"
              sub="Quick start and every keyboard key"
              keys="?"
              onClick={run(onShowHelp)}
              data-action="show-help"
            />
          </div>
        )}
      </div>

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
        ref={projectInput}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        style={{ display: 'none' }}
        aria-label="Open a LaTeX project zip"
        data-input="project"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void useProject.getState().importZip(file);
          e.target.value = '';
        }}
      />
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        aria-label="Open a saved diagram"
        data-input="open"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void openJson(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
