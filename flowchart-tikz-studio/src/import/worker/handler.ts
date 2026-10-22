import { runImport } from '../pipeline';
import { serializeError } from '../types';
import type { FromWorker, ToWorker } from './protocol';

/**
 * The worker's message loop, separated from the Worker global so it can be
 * unit-tested with a fake `post`. One import per id; `cancel` aborts it.
 */
export function createWorkerHandler(post: (msg: FromWorker) => void) {
  const jobs = new Map<number, AbortController>();

  return async function onMessage(msg: ToWorker): Promise<void> {
    if (msg.type === 'cancel') {
      jobs.get(msg.id)?.abort();
      return;
    }
    if (msg.type !== 'start') return;
    const controller = new AbortController();
    jobs.set(msg.id, controller);
    try {
      const result = await runImport(
        { bytes: new Uint8Array(msg.file.bytes), name: msg.file.name, mime: msg.file.mime },
        {
          signal: controller.signal,
          onProgress: (event) => post({ type: 'progress', id: msg.id, event }),
        },
      );
      if (controller.signal.aborted) {
        post({ type: 'error', id: msg.id, error: serializeError(new DOMException('Aborted', 'AbortError')) });
      } else {
        post({ type: 'done', id: msg.id, result });
      }
    } catch (err) {
      post({ type: 'error', id: msg.id, error: serializeError(err) });
    } finally {
      jobs.delete(msg.id);
    }
  };
}
