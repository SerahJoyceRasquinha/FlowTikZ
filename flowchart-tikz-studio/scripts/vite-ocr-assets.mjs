/**
 * Serves the offline text reader's files from this app, so image import works
 * with no internet connection: the Tesseract worker script, its WebAssembly
 * core (embedded in the .wasm.js files) and the English language model.
 *
 *   /ocr/worker.min.js
 *   /ocr/core/tesseract-core-*-lstm.wasm.js
 *   /ocr/lang/eng.traineddata.gz
 *
 * In development they are streamed from node_modules; in a build they are
 * copied into dist/ocr/. Nothing is fetched from a CDN.
 */
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

function pkgDir(name) {
  return dirname(require.resolve(`${name}/package.json`));
}

/** Published path -> absolute source file. */
export function ocrAssetMap() {
  const map = {};
  try {
    const tess = pkgDir('tesseract.js');
    const core = pkgDir('tesseract.js-core');
    const eng = pkgDir('@tesseract.js-data/eng');
    map['ocr/worker.min.js'] = join(tess, 'dist', 'worker.min.js');
    // LSTM-only builds (the engine mode used); tesseract.js picks the best
    // one the browser supports.
    for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) {
      map[`ocr/core/${f}`] = join(core, f);
    }
    map['ocr/lang/eng.traineddata.gz'] = join(eng, '4.0.0_best_int', 'eng.traineddata.gz');
  } catch {
    /* packages not installed: offline text recognition is unavailable */
  }
  for (const [k, v] of Object.entries(map)) if (!existsSync(v)) delete map[k];
  return map;
}

const TYPES = { '.js': 'text/javascript; charset=utf-8', '.gz': 'application/octet-stream' };

export function ocrAssets() {
  let map = {};
  return {
    name: 'ocr-assets',
    configResolved() {
      map = ocrAssetMap();
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '').split('?')[0].replace(/^\/+/, '');
        const file = map[path];
        if (!file) return next();
        res.setHeader('content-type', TYPES[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream');
        res.setHeader('cache-control', 'public, max-age=86400');
        createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const [fileName, file] of Object.entries(map)) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(file) });
      }
    },
  };
}
