// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import App from '../App';
import { useEditor } from '../state/store';
import { useImport } from '../state/importStore';
import { emptyDiagram } from '../model/defaults';
import { resetIdCounters } from '../model/ids';
import { sampleDiagram } from '../model/sample';
import { configureImport, requestImport, resetImportEnvironment, cancelImport } from '../import/controller';
import { buildSvgString } from '../export/svg';
import { exportPng } from '../export/raster';
import { exportPdf } from '../export/pdf';
import { serialize, deserialize } from '../persistence/schema';
import { generateLatex } from '../latex/generator';
import { routeEdge } from '../model/routing';
import { lintLatex } from './latexLint';
import { testDecoder } from './helpers/pngDecoder';
import { BYTES, fileOf } from './helpers/importFixtures';
import { createDefaultOcr, OcrEngine, OcrFactory } from '../import/local/ocr';

// One real OCR engine (Tesseract) for the whole file: starting it is the slow part.
let sharedOcr: OcrEngine | null = null;
const ocr: OcrFactory = async () =>
  sharedOcr && {
    recognize: (r) => sharedOcr!.recognize(r),
    dispose: async () => undefined,
  };
beforeAll(async () => {
  // Tesseract decides once, when first loaded, whether it runs in a browser -
  // by looking for `document`. Under jsdom that would make it resolve its
  // Node worker script as a URL, so load it with the simulated DOM hidden.
  const g = globalThis as { document?: Document };
  const doc = g.document;
  delete g.document;
  try {
    sharedOcr = await createDefaultOcr();
  } finally {
    g.document = doc;
  }
  expect(sharedOcr).not.toBeNull();
}, 60_000);
afterAll(async () => {
  await sharedOcr?.dispose();
});

/** Image import with the offline recogniser, on the main thread. */
function useOffline(delayMs = 0) {
  const factory: OcrFactory = delayMs ? () => new Promise((r) => setTimeout(() => r(ocr()), delayMs)) : ocr;
  configureImport({ decoder: testDecoder, useWorker: false, ocr: factory });
}

/**
 * UI integration and the end-to-end acceptance workflow (Part 27), driven
 * through the real toolbar file input, for PNG, JPG, SVG and draw.io.
 * As in the other UI suites, any React warning or error fails the test.
 */

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;
const consoleErrors: unknown[][] = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  consoleErrors.length = 0;
  vi.spyOn(console, 'error').mockImplementation((...a) => consoleErrors.push(a));
  vi.spyOn(console, 'warn').mockImplementation((...a) => consoleErrors.push(a));
  localStorage.clear();
  resetIdCounters();
  resetImportEnvironment();
  useImport.setState({ pending: null, session: null, reportOpen: false, reference: null });
  useEditor.setState({
    doc: emptyDiagram(),
    selection: [],
    tool: 'select',
    pendingShape: null,
    past: [],
    future: [],
    snapshot: null,
    clipboard: null,
    dirty: false,
    editingNodeId: null,
    view: { zoom: 1, panX: 60, panY: 60 },
  });
  if (!URL.createObjectURL) (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:reference';
  if (!URL.revokeObjectURL) (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  resetImportEnvironment();
});

const render = () => act(() => root.render(<App />));
const S = () => useEditor.getState();
const $ = (sel: string) => container.querySelector(sel);
const $$ = (sel: string) => Array.from(container.querySelectorAll(sel));
const button = (text: string) => $$('button').find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
const code = () => $('.code-text')!.textContent!;

async function waitFor(cond: () => boolean, timeout = 8000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeout) throw new Error('timed out waiting for condition');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  }
}

const statusOf = () => useImport.getState().session?.status;

/** Select a file through the real, hidden toolbar input, as the file picker would. */
function pickFile(file: File) {
  const input = $('input[data-input="import"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('import UI', () => {
  it('offers Import beside Open, accepting every supported format', () => {
    render();
    const imp = $('button[data-action="import"]') as HTMLButtonElement;
    expect(imp.textContent).toBe('Import');
    expect(imp.title).toMatch(/PNG.*SVG.*draw\.io/);
    expect(button('Open')!.title).toMatch(/saved by this app \(\.json\)/);
    const accept = ($('input[data-input="import"]') as HTMLInputElement).accept;
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.svg', '.drawio', '.xml', '.json']) expect(accept).toContain(ext);
    expect(consoleErrors).toEqual([]);
  });

  it('shows a readable error for an unsupported file - no alert(), no stack trace', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    render();
    pickFile(fileOf(new TextEncoder().encode('hello'), 'notes.docx'));
    await waitFor(() => statusOf() === 'error');
    const panel = $('.import-panel')!;
    expect(panel.textContent).toContain('Unsupported file format (.docx).');
    expect(panel.textContent).toContain('Your diagram was not changed.');
    expect(panel.textContent).not.toMatch(/at \w+ \(|\.tsx?:\d+/);
    expect(alert).not.toHaveBeenCalled();
    expect(consoleErrors).toEqual([]);
  });

  it('asks where to put the import when the canvas is not empty (22), and Cancel changes nothing', async () => {
    useOffline();
    render();
    act(() => S().loadDocument(sampleDiagram(), { markSaved: false }));
    const before = JSON.stringify(S().doc);
    pickFile(fileOf(BYTES.flowchartDrawio, 'flow.drawio'));
    const dialog = $('.import-dialog')!;
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('Replace current diagram');
    expect(dialog.textContent).toContain('Insert into current diagram');
    expect(dialog.textContent).toContain('Open as new document');
    expect(dialog.textContent).toContain('with unsaved changes');
    expect(dialog.textContent).toContain('cannot be undone');
    // The canvas underneath ignores shortcuts while the dialog is open.
    act(() => S().setSelection([S().doc.order[0]]));
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' })));
    expect(JSON.stringify(S().doc)).toBe(before);
    act(() => button('Cancel')!.click());
    expect($('.import-dialog')).toBeNull();
    expect(JSON.stringify(S().doc)).toBe(before);
    expect(useImport.getState().session).toBeNull();
    expect(consoleErrors).toEqual([]);
  });

  it('inserts into the existing diagram when asked, selected and undoable', async () => {
    render();
    act(() => S().loadDocument(sampleDiagram(), { markSaved: true }));
    const existing = S().doc.order.length;
    pickFile(fileOf(BYTES.flowchartDrawio, 'flow.drawio'));
    act(() => ($('.import-choice[data-mode="insert"]') as HTMLButtonElement).click());
    await waitFor(() => statusOf() === 'done');
    expect(S().doc.order.length).toBe(existing + 21);
    expect(S().selection).toHaveLength(21);
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })));
    expect(S().doc.order.length).toBe(existing);
    expect(consoleErrors).toEqual([]);
  });

  it('stays usable while an image is recognised in the background, and can be cancelled', async () => {
    useOffline(1500);
    render();
    pickFile(fileOf(BYTES.simplePng, 'simple.png', 'image/png'));
    await waitFor(() => useImport.getState().session?.current === 'analyze');
    const panel = $('.import-panel')!;
    expect(panel.textContent).toContain('Analyzing diagram…');
    expect(panel.textContent).toMatch(/Recognising offline|Loading the offline text reader/);
    expect(panel.querySelector('li.done')!.textContent).toContain('Reading file');
    // The editor responds meanwhile.
    let id = '';
    act(() => {
      id = S().addNode('process', { x: 100, y: 100 });
    });
    expect($(`[data-object-id="${id}"]`)).toBeTruthy();
    expect(button('Importing…')!.disabled).toBe(true);
    act(() => cancelImport());
    expect(statusOf()).toBe('cancelled');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // Only the user's own shape: the cancelled import committed nothing.
    expect(Object.keys(S().doc.nodes)).toEqual([id]);
    expect($('.import-panel')!.textContent).toContain('Import cancelled');
    expect(consoleErrors).toEqual([]);
  });

  it('has no AI or API settings anywhere in the interface', () => {
    render();
    expect(document.body.textContent).not.toMatch(/\bAI\b|API key|Gemini/);
    const select = [...document.querySelectorAll('select')].find((el) => [...el.options].some((o) => o.value === 'ai'));
    expect(select).toBeUndefined();
  });

  it('shows the conversion report; entries select their object', async () => {
    useOffline();
    render();
    pickFile(fileOf(BYTES.darkPng, 'basic-flowchart-dark.png', 'image/png'));
    await waitFor(() => statusOf() === 'done', 30_000);
    expect($('.import-panel')!.textContent).toMatch(/to review/);
    act(() => button('View report')!.click());
    const report = $('.import-report')!;
    expect(report.textContent).toContain('built-in offline recogniser');
    expect(report.textContent).toContain('Text to check');
    const link = report.querySelector('.cat-low-confidence-text button.link') as HTMLButtonElement;
    const id = link.textContent!;
    act(() => link.click());
    expect(S().selection).toContain(id);
    expect($('.import-report')).toBeNull();
    expect(consoleErrors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Part 27 - end-to-end acceptance, repeated for PNG, JPG, SVG, draw.io */
/* ------------------------------------------------------------------ */

interface Case {
  name: string;
  file: () => File;
  raster: boolean;
  expectTexts: string[];
}

const CASES: Case[] = [
  { name: 'PNG', file: () => fileOf(BYTES.simplePng, 'simple.png', 'image/png'), raster: true, expectTexts: ['Start', 'Read input', 'Valid?', 'End'] },
  { name: 'PNG on a dark page', file: () => fileOf(BYTES.darkPng, 'basic-flowchart-dark.png', 'image/png'), raster: true, expectTexts: ['START', 'DEFINE REQUIREMENTS', 'APPROVED?', 'FINISH'] },
  { name: 'SVG', file: () => fileOf(BYTES.flowchartSvg, 'flowchart.svg', 'image/svg+xml'), raster: false, expectTexts: ['Start', 'In stock?', 'Ship'] },
  { name: 'draw.io', file: () => fileOf(BYTES.flowchartDrawio, 'flowchart.drawio'), raster: false, expectTexts: ['Start', 'In stock?', 'Pick list (PL-7)'] },
];

describe.each(CASES)('acceptance: $name', (c) => {
  it('imports into a genuinely editable diagram with live LaTeX, exports, saves and reloads', async () => {
    useOffline();
    render();

    // 1-3. Launch, click Import, select a file.
    const importButton = $('button[data-action="import"]') as HTMLButtonElement;
    const pickerClick = vi.spyOn($('input[data-input="import"]') as HTMLInputElement, 'click').mockImplementation(() => undefined);
    act(() => importButton.click());
    expect(pickerClick).toHaveBeenCalled();
    pickFile(c.file());

    // 4-7. Detected, background processing, responsive, progress displayed.
    expect($('.import-panel')).toBeTruthy();
    await waitFor(() => statusOf() === 'done', 30_000);
    const session = useImport.getState().session!;
    expect(session.formatLabel).toMatch(c.raster ? /image/ : /SVG|draw\.io/);
    if (c.raster) {
      // 8-13. Recognised offline, background removed, IR extracted, SVG generated + sanitised, converted.
      expect(session.report!.entries.some((e) => /built-in offline recogniser/.test(e.message))).toBe(true);
      expect(session.done).toEqual(expect.arrayContaining(['analyze', 'background', 'svg', 'sanitize', 'convert', 'latex']));
      expect(session.svg).toContain('data-fc-ir="1"');
    } else {
      expect(session.done).toEqual(expect.arrayContaining(['extract', 'convert', 'latex']));
    }

    // 14. Objects appear in the drawing area.
    const d = S().doc;
    const nodeIds = Object.keys(d.nodes);
    expect(nodeIds.length).toBeGreaterThanOrEqual(c.expectTexts.length);
    for (const id of nodeIds) expect($(`[data-object-id="${id}"]`)).toBeTruthy();
    for (const t of c.expectTexts) expect(Object.values(d.nodes).some((n) => n.text === t)).toBe(true);

    // 15. Background is transparent.
    expect(d.settings.background).toBe('none');

    // 16. Individually selectable (click on a real shape on the canvas).
    const target = Object.values(d.nodes).find((n) => n.text === c.expectTexts[1])!;
    act(() => S().setSelection([target.id]));
    expect(S().selection).toContain(target.id);

    // 25. Selecting highlights its LaTeX; clicking LaTeX selects it back.
    const traced = $$('.code-line.traced');
    expect(traced.length).toBeGreaterThan(0);
    const tracedText = traced.map((l) => l.textContent).join('\n');
    expect(tracedText).toContain(target.text.split('\n')[0].replace(/[&%$#_{}]/g, (m) => `\\${m}`).slice(0, 5));
    act(() => S().clearSelection());
    act(() => (traced[0] as HTMLElement).click());
    expect(S().selection).toContain(target.id);

    // 23-24. LaTeX appears automatically and represents the import.
    const latexNow = code();
    expect(latexNow).toContain('\\begin{tikzpicture}');
    for (const t of c.expectTexts) expect(latexNow).toContain(t.split('\n')[0]);
    expect(lintLatex(generateLatex(S().doc).code, { standalone: true }).problems).toEqual([]);

    // 17. Text is editable.
    act(() => S().commit((dd) => void (dd.nodes[target.id].text = 'Edited & renamed')));
    expect(code()).toContain('Edited \\& renamed');

    // 18. Connectors are editable.
    const edgeId = Object.keys(S().doc.edges)[0];
    act(() => S().updateEdge(edgeId, { arrowEnd: 'diamond', strokeStyle: 'dashed' }));
    expect(code()).toMatch(/Diamond\[/);

    // 19-20. Objects move, and connectors follow.
    const attached = Object.values(S().doc.edges).find((e) => e.source.nodeId || e.target.nodeId)!;
    const anchorNode = attached.source.nodeId ?? attached.target.nodeId!;
    const before = routeEdge(S().doc, attached)!;
    act(() => {
      S().setSelection([anchorNode]);
      S().beginInteraction();
      S().moveSelection(37, 23, false);
      S().endInteraction();
    });
    const after = routeEdge(S().doc, S().doc.edges[attached.id])!;
    const moved = attached.source.nodeId ? [after.start, before.start] : [after.end, before.end];
    expect(Math.hypot(moved[0].x - moved[1].x, moved[0].y - moved[1].y)).toBeGreaterThan(20);

    // 21. Styles can be changed.
    // (A gradient-filled source shape emits `top color=` rather than `fill=`.)
    act(() => S().updateNodeStyle([target.id], { fill: '#ff8800' }));
    expect(code()).toMatch(/(fill|top color)=fcFF8800/);

    // 22. Undo reverses edits, and the import itself.
    act(() => S().undo());
    expect(code()).not.toContain('fcFF8800');
    while (S().canUndo()) act(() => S().undo());
    expect(S().doc.order).toHaveLength(0);
    act(() => S().redo());
    expect(S().doc.order.length).toBeGreaterThan(0);
    while (S().canRedo()) act(() => S().redo());

    // Reference comparison for image imports: chrome only.
    if (c.raster) {
      const ref = useImport.getState().reference!;
      expect(ref).toBeTruthy();
      act(() => button('Overlay')!.click());
      expect($('image[data-reference="overlay"]')).toBeTruthy();
      act(() => button('Difference')!.click());
      expect(($('image[data-reference="difference"]') as SVGElement).style.mixBlendMode).toBe('difference');
    }

    // 26. Exported SVG contains the reconstruction and none of the editor chrome.
    const svgEl = $('svg.canvas-svg') as SVGSVGElement;
    const exported = buildSvgString(svgEl, S().doc);
    for (const id of Object.keys(S().doc.nodes)) expect(exported).toContain(`data-object-id="${id}"`);
    expect(exported).not.toContain('data-ui');
    expect(exported).not.toContain('data-reference');
    expect(exported).not.toMatch(/<rect[^>]*fill="#ffffff"\/>\n<g>/); // transparent: no page backdrop

    // 27. PNG and PDF exports work.
    const fills: string[] = [];
    const fakeCtx = { fillRect: () => fills.push('fill'), drawImage: () => undefined, fillStyle: '' };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeCtx as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) {
      cb(new Blob(['png'], { type: 'image/png' }));
    });
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    vi.stubGlobal('Image', FakeImage);
    const png = await exportPng(svgEl, S().doc, 2);
    expect(png.type).toBe('image/png');
    expect(fills).toEqual([]); // transparent PNG: no background fill
    vi.unstubAllGlobals();
    let printed = '';
    vi.spyOn(window, 'open').mockImplementation(
      () => ({ document: { write: (s: string) => void (printed += s), close: () => undefined }, focus: () => undefined, print: () => undefined }) as unknown as Window,
    );
    exportPdf(svgEl, S().doc);
    expect(printed).toContain('<svg');

    // 28-29. Save and reload give back the same diagram and the same LaTeX.
    const saved = serialize(S().doc);
    const latexBefore = generateLatex(S().doc).code;
    act(() => S().newDocument());
    act(() => S().loadDocument(deserialize(saved).diagram, { markSaved: true }));
    expect(generateLatex(S().doc).code).toBe(latexBefore);
    // Reference image belongs to the replaced document and is gone.
    expect(useImport.getState().reference).toBeNull();

    // 30. Nothing representable was lost: every object carries its provenance.
    for (const n of Object.values(S().doc.nodes)) {
      if (n.text === 'Edited & renamed') continue;
      expect(n.meta?.import?.format).toBeTruthy();
    }
    expect(consoleErrors).toEqual([]);
  });
});

describe('requestImport into an empty canvas starts straight away', () => {
  it('no dialog, fit to view, status message', async () => {
    render();
    act(() => requestImport(fileOf(BYTES.flowchartDrawio, 'x.drawio')));
    expect($('.import-dialog')).toBeNull();
    await waitFor(() => statusOf() === 'done');
    expect(S().view.zoom).not.toBe(1);
    expect(S().statusMessage).toMatch(/Imported x\.drawio/);
  });
});
