import { useEditor } from '../state/store';
import { useImport, ImportSession } from '../state/importStore';
import { startImport, ImportJob } from './client';
import { ImportError, ImportMode, ImportStage, serializeError } from './types';
import { remapReport } from './report';
import { validateFileMeta } from './validation';
import type { RasterDecoder } from './raster/decode';
import type { OcrFactory } from './local/ocr';

/**
 * The import controller: the glue between the UI, the background job and the
 * editor store. It is the only module that commits an import, and it does so
 * through `applyImport`, i.e. through the normal undoable `commit`.
 */

export interface ImportEnvironment {
  decoder?: RasterDecoder;
  ocr?: OcrFactory;
  useWorker?: boolean;
  /** Current canvas size, for fit-to-view after the import lands. */
  canvasSize?: () => { width: number; height: number };
}

let env: ImportEnvironment = {};
let active: { id: number; job: ImportJob } | null = null;
let nextSession = 1;
/** Configure the decoder / text reader (tests inject their own) and the canvas-size getter. */
export function configureImport(next: ImportEnvironment): void {
  env = { ...env, ...next };
}

export function resetImportEnvironment(): void {
  env = {};
  active = null;
}

export function isImportRunning(): boolean {
  return useImport.getState().session?.status === 'running';
}

/**
 * Entry point for a file the user picked. Validates it immediately; asks how
 * to import when the canvas already holds work; otherwise starts at once.
 */
export function requestImport(file: File): void {
  const imp = useImport.getState();
  if (isImportRunning()) {
    useEditor.getState().setStatus('An import is already in progress.');
    return;
  }
  try {
    validateFileMeta(file);
  } catch (err) {
    showFailure(file, err);
    return;
  }
  const doc = useEditor.getState().doc;
  if (doc.order.length === 0) {
    void runImportFlow(file, 'replace');
  } else {
    imp.setPending(file);
  }
}

/** The user answered the replace / insert / new question. */
export function chooseImportMode(mode: ImportMode | null): void {
  const file = useImport.getState().pending;
  useImport.getState().setPending(null);
  if (!file || !mode) return;
  void runImportFlow(file, mode);
}

export function cancelImport(): void {
  const s = useImport.getState().session;
  if (!s || s.status !== 'running') return;
  active?.job.cancel();
  useImport.getState().patchSession(s.id, { status: 'cancelled', finishedAt: Date.now(), current: null, note: undefined });
  useEditor.getState().setStatus('Import cancelled. The diagram was not changed.');
}

export function dismissImport(): void {
  useImport.getState().setSession(null);
  useImport.getState().setReportOpen(false);
}

function showFailure(file: File, err: unknown) {
  const error = serializeError(err);
  useImport.getState().setSession({
    id: nextSession++,
    fileName: file.name,
    fileSize: file.size,
    mode: 'replace',
    status: 'error',
    stages: [],
    done: [],
    current: null,
    startedAt: Date.now(),
    finishedAt: Date.now(),
    error,
  });
}

export async function runImportFlow(file: File, mode: ImportMode): Promise<void> {
  const id = nextSession++;
  const session: ImportSession = {
    id,
    fileName: file.name,
    fileSize: file.size,
    mode,
    status: 'running',
    stages: ['read'],
    done: [],
    current: null,
    startedAt: Date.now(),
  };
  const imp = useImport.getState();
  imp.setReportOpen(false);
  imp.setSession(session);

  const job = startImport(file, {
    decoder: env.decoder,
    ocr: env.ocr,
    useWorker: env.useWorker,
    onProgress: (e) => {
      const s = useImport.getState().session;
      if (!s || s.id !== id || s.status !== 'running') return;
      if (e.type === 'plan') {
        const merged = [...s.done];
        for (const st of e.stages) if (!merged.includes(st)) merged.push(st);
        useImport.getState().patchSession(id, { stages: merged });
      } else if (e.type === 'stage') {
        const done: ImportStage[] = [...s.done];
        if (s.current && s.current !== e.stage && !done.includes(s.current)) done.push(s.current);
        const patch: Partial<ImportSession> = { current: e.stage, done, note: undefined };
        if (e.stage === 'detect' && e.detail) patch.formatLabel = e.detail;
        useImport.getState().patchSession(id, patch);
      } else if (e.type === 'note') {
        useImport.getState().patchSession(id, { note: e.detail });
      }
    },
  });
  active = { id, job };
  useImport.getState().patchSession(id, { inWorker: job.inWorker });

  let result;
  try {
    result = await job.promise;
  } catch (err) {
    if (active?.id === id) active = null;
    const s = useImport.getState().session;
    if (!s || s.id !== id || s.status === 'cancelled') return;
    const error = serializeError(err);
    useImport.getState().patchSession(id, {
      status: error.code === 'cancelled' ? 'cancelled' : 'error',
      error,
      current: null,
      note: undefined,
      finishedAt: Date.now(),
    });
    return;
  }
  if (active?.id === id) active = null;
  const s = useImport.getState().session;
  // Cancelled while the last stage was finishing: do not commit.
  if (!s || s.id !== id || s.status !== 'running') return;

  try {
    const editor = useEditor.getState();
    const { offset, idMap } = editor.applyImport(result.diagram, mode);
    const size = env.canvasSize?.() ?? { width: 900, height: 640 };
    useEditor.getState().fitToView(size);

    // The original image, for side-by-side comparison. Never part of the document.
    if (result.reference && result.detected.format === 'raster' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const r = result.reference;
      useImport.getState().setReference({
        url: URL.createObjectURL(file),
        placement: {
          x: r.offsetX + offset.x,
          y: r.offsetY + offset.y,
          w: r.width * r.scale,
          h: r.height * r.scale,
        },
        mode: 'off',
        docId: useEditor.getState().doc.id,
      });
    } else {
      useImport.getState().setReference(null);
    }

    const report = remapReport(
      { ...result.report, durationMs: Date.now() - session.startedAt },
      idMap,
    );
    const done = [...new Set([...(useImport.getState().session?.done ?? []), ...(useImport.getState().session?.stages ?? [])])];
    useImport.getState().patchSession(id, {
      status: 'done',
      current: null,
      note: undefined,
      done,
      finishedAt: Date.now(),
      report,
      svg: result.svg,
    });
    const c = report.counts;
    useEditor
      .getState()
      .setStatus(`Imported ${file.name}: ${c.shapes + c.texts} objects, ${c.connectors} connectors${mode === 'replace' ? ' (Ctrl+Z to undo)' : ''}.`);
  } catch (err) {
    useImport.getState().patchSession(id, {
      status: 'error',
      error: serializeError(err instanceof ImportError ? err : new ImportError('internal', undefined, { detail: err instanceof Error ? err.message : undefined })),
      current: null,
      finishedAt: Date.now(),
    });
  }
}
