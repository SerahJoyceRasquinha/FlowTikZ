/// <reference lib="webworker" />
import { createWorkerHandler } from './handler';
import type { FromWorker, ToWorker } from './protocol';

/**
 * Import worker: parsing, background analysis, offline recognition (OCR), SVG
 * generation and mapping all happen here, off the main thread, so the editor
 * stays fully responsive however long an import takes.
 */
declare const self: DedicatedWorkerGlobalScope;

const handle = createWorkerHandler((msg: FromWorker) => self.postMessage(msg));
self.onmessage = (e: MessageEvent<ToWorker>) => {
  void handle(e.data);
};
