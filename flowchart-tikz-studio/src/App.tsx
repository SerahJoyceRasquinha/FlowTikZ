import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { CanvasStage } from './canvas/CanvasStage';
import { CodePanel } from './components/CodePanel';
import { PropertyInspector } from './components/PropertyInspector';
import { ShapePalette } from './components/ShapePalette';
import { SplitPane } from './components/SplitPane';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { HelpDialog } from './components/HelpDialog';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useEditor } from './state/store';
import { readAutosave, scheduleAutosave } from './persistence/autosave';
import { sampleDiagram } from './model/sample';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ImportDialog } from './components/ImportDialog';
import { ImportProgress } from './components/ImportProgress';
import { ImportReportDialog } from './components/ImportReportDialog';
import { configureImport } from './import/controller';
import { ChartBuilder } from './components/ChartBuilder';
import { SelectionBar } from './components/SelectionBar';
import { Tour } from './components/tour/Tour';
import { TourPrompt } from './components/tour/TourPrompt';
import { TooltipLayer } from './components/Tooltip';
import { useTour } from './state/tourStore';
import { Icon } from './components/Icon';
import { useProject } from './state/projectStore';


/* Editors and their symbol tables load on first use, never with the canvas. */
const ScienceDialogs = lazy(() => import('./components/science/ScienceDialogs'));
/* The template library (and its previews) likewise loads when first opened. */
const ProjectPanel = lazy(() => import('./components/project/ProjectPanel').then((m) => ({ default: m.ProjectPanel })));
const DocumentPreview = lazy(() => import('./components/project/DocumentPreview').then((m) => ({ default: m.DocumentPreview })));
const ProjectImportDialog = lazy(() => import('./components/project/ProjectImportDialog').then((m) => ({ default: m.ProjectImportDialog })));
const TemplateLibrary = lazy(() => import('./components/TemplateLibrary').then((m) => ({ default: m.TemplateLibrary })));

export default function App() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 640 });
  const [recovery, setRecovery] = useState<{ savedAt?: string } | null>(null);

  const doc = useEditor((s) => s.doc);
  const dirty = useEditor((s) => s.dirty);
  const loadDocument = useEditor((s) => s.loadDocument);
  const tourActive = useTour((t) => t.active);
  const scienceOpen = useEditor((s) => s.scienceDialog !== null);
  const templatesOpen = useEditor((s) => s.templatesOpen !== null);
  const [templatesMounted, setTemplatesMounted] = useState(false);
  useEffect(() => {
    if (templatesOpen) setTemplatesMounted(true);
  }, [templatesOpen]);
  const [scienceMounted, setScienceMounted] = useState(false);
  useEffect(() => {
    if (scienceOpen) setScienceMounted(true);
  }, [scienceOpen]);

  useKeyboardShortcuts({ onShowHelp: () => setHelpOpen(true), canvasSize });
  const projectOpen = useProject((p) => p.project !== null);
  const projectVersion = useProject((p) => p.version);
  const projectDialogs = useProject((p) => p.importing !== null || p.pending !== null);

  /* The import controller fits the view once an import lands. */
  const canvasSizeRef = useRef(canvasSize);
  canvasSizeRef.current = canvasSize;
  useEffect(() => {
    configureImport({ canvasSize: () => canvasSizeRef.current });
  }, []);

  /* Autosave, so a stray refresh does not lose the diagram. */
  useEffect(() => {
    // A figure being drawn inside a LaTeX project is not the saved flowchart.
    if (doc.order.length > 0 && !useProject.getState().project) scheduleAutosave(doc);
  }, [doc]);

  /* Offer recovery once, on first load. */
  useEffect(() => {
    const found = readAutosave();
    if (found) setRecovery({ savedAt: found.savedAt });
  }, []);

  /* Warn before losing unsaved work. */
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const p = useProject.getState().project;
      const projectDirty = !!p && useProject.getState().dirtyCount() > 0;
      if (!dirty && !projectDirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, projectVersion]);

  const measure = useCallback(() => {
    const el = document.querySelector('.canvas-shell');
    if (el) {
      const r = el.getBoundingClientRect();
      setCanvasSize({ width: r.width, height: r.height });
    }
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    // The board also changes size when the palette folds or the inspector widens.
    const el = document.querySelector('.canvas-shell');
    const ro = typeof ResizeObserver !== 'undefined' && el ? new ResizeObserver(() => measure()) : null;
    if (ro && el) ro.observe(el);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, [measure]);

  /** Fit a freshly loaded diagram to the board once it has been laid out. */
  const fitSoon = useCallback(() => {
    const run = () => {
      const el = document.querySelector('.canvas-shell');
      const r = el?.getBoundingClientRect();
      if (r && r.width > 0) useEditor.getState().fitToView({ width: r.width, height: r.height });
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(run));
    else run();
  }, []);

  const onSvgReady = useCallback((el: SVGSVGElement | null) => {
    svgRef.current = el;
  }, []);

  /*
   * Give the drawing board focus on arrival so the letter shortcuts are live
   * from the first keystroke, and hand it back when the help dialog closes -
   * otherwise the dialog's Close button would keep focus and swallow them.
   */
  useEffect(() => {
    if (helpOpen || tourActive || scienceOpen || templatesOpen) return;
    const board = document.querySelector('.canvas-shell') as HTMLElement | null;
    board?.focus?.({ preventScroll: true });
  }, [helpOpen, tourActive, scienceOpen, templatesOpen]);

  const loadExample = useCallback(() => {
    const s = useEditor.getState();
    if (s.dirty && s.doc.order.length > 0 && !window.confirm('Replace the current diagram with the example? Unsaved changes will be lost.')) return;
    loadDocument(sampleDiagram(), { markSaved: true });
    fitSoon();
  }, [loadDocument, fitSoon]);

  const startTour = useCallback(() => {
    setHelpOpen(false);
    const s = useEditor.getState();
    if (s.pendingShape) s.armShape(null);
    if (s.chartBuilder) s.openChartBuilder(null);
    if (s.templatesOpen) s.openTemplates(null);
    if (s.scienceDialog) s.openScienceDialog(null);
    useTour.getState().start(0);
  }, []);

  return (
    <div className="app">
      <header className="app-bar">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            {'{\u2197}'}
          </span>
          <div>
            <h1>FlowTikZ</h1>
            <p>Draw on the right · get Overleaf-ready LaTeX on the left</p>
          </div>
        </div>
        <div className="app-bar-actions">
          <button
            className="btn tour-launch"
            title="A step-by-step animated walkthrough of every part of the app"
            onClick={startTour}
            data-action="header-tour"
          >
            <Icon name="play" />
            Take the tour
          </button>
          <button className="btn" title="Open a worked example flowchart to explore" onClick={loadExample}>
            <Icon name="sparkles" />
            Load example
          </button>
        </div>
      </header>

      <Toolbar svgRef={svgRef} onShowHelp={() => setHelpOpen(true)} onStartTour={startTour} canvasSize={canvasSize} />

      {recovery && (
        <div className="recovery-bar">
          <span>
            A diagram from your last session was recovered
            {recovery.savedAt
              ? ` (${new Date(recovery.savedAt).toLocaleString()})`
              : ''}
            .
          </span>
          <button
            className="btn tiny"
            onClick={() => {
              const found = readAutosave();
              if (found) loadDocument(found.diagram, { markSaved: true });
              setRecovery(null);
              fitSoon();
            }}
          >
            Restore it
          </button>
          <button className="btn tiny ghost" onClick={() => setRecovery(null)}>
            Dismiss
          </button>
        </div>
      )}

      <SplitPane
        left={
          <ErrorBoundary area={projectOpen ? 'Project' : 'TikZ output'}>
            {projectOpen ? (
              <Suspense fallback={null}>
                <ProjectPanel />
              </Suspense>
            ) : (
              <CodePanel />
            )}
          </ErrorBoundary>
        }
        right={
          <div className={`editor-area${projectOpen ? ' project-mode' : ''}`}>
            <ShapePalette />
            {projectOpen ? (
              <ErrorBoundary area="Document preview">
                <Suspense fallback={<div className="tx-preview" />}>
                  <DocumentPreview />
                </Suspense>
              </ErrorBoundary>
            ) : (
              <div className="canvas-wrap">
                <ErrorBoundary area="Canvas">
                  <CanvasStage onReady={onSvgReady} />
                </ErrorBoundary>
                <SelectionBar />
              </div>
            )}
            <ErrorBoundary area="Properties">
              <PropertyInspector />
            </ErrorBoundary>
          </div>
        }
      />

      <StatusBar />
      <ImportProgress />
      <ImportDialog />
      <ImportReportDialog />
      {projectDialogs && (
        <Suspense fallback={null}>
          <ProjectImportDialog />
        </Suspense>
      )}
      <ChartBuilder />
      {templatesMounted && (
        <ErrorBoundary area="Templates">
          <Suspense fallback={null}>
            <TemplateLibrary />
          </Suspense>
        </ErrorBoundary>
      )}
      {scienceMounted && (
        <ErrorBoundary area="Science editor">
          <Suspense fallback={null}>
            <ScienceDialogs />
          </Suspense>
        </ErrorBoundary>
      )}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} onStartTour={startTour} />}
      <TourPrompt onStart={startTour} />
      <Tour
        onFinish={(choice) => {
          if (choice === 'example') loadExample();
          else if (useEditor.getState().doc.order.length === 0) useEditor.getState().armShape('terminator');
        }}
      />
      <TooltipLayer />
    </div>
  );
}
