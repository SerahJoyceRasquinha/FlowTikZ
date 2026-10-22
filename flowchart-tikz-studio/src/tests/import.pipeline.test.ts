import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runImport, PipelineContext } from '../import/pipeline';
import { ImportError, ProgressEvent } from '../import/types';
import { createWorkerHandler } from '../import/worker/handler';
import type { FromWorker } from '../import/worker/protocol';
import { startImport } from '../import/client';
import { generateLatex } from '../latex/generator';
import { lintLatex } from './latexLint';
import { testDecoder } from './helpers/pngDecoder';
import { ANSWERS, BYTES, fileOf } from './helpers/importFixtures';
import type { OcrFactory } from '../import/local/ocr';
import { serialize } from '../persistence/schema';
import { sampleDiagram } from '../model/sample';
import type { Diagram } from '../model/types';

/**
 * 3. Image import pipeline   25. LaTeX after import   32. large images
 * 33-37 errors through the pipeline   38. multiple imports   8. background processing
 */

const enc = (s: string) => new TextEncoder().encode(s);

/**
 * The offline recogniser without its text reader: fast and deterministic.
 * Text recognition itself is covered in import.offline.test.ts.
 */
const noOcr: OcrFactory = async () => null;

function ctx(over: Partial<PipelineContext> = {}): PipelineContext & { events: ProgressEvent[] } {
  const events: ProgressEvent[] = [];
  return {
    signal: new AbortController().signal,
    onProgress: (e) => events.push(e),
    decoder: testDecoder,
    ocr: noOcr,
    events,
    ...over,
  };
}

function texts(d: Diagram): string[] {
  return Object.values(d.nodes)
    .map((n) => n.text)
    .filter(Boolean)
    .sort();
}

function assertLatex(d: Diagram) {
  const out = generateLatex(d);
  expect(out.issues.filter((i) => i.severity === 'error')).toEqual([]);
  expect(lintLatex(out.code, { standalone: true }).problems).toEqual([]);
  return out.code;
}

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ImportError ? e.code : `other:${(e as Error).message}`;
  }
}

describe('image pipeline (offline recogniser, real decoding and background analysis)', () => {
  it('PNG: detects, analyses, recognises, goes through SVG, maps to native objects', async () => {
    const c = ctx();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await runImport({ bytes: BYTES.simplePng, name: 'simple.png', mime: 'image/png' }, c);
    // Nothing leaves the machine: there is no API.
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    const d = res.diagram;

    expect(Object.values(d.nodes).filter((n) => n.kind !== 'text').map((n) => n.kind).sort()).toEqual(['decision', 'process', 'terminator', 'terminator']);
    expect(Object.keys(d.edges)).toHaveLength(4);
    for (const e of Object.values(d.edges)) {
      expect(e.source.nodeId).toBeTruthy();
      expect(e.target.nodeId).toBeTruthy();
    }
    // Transparent background; white shapes stay white.
    expect(d.settings.background).toBe('none');
    expect(Object.values(d.nodes).find((n) => n.kind === 'process')!.style.fill.toLowerCase()).toBe('#ffffff');
    // The SVG stage really ran and is annotated.
    expect(res.svg).toContain('data-fc-ir="1"');
    // Reference image placement maps source pixel (170, 30) onto the top terminator's corner.
    const start = Object.values(d.nodes)
      .filter((n) => n.kind === 'terminator')
      .sort((a, b) => a.y - b.y)[0];
    expect(res.reference!.offsetX + 170 * res.reference!.scale).toBeCloseTo(start.x, -1);
    expect(res.reference!.offsetY + 30 * res.reference!.scale).toBeCloseTo(start.y, -1);
    // Stages, in order, with no invented percentages.
    const stages = c.events.filter((e) => e.type === 'stage').map((e) => (e as { stage: string }).stage);
    expect(stages).toEqual(['detect', 'detect', 'decode', 'background', 'analyze', 'extract', 'svg', 'sanitize', 'convert', 'latex', 'finalize']);
    assertLatex(d);
  });

  it('an image this environment cannot decode is reported clearly, not guessed at', async () => {
    // The test decoder reads PNG only; in the browser, JPG/WEBP/BMP/GIF decode natively.
    expect(await codeOf(runImport({ bytes: BYTES.flowJpg, name: 'flow.jpg', mime: 'image/jpeg' }, ctx()))).toBe('recognition-failed');
  });

  it('refuses images whose header claims absurd dimensions, before decoding', async () => {
    const huge = BYTES.simplePng.slice();
    new DataView(huge.buffer).setUint32(16, 50000);
    new DataView(huge.buffer).setUint32(20, 50000);
    expect(await codeOf(runImport({ bytes: huge, name: 'huge.png', mime: 'image/png' }, ctx({ decoder: undefined })))).toBe('file-too-large');
  });

  it('can be cancelled while recognising (37)', async () => {
    const controller = new AbortController();
    const slowOcr: OcrFactory = () => new Promise((r) => setTimeout(() => r(null), 500));
    const p = runImport({ bytes: BYTES.simplePng, name: 's.png', mime: '' }, ctx({ ocr: slowOcr, signal: controller.signal }));
    setTimeout(() => controller.abort(), 30);
    expect(await codeOf(p)).toBe('cancelled');
  });
});

describe('structured formats through the same pipeline (no recognition needed)', () => {
  const run = (bytes: Uint8Array, name: string) => runImport({ bytes, name, mime: '' }, ctx());

  it('SVG, draw.io, compressed draw.io, draw.io SVG and PNG with embedded source', async () => {
    const svg = await run(BYTES.flowchartSvg, 'flow.svg');
    expect(Object.keys(svg.diagram.nodes).length).toBeGreaterThan(5);
    const drawio = await run(BYTES.flowchartDrawio, 'flow.drawio');
    expect(Object.keys(drawio.diagram.nodes)).toHaveLength(13);
    const compressed = await run(BYTES.compressedDrawio, 'c.drawio');
    expect(Object.keys(compressed.diagram.nodes)).toHaveLength(13);
    // Embedded draw.io sources win over pixels and vector paths: no recognition needed, full fidelity.
    const fromSvg = await run(BYTES.drawioEmbeddedSvg, 'export.svg');
    expect(Object.keys(fromSvg.diagram.nodes)).toHaveLength(13);
    const fromPng = await run(BYTES.drawioPng, 'export.png');
    expect(Object.keys(fromPng.diagram.nodes)).toHaveLength(13);
    expect(fromPng.report.entries.some((e) => /embedded diagram source was imported directly/.test(e.message))).toBe(true);
    for (const r of [svg, drawio, compressed, fromSvg, fromPng]) assertLatex(r.diagram);
  });

  it('structured IR JSON and the app\'s own save files', async () => {
    const ir = await run(enc(JSON.stringify(ANSWERS.simple)), 'diagram.json');
    expect(texts(ir.diagram)).toEqual(['End', 'Read input', 'Start', 'Valid?']);
    const own = await run(enc(serialize(sampleDiagram())), 'mine.json');
    expect(Object.keys(own.diagram.nodes).length).toBe(Object.keys(sampleDiagram().nodes).length);
  });

  it('reports formats it cannot read without crashing', async () => {
    expect(await codeOf(run(enc('<svg><g></svg>'), 'bad.svg'))).toBe('invalid-file');
    expect(await codeOf(run(enc('{"objects": 5}'), 'bad.json'))).toBe('no-diagram');
    expect(await codeOf(run(new Uint8Array([0, 1, 2, 3]), 'x.png'))).toBe('invalid-file');
  });
});

describe('background processing', () => {
  it('the worker message loop runs an import and posts progress, then the result (8)', async () => {
    const posted: FromWorker[] = [];
    const handle = createWorkerHandler((m) => posted.push(m));
    const bytes = BYTES.flowchartDrawio.slice().buffer;
    await handle({ type: 'start', id: 7, file: { bytes, name: 'f.drawio', mime: '' } });
    expect(posted.filter((m) => m.type === 'progress').length).toBeGreaterThan(3);
    const done = posted[posted.length - 1];
    expect(done.type).toBe('done');
    expect(done.id).toBe(7);
    if (done.type === 'done') expect(Object.keys(done.result.diagram.nodes)).toHaveLength(13);
    // Everything that crosses the boundary is structured-clonable.
    expect(() => structuredClone(done)).not.toThrow();
  });

  it('the worker reports errors as plain objects, never stacks', async () => {
    const posted: FromWorker[] = [];
    await createWorkerHandler((m) => posted.push(m))({ type: 'start', id: 1, file: { bytes: enc('garbage\u0000').buffer, name: 'x.png', mime: '' } });
    const last = posted[posted.length - 1];
    expect(last.type).toBe('error');
    if (last.type === 'error') {
      expect(last.error.code).toBe('invalid-file');
      expect(JSON.stringify(last.error)).not.toMatch(/at \w+ \(|\.ts:\d+/);
    }
  });

  it('the worker honours cancel', async () => {
    const posted: FromWorker[] = [];
    const handle = createWorkerHandler((m) => posted.push(m));
    const p = handle({ type: 'start', id: 3, file: { bytes: BYTES.simplePng.slice().buffer, name: 's.png', mime: '' } });
    await handle({ type: 'cancel', id: 3 });
    await p;
    const last = posted[posted.length - 1];
    expect(last.type).toBe('error');
    if (last.type === 'error') expect(last.error.code).toBe('cancelled');
  });

  it('the client falls back to asynchronous main-thread processing without a Worker', async () => {
    const events: ProgressEvent[] = [];
    const job = startImport(fileOf(BYTES.simplePng, 'simple.png', 'image/png'), {
      onProgress: (e) => events.push(e),
      decoder: testDecoder,
      ocr: noOcr,
    });
    expect(job.inWorker).toBe(false);
    const res = await job.promise;
    expect(Object.values(res.diagram.nodes).filter((n) => n.kind !== 'text')).toHaveLength(4);
    expect(events[1]).toEqual({ type: 'stage', stage: 'read' });
  });

  it('the client validates before reading and can be cancelled', async () => {
    const bad = startImport(fileOf(enc('x'), 'virus.exe'), { onProgress: () => undefined });
    expect(await codeOf(bad.promise)).toBe('unsupported-format');
    const job = startImport(fileOf(BYTES.simplePng, 's.png'), {
      onProgress: () => undefined,
      decoder: testDecoder,
      ocr: () => new Promise((r) => setTimeout(() => r(null), 400)),
    });
    setTimeout(() => job.cancel(), 20);
    expect(await codeOf(job.promise)).toBe('cancelled');
  });
});

describe('multiple imports (38)', () => {
  beforeEach(() => undefined);
  it('independent imports produce independent, well-formed diagrams', async () => {
    const [a, b] = await Promise.all([
      runImport({ bytes: BYTES.flowchartDrawio, name: 'a.drawio', mime: '' }, ctx()),
      runImport({ bytes: BYTES.flowchartSvg, name: 'b.svg', mime: '' }, ctx()),
    ]);
    expect(a.diagram.name).toBe('a');
    expect(b.diagram.name).toBe('b');
    assertLatex(a.diagram);
    assertLatex(b.diagram);
  });
});
