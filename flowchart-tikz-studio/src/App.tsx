import { useCallback, useEffect, useRef, useState } from 'react';
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

export default function App() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 640 });
  const [recovery, setRecovery] = useState<{ savedAt?: string } | null>(null);

  const doc = useEditor((s) => s.doc);
  const dirty = useEditor((s) => s.dirty);
  const loadDocument = useEditor((s) => s.loadDocument);

  useKeyboardShortcuts({ onShowHelp: () => setHelpOpen(true), canvasSize });

  /* Autosave, so a stray refresh does not lose the diagram. */
  useEffect(() => {
    if (doc.order.length > 0) scheduleAutosave(doc);
  }, [doc]);

  /* Offer recovery once, on first load. */
  useEffect(() => {
    const found = readAutosave();
    if (found) setRecovery({ savedAt: found.savedAt });
  }, []);

  /* Warn before losing unsaved work. */
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

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
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  const onSvgReady = useCallback((el: SVGSVGElement | null) => {
    svgRef.current = el;
  }, []);

  return (
    <div className="app">
      <header className="app-bar">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            {'{\u2197}'}
          </span>
          <div>
            <h1>Flowchart &rarr; TikZ Studio</h1>
            <p>Draw on the right, compile-ready TikZ on the left</p>
          </div>
        </div>
        <div className="app-bar-actions">
          <button
            className="btn ghost"
            onClick={() => loadDocument(sampleDiagram(), { markSaved: true })}
          >
            Load example
          </button>
        </div>
      </header>

      <Toolbar svgRef={svgRef} onShowHelp={() => setHelpOpen(true)} canvasSize={canvasSize} />

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
          <ErrorBoundary area="TikZ output">
            <CodePanel />
          </ErrorBoundary>
        }
        right={
          <div className="editor-area">
            <ShapePalette />
            <ErrorBoundary area="Canvas">
              <CanvasStage onReady={onSvgReady} />
            </ErrorBoundary>
            <ErrorBoundary area="Properties">
              <PropertyInspector />
            </ErrorBoundary>
          </div>
        }
      />

      <StatusBar />
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
