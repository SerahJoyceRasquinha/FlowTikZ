import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import darkPng from './fixtures/import/basic-flowchart-dark.png?b64';
import { base64ToBytes } from '../import/binary';
import { runImport, PipelineContext } from '../import/pipeline';
import { ProgressEvent } from '../import/types';
import { createDefaultOcr, OcrEngine } from '../import/local/ocr';
import { classify } from '../import/local/shapes';
import { chainPieces, componentPieces, type Piece } from '../import/local/lines';
import { keepPageTextReadable } from '../import/ir/normalize';
import { emptyIR } from '../import/ir/types';
import { ReportBuilder } from '../import/report';
import { generateLatex } from '../latex/generator';
import { lintLatex } from './latexLint';
import { testDecoder } from './helpers/pngDecoder';
import { BYTES } from './helpers/importFixtures';
import type { Diagram, Node } from '../model/types';

/**
 * The built-in offline recogniser: pictures to editable diagrams with no key
 * and no network - shapes by template matching, connectors and arrow
 * heads from skeletons, text by the bundled Tesseract OCR.
 */

const BYTES_DARK = base64ToBytes(darkPng);

// One OCR engine for the whole file: starting Tesseract is the slow part.
let shared: OcrEngine | null = null;
const ocr = async (): Promise<OcrEngine | null> =>
  shared && {
    recognize: (r) => shared!.recognize(r),
    dispose: async () => undefined,
  };
beforeAll(async () => {
  shared = await createDefaultOcr();
}, 60_000);
afterAll(async () => {
  await shared?.dispose();
});

function ctx(over: Partial<PipelineContext> = {}): PipelineContext & { events: ProgressEvent[] } {
  const events: ProgressEvent[] = [];
  return { signal: new AbortController().signal, onProgress: (e) => events.push(e), decoder: testDecoder, ocr, events, ...over };
}

const shapes = (d: Diagram) => Object.values(d.nodes).filter((n) => n.kind !== 'text');
const byText = (d: Diagram, t: string) => Object.values(d.nodes).find((n) => n.text === t) as Node | undefined;
function edgeBetween(d: Diagram, from: string, to: string) {
  const a = byText(d, from)?.id;
  const b = byText(d, to)?.id;
  return Object.values(d.edges).find((e) => e.source.nodeId === a && e.target.nodeId === b);
}
function assertLatex(d: Diagram) {
  const out = generateLatex(d);
  expect(out.issues.filter((i) => i.severity === 'error')).toEqual([]);
  expect(lintLatex(out.code, { standalone: true }).problems).toEqual([]);
}

describe('offline recogniser on real pictures', () => {
  it('a filled-shape flowchart on a dark page (the "BASIC FLOWCHART EXAMPLE" picture)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const r = await runImport({ bytes: BYTES_DARK, name: 'test flowchart.png', mime: 'image/png' }, ctx());
    // Nothing is uploaded anywhere.
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    const d = r.diagram;

    const kinds = Object.fromEntries(shapes(d).map((n) => [n.text, n.kind]));
    expect(kinds).toEqual({
      START: 'ellipse',
      'DEFINE REQUIREMENTS': 'process',
      'ESTIMATE WORKLOAD': 'process',
      'ASSIGN TASKS': 'process',
      'APPROVED?': 'decision',
      'REVISE SCOPE': 'process',
      FINISH: 'ellipse',
    });
    // Fills are the picture's colours; the boxes keep their rounded corners.
    expect(byText(d, 'DEFINE REQUIREMENTS')!.style.fill.toLowerCase()).toBe('#6da7ff');
    expect(byText(d, 'DEFINE REQUIREMENTS')!.style.cornerRadius).toBeGreaterThan(4);
    expect(byText(d, 'APPROVED?')!.style.fill.toLowerCase()).toMatch(/^#6[67]d[9a]8f$/);

    // The title is free text, recoloured so it stays readable without the dark page.
    const title = Object.values(d.nodes).find((n) => n.kind === 'text')!;
    expect(title.text).toBe('BASIC FLOWCHART EXAMPLE');
    expect(title.textStyle.color.toLowerCase()).toBe('#264152');

    // Every arrow, in the right direction, with its label.
    expect(Object.keys(d.edges)).toHaveLength(7);
    for (const [a, b] of [
      ['START', 'DEFINE REQUIREMENTS'],
      ['DEFINE REQUIREMENTS', 'ESTIMATE WORKLOAD'],
      ['ESTIMATE WORKLOAD', 'ASSIGN TASKS'],
      ['ASSIGN TASKS', 'APPROVED?'],
      ['APPROVED?', 'REVISE SCOPE'],
      ['APPROVED?', 'FINISH'],
      ['REVISE SCOPE', 'DEFINE REQUIREMENTS'],
    ]) {
      const e = edgeBetween(d, a, b);
      expect(e, `${a} -> ${b}`).toBeTruthy();
      expect(e!.arrowEnd).not.toBe('none');
      expect(e!.arrowStart).toBe('none');
    }
    expect(edgeBetween(d, 'APPROVED?', 'REVISE SCOPE')!.label?.text).toBe('NO');
    expect(edgeBetween(d, 'APPROVED?', 'FINISH')!.label?.text).toBe('YES');
    const loop = edgeBetween(d, 'REVISE SCOPE', 'DEFINE REQUIREMENTS')!;
    expect(loop.strokeStyle).toBe('dashed');
    expect(loop.routing).toMatch(/orthogonal/);

    const notes = r.report.entries.map((e) => e.message).join('\n');
    expect(notes).toMatch(/built-in offline recogniser \(nothing uploaded\)/);
    assertLatex(d);
  });

  it('outlined shapes on white, with a loop-back connector and labels', async () => {
    const r = await runImport({ bytes: BYTES.simplePng, name: 'simple.png', mime: 'image/png' }, ctx());
    const d = r.diagram;
    expect(Object.fromEntries(shapes(d).map((n) => [n.text, n.kind]))).toEqual({
      Start: 'terminator',
      'Read input': 'process',
      'Valid?': 'decision',
      End: 'terminator',
    });
    expect(byText(d, 'Read input')!.style.fill.toLowerCase()).toBe('#ffffff');
    expect(byText(d, 'End')!.style.fill.toLowerCase()).toBe('#d5e8d4');
    expect(Object.keys(d.edges)).toHaveLength(4);
    expect(edgeBetween(d, 'Start', 'Read input')).toBeTruthy();
    expect(edgeBetween(d, 'Read input', 'Valid?')).toBeTruthy();
    expect(edgeBetween(d, 'Valid?', 'End')!.label?.text).toBe('Yes');
    const back = edgeBetween(d, 'Valid?', 'Read input')!;
    expect(back.label?.text).toBe('No');
    expect(back.routing).toMatch(/orthogonal/);
    assertLatex(d);
  });

  it('cylinders, documents, parallelograms, dashed connectors whose heads stand apart', async () => {
    const r = await runImport({ bytes: BYTES.complexPng, name: 'complex.png', mime: 'image/png' }, ctx());
    const d = r.diagram;
    expect(Object.fromEntries(shapes(d).map((n) => [n.text, n.kind]))).toEqual({
      'Refund request': 'process',
      'Refnd\nvalid?': 'decision',
      Orders: 'database',
      Policy: 'document',
      Approve: 'process',
      Reject: 'process',
      'Notify customer': 'io',
    });
    expect(byText(d, 'Approve')!.textStyle.bold).toBe(true);
    expect(byText(d, 'Reject')!.textStyle.bold).toBe(false);
    expect(Object.values(d.nodes).find((n) => n.kind === 'text')?.text).toBe('Refund workflow');
    expect(Object.keys(d.edges)).toHaveLength(6);
    expect(edgeBetween(d, 'Refnd\nvalid?', 'Orders')!.strokeStyle).toBe('dashed');
    expect(edgeBetween(d, 'Refnd\nvalid?', 'Orders')!.arrowEnd).not.toBe('none');
    expect(edgeBetween(d, 'Policy', 'Reject')!.strokeStyle).toBe('dashed');
    expect(edgeBetween(d, 'Refnd\nvalid?', 'Approve')!.label?.text).toBe('Yes');
    expect(edgeBetween(d, 'Approve', 'Notify customer')).toBeTruthy();
    assertLatex(d);
  });

  it('keeps white shapes on a white page (their outline encloses them)', async () => {
    const r = await runImport({ bytes: BYTES.whitePng, name: 'white.png', mime: 'image/png' }, ctx());
    const d = r.diagram;
    expect(shapes(d).map((n) => [n.text, n.style.fill.toLowerCase()]).sort()).toEqual([
      ['Dark', '#1f2933'],
      ['White A', '#ffffff'],
      ['White B', '#ffffff'],
    ]);
    expect(edgeBetween(d, 'White A', 'White B')).toBeTruthy();
  });
});

describe('the text reader', () => {
  it('without the text reader, shapes and connectors still come through, and the report says so', async () => {
    const r = await runImport({ bytes: BYTES.simplePng, name: 'simple.png', mime: 'image/png' }, ctx({ ocr: async () => null }));
    expect(shapes(r.diagram).map((n) => n.kind).sort()).toEqual(['decision', 'process', 'terminator', 'terminator']);
    expect(Object.keys(r.diagram.edges)).toHaveLength(4);
    expect(r.report.entries.some((e) => e.category === 'partial' && /text reader could not start/.test(e.message))).toBe(true);
  });

  it('can be cancelled while recognising', async () => {
    const controller = new AbortController();
    const p = runImport(
      { bytes: BYTES.complexPng, name: 'c.png', mime: 'image/png' },
      ctx({
        signal: controller.signal,
        onProgress: (e) => {
          if (e.type === 'note' && /Reading text/.test(e.detail)) controller.abort();
        },
      }),
    );
    await expect(p).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('offline recogniser building blocks', () => {
  const mask = (w: number, h: number, inside: (u: number, v: number) => boolean) => {
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = inside((x + 0.5) / w, (y + 0.5) / h) ? 1 : 0;
    return m;
  };

  it('classifies silhouettes by template', () => {
    expect(classify(mask(120, 60, () => true), 120, 60).type).toBe('rectangle');
    expect(classify(mask(120, 60, (u, v) => (2 * u - 1) ** 2 + (2 * v - 1) ** 2 <= 1), 120, 60).type).toBe('ellipse');
    expect(classify(mask(60, 60, (u, v) => (2 * u - 1) ** 2 + (2 * v - 1) ** 2 <= 1), 60, 60).type).toBe('circle');
    expect(classify(mask(100, 70, (u, v) => Math.abs(2 * u - 1) + Math.abs(2 * v - 1) <= 1), 100, 70).type).toBe('diamond');
    expect(classify(mask(140, 50, (u, v) => u >= 0.2 * (1 - v) && u <= 1 - 0.2 * v), 140, 50).type).toBe('parallelogram');
    expect(classify(mask(100, 80, (u, v) => Math.abs(2 * u - 1) <= v), 100, 80).type).toBe('triangle');
    const stadium = classify(
      mask(160, 50, (u, v) => {
        const x = u * 160;
        const y = v * 50;
        if (x >= 25 && x <= 135) return true;
        const cx = x < 25 ? 25 : 135;
        return (x - cx) ** 2 + (y - 25) ** 2 <= 625;
      }),
      160,
      50,
    );
    expect(stadium.type).toBe('terminator');
    // Anything else keeps its exact outline.
    const blob = classify(mask(100, 100, (u, v) => (u < 0.5 && v < 0.5) || (u > 0.5 && v > 0.5) || (u > 0.2 && u < 0.8 && v > 0.2 && v < 0.8)), 100, 100);
    expect(blob.type).toBe('polygon');
    expect(blob.polygon!.length).toBeGreaterThanOrEqual(6);
  });

  it('turns an open (chevron) arrow into a line plus a head pointing the right way', () => {
    // A 40 px shaft to the right ending in ">".
    const w = 60;
    const h = 30;
    const m = new Uint8Array(w * h);
    const set = (x: number, y: number) => {
      for (let dy = -1; dy <= 0; dy++) m[(y + dy) * w + x] = 1;
    };
    for (let x = 5; x <= 45; x++) set(x, 15);
    for (let k = 0; k <= 8; k++) {
      set(45 - k, 15 - k);
      set(45 - k, 15 + k);
    }
    const pieces = componentPieces(m, w, h, { x: 0, y: 0 }, [0, 0, 0], 1, { bareChevron: true });
    const heads = pieces.flatMap((p) => p.heads);
    expect(heads).toHaveLength(1);
    expect(heads[0].kind).toBe('open');
    expect(heads[0].dir.x).toBeGreaterThan(0.9);
  });

  it('chains the dashes of a dashed line and puts a loose head on its end', () => {
    const dash = (x0: number): Piece => ({
      points: Array.from({ length: 5 }, (_, i) => ({ x: x0 + i, y: 50 })),
      length: 4,
      lineWidth: 2,
      color: [0, 0, 0],
      heads: [],
      compId: x0,
    });
    const head: Piece = {
      points: [{ x: 60, y: 50 }],
      length: 0,
      lineWidth: 2,
      color: [0, 0, 0],
      heads: [{ tip: { x: 60, y: 50 }, dir: { x: 1, y: 0 }, kind: 'triangle' }],
      compId: 99,
      headOnly: true,
    };
    const out = chainPieces([dash(0), dash(8), dash(16), dash(24), dash(32), dash(40), head]);
    expect(out).toHaveLength(1);
    expect(out[0].dashed).not.toBeNull();
    expect(out[0].points[0].x).toBe(0);
    expect(out[0].points[out[0].points.length - 1]).toEqual({ x: 60, y: 50 });
    expect(out[0].arrowEnd?.kind).toBe('triangle');
    expect(out[0].arrowStart).toBeNull();
  });

  it('keeps light text readable once a dark page is removed, preserving the original colour', () => {
    const ir = emptyIR('image', 100, 100);
    ir.objects.push({
      id: 't',
      shape: 'text',
      x: 0,
      y: 0,
      w: 50,
      h: 10,
      rotation: 0,
      z: 0,
      style: { fill: null, fillOpacity: 1, stroke: null, strokeOpacity: 1, strokeWidth: 1, dash: 'solid', opacity: 1, cornerRadius: 0, shadow: false },
      text: { content: 'Title', fontSize: 12, fontFamily: 'sans', bold: false, italic: false, underline: false, color: '#ffffff', align: 'center', valign: 'middle' },
    });
    const report = new ReportBuilder();
    const out = keepPageTextReadable(ir, '#264152', report);
    expect(out.objects[0].text!.color).toBe('#264152');
    expect(out.objects[0].preserved).toEqual({ 'text.originalColor': '#ffffff' });
    expect(report.entries.some((e) => e.category === 'approximated')).toBe(true);
    // A light page leaves text alone.
    expect(keepPageTextReadable(ir, '#ffffff', new ReportBuilder()).objects[0].text!.color).toBe('#ffffff');
  });
});
