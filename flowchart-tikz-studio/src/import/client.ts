import { ImportError, ImportResult, ProgressListener, reviveError, serializeError } from './types';
import type { OcrFactory } from './local/ocr';
import type { RasterDecoder } from './raster/decode';
import type { FromWorker, ToWorker } from './worker/protocol';
import { validateFileMeta } from './validation';

/**
 * Starts an import off the main thread.
 *
 * A dedicated Web Worker runs the whole pipeline when the platform has one.
 * Where it does not (or the worker fails to start), the same pipeline runs on
 * the main thread - still fully asynchronous, yielding between stages - so
 * the UI never blocks on an import either way.
 */

export interface ImportJob {
  promise: Promise<ImportResult>;
  cancel(): void;
  /** True when the job runs in a Web Worker. */
  readonly inWorker: boolean;
}

export interface StartOptions {
  onProgress: ProgressListener;
  /** Injected decoder (tests). Forces the main-thread path. */
  decoder?: RasterDecoder;
  /** Set false to never use a worker. */
  useWorker?: boolean;
  /** Injected text reader (tests). Forces the main-thread path. */
  ocr?: OcrFactory;
}

let nextJob = 1;

async function readBytes(file: Blob): Promise<ArrayBuffer> {
  try {
    if (typeof file.arrayBuffer === 'function') return await file.arrayBuffer();
    return await new Promise<ArrayBuffer>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(file);
    });
  } catch (err) {
    throw new ImportError('read-failed', undefined, { detail: err instanceof Error ? err.message : undefined });
  }
}

function makeWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./worker/import.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

export function startImport(file: File, opts: StartOptions): ImportJob {
  const controller = new AbortController();
  const id = nextJob++;
  const wantWorker = opts.useWorker !== false && !opts.decoder && !opts.ocr;
  const worker = wantWorker ? makeWorker() : null;
  let cancelWorker: (() => void) | null = null;

  const runInline = async (bytes: ArrayBuffer): Promise<ImportResult> => {
    // Loaded on demand: normally the pipeline lives only in the worker chunk,
    // so it costs the main bundle nothing.
    const { runImport } = await import('./pipeline');
    return runImport(
      { bytes: new Uint8Array(bytes), name: file.name, mime: file.type },
      { signal: controller.signal, onProgress: opts.onProgress, decoder: opts.decoder, ocr: opts.ocr },
    );
  };

  const promise = (async () => {
    // Cheap checks first, before the file is even read.
    validateFileMeta(file);
    opts.onProgress({ type: 'plan', stages: ['read', 'detect'] });
    opts.onProgress({ type: 'stage', stage: 'read' });
    const bytes = await readBytes(file);
    if (controller.signal.aborted) throw new ImportError('cancelled');

    if (!worker) return runInline(bytes);

    return new Promise<ImportResult>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        worker.terminate();
        fn();
      };
      worker.onmessage = (e: MessageEvent<FromWorker>) => {
        const msg = e.data;
        if (msg.id !== id) return;
        if (msg.type === 'progress') opts.onProgress(msg.event);
        else if (msg.type === 'done') finish(() => resolve(msg.result));
        else if (msg.type === 'error') finish(() => reject(reviveError(msg.error)));
      };
      worker.onerror = () => {
        // The worker could not start (e.g. blocked by policy): fall back.
        finish(() => {
          runInline(bytes).then(resolve, reject);
        });
      };
      cancelWorker = () => {
        worker.postMessage({ type: 'cancel', id } satisfies ToWorker);
        finish(() => reject(new ImportError('cancelled')));
      };
      const msg: ToWorker = { type: 'start', id, file: { bytes, name: file.name, mime: file.type } };
      worker.postMessage(msg, [bytes]);
    });
  })().catch((err) => {
    throw err instanceof ImportError ? err : reviveError(serializeError(err));
  });

  return {
    promise,
    inWorker: !!worker,
    cancel() {
      controller.abort();
      cancelWorker?.();
    },
  };
}
