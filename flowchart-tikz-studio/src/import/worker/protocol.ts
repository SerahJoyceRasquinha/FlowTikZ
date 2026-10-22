import type { ImportResult, ProgressEvent, SerializedImportError } from '../types';

/** Messages between the editor and the import worker. All structured-clonable. */

export type ToWorker =
  | {
      type: 'start';
      id: number;
      file: { bytes: ArrayBuffer; name: string; mime: string };
    }
  | { type: 'cancel'; id: number };

export type FromWorker =
  | { type: 'progress'; id: number; event: ProgressEvent }
  | { type: 'done'; id: number; result: ImportResult }
  | { type: 'error'; id: number; error: SerializedImportError };
