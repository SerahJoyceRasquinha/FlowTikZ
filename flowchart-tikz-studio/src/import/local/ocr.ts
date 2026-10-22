/**
 * Offline text recognition (OCR) for the built-in recogniser.
 *
 * Tesseract (compiled to WebAssembly) with the English LSTM model. Every file
 * it needs is served by this app itself under `/ocr/` (see
 * `scripts/vite-ocr-assets.mjs`), so recognition works with no internet
 * connection and no API key, and no image ever leaves the computer.
 */

export type OcrMode = 'line' | 'block' | 'word' | 'raw';

export interface OcrRequest {
  /** A binary PGM image: dark text on white. */
  image: Uint8Array;
  mode: OcrMode;
}

export interface OcrResult {
  text: string;
  /** 0..100 */
  confidence: number;
}

export interface OcrEngine {
  recognize(req: OcrRequest): Promise<OcrResult>;
  dispose(): Promise<void>;
}

export type OcrFactory = () => Promise<OcrEngine | null>;

const PSM: Record<OcrMode, string> = { block: '6', line: '7', word: '8', raw: '13' };

interface Env {
  process?: { versions?: { node?: string }; cwd?: () => string };
  location?: { origin: string; protocol: string };
}

function assetRoot(): string {
  let base = '/';
  try {
    base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL || '/';
  } catch {
    /* not under Vite */
  }
  const loc = (globalThis as Env).location!;
  return new URL(`${base.replace(/\/?$/, '/')}ocr/`, loc.origin).toString();
}

/**
 * The default engine: in a browser (or browser worker) it loads the assets
 * this app serves; under Node (tests, scripts) it reads them from
 * node_modules. Returns null when OCR cannot start - the recogniser then
 * still reconstructs shapes and connectors, and reports the missing text.
 */
export const createDefaultOcr: OcrFactory = async () => {
  const g = globalThis as Env;
  // Node (tests, scripts - including a simulated DOM) reads node_modules;
  // a browser, or a browser worker, loads what this app serves.
  const inBrowser = !g.process?.versions?.node && !!g.location && /^https?:$/.test(g.location.protocol);
  try {
    const { createWorker } = await import('tesseract.js');
    let options: Record<string, unknown>;
    if (inBrowser) {
      const root = assetRoot();
      options = {
        workerPath: `${root}worker.min.js`,
        corePath: `${root}core`,
        langPath: `${root}lang`,
        gzip: true,
        // Browsers keep the language data in IndexedDB after the first use.
        cacheMethod: 'write',
      };
    } else {
      const cwd = g.process?.cwd?.() ?? '.';
      options = { langPath: `${cwd}/node_modules/@tesseract.js-data/eng/4.0.0_best_int`, gzip: true, cacheMethod: 'none' };
    }
    const worker = await createWorker('eng', 1, options);
    let current = '';
    return {
      async recognize(req) {
        if (current !== req.mode) {
          await worker.setParameters({ tessedit_pageseg_mode: PSM[req.mode] as never, preserve_interword_spaces: '1' });
          current = req.mode;
        }
        const r = await worker.recognize(req.image as never);
        return { text: r.data.text ?? '', confidence: r.data.confidence ?? 0 };
      },
      async dispose() {
        await worker.terminate();
      },
    };
  } catch {
    return null;
  }
};
