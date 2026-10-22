import type { Rect } from '../model/types';
import { diagramBounds } from '../model/diagram';
import { generateLatex } from '../latex/generator';
import { deserialize, LoadError } from '../persistence/schema';
import { rasterDimensions, utf8Decode } from './binary';
import { detectFormat } from './detector';
import { validateFileMeta, validateRasterDimensions, validateSizeForFormat } from './validation';
import { ReportBuilder, ImportReport } from './report';
import {
  DetectedFormat,
  ImportError,
  ImportResult,
  ImportStage,
  ProgressListener,
  ReferencePlacement,
} from './types';
import type { IRDiagram } from './ir/types';
import { validateIR } from './ir/validate';
import { applyBackgroundAnalysis, keepPageTextReadable, normalizeIR, transformIR } from './ir/normalize';
import { svgToIR } from './svg/parser';
import { irToSvg } from './svg/generator';
import { drawioToIR } from './drawio/parser';
import { excalidrawToIR } from './excalidraw/parser';
import { irToDiagram, resolveReportRefs } from './conversion/diagramMapper';
import type { IdAllocator } from './conversion/ids';
import { analyzeBackground, BackgroundAnalysis } from './raster/background';
import { platformDecoder, RasterDecoder } from './raster/decode';
import type { OcrFactory } from './local/ocr';

/**
 * The import pipeline: bytes in, native Diagram out.
 *
 *   detect ─┬─ raster ── decode ─ background ─ offline recogniser (shapes + OCR) ─ SVG ─┐
 *           ├─ svg ───── sanitise ─ parse ────────────────────────────────────────────────┤
 *           ├─ drawio ── parse ───────────────────────────────────────────────────────────┤
 *           ├─ excalidraw / IR JSON ─ validate ───────────────────────────────────────────┤
 *           │                                                                             ▼
 *           │                                              normalise ─ map to Diagram ─ LaTeX check
 *           └─ studio JSON ─ (already a Diagram) ────────────────────────────────────────▲
 *
 * Pure with respect to the application: it never touches the store. It is
 * async throughout, checks for cancellation between stages, and runs the
 * same way in a Web Worker and on the main thread.
 */

export interface PipelineInput {
  bytes: Uint8Array;
  name: string;
  /** MIME type reported by the browser (a hint only). */
  mime: string;
}

export interface PipelineContext {
  signal: AbortSignal;
  onProgress: ProgressListener;
  decoder?: RasterDecoder;
  alloc?: IdAllocator;
  /** Longest edge used for local background analysis. */
  maxAnalysisEdge?: number;
  /** Text reader for the offline recogniser (default: bundled Tesseract). */
  ocr?: OcrFactory;
}

const PLANS: Record<string, ImportStage[]> = {
  raster: ['read', 'detect', 'decode', 'background', 'analyze', 'extract', 'svg', 'sanitize', 'convert', 'latex', 'finalize'],
  svg: ['read', 'detect', 'sanitize', 'extract', 'convert', 'latex', 'finalize'],
  structured: ['read', 'detect', 'extract', 'convert', 'latex', 'finalize'],
};

function yieldToEventLoop(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function stripExtension(name: string): string {
  return name.replace(/\.[A-Za-z0-9]+$/, '').trim() || 'Imported diagram';
}

export async function runImport(input: PipelineInput, ctx: PipelineContext): Promise<ImportResult> {
  const started = Date.now();
  const report = new ReportBuilder();
  const check = () => {
    if (ctx.signal.aborted) throw new ImportError('cancelled');
  };
  const stage = async (s: ImportStage, detail?: string) => {
    check();
    ctx.onProgress({ type: 'stage', stage: s, detail });
    // Let the progress message (and the browser) breathe between stages.
    await yieldToEventLoop();
    check();
  };

  await stage('detect');
  validateFileMeta({ name: input.name, size: input.bytes.length, type: input.mime });
  const detected = await detectFormat({ name: input.name, mime: input.mime, bytes: input.bytes });
  validateSizeForFormat(input.bytes.length, detected.format);

  const structuredFromEmbedded = !!detected.embeddedDrawio;
  const plan =
    detected.format === 'raster' && !structuredFromEmbedded
      ? PLANS.raster
      : detected.format === 'svg' && !structuredFromEmbedded
        ? PLANS.svg
        : PLANS.structured;
  ctx.onProgress({ type: 'plan', stages: plan });
  ctx.onProgress({ type: 'stage', stage: 'detect', detail: detected.label });

  const name = stripExtension(input.name);

  /* ------------------------------------------ an app save file: no IR */
  if (detected.format === 'studio-json') {
    await stage('extract');
    let diagram;
    try {
      const out = deserialize(utf8Decode(input.bytes));
      diagram = out.diagram;
      for (const w of out.warnings) report.add('partial', w);
    } catch (err) {
      throw new ImportError('invalid-file', err instanceof LoadError ? err.message : 'The diagram file could not be read.');
    }
    await stage('convert');
    report.add('converted', 'Flowchart Studio diagram imported without conversion.');
    return finish(diagram, undefined, undefined, undefined);
  }

  /* ------------------------------------------------- everything else */
  let ir: IRDiagram;
  let svg: string | undefined;
  let reference: Omit<ReferencePlacement, 'offsetX' | 'offsetY' | 'scale'> | undefined;
  let format: string = detected.format;
  let inferAttachments = true;

  if (detected.embeddedDrawio) {
    await stage('extract', 'Reading the embedded draw.io source');
    report.add('info', `${detected.label}: the embedded diagram source was imported directly, without image analysis.`);
    ir = await drawioToIR(detected.embeddedDrawio, { report });
    format = 'drawio';
    inferAttachments = false;
  } else if (detected.format === 'drawio') {
    await stage('extract');
    ir = await drawioToIR(utf8Decode(input.bytes), { report });
    inferAttachments = false;
  } else if (detected.format === 'excalidraw') {
    await stage('extract');
    ir = excalidrawToIR(utf8Decode(input.bytes), { report });
  } else if (detected.format === 'ir-json') {
    await stage('extract');
    let raw: unknown;
    try {
      raw = JSON.parse(utf8Decode(input.bytes));
    } catch {
      throw new ImportError('invalid-file', 'The JSON file is not valid JSON.');
    }
    ir = normalizeIR(validateIR(raw, { report }), { report, attachText: true });
  } else if (detected.format === 'svg') {
    await stage('sanitize');
    const markup = utf8Decode(input.bytes);
    await stage('extract');
    try {
      ir = svgToIR(markup, { report });
    } catch (err) {
      if (err instanceof ImportError) throw err;
      throw new ImportError('invalid-file', 'The SVG file is not valid XML.', { detail: err instanceof Error ? err.message : undefined });
    }
  } else {
    const out = await rasterToIR(input, detected, ctx, report, stage);
    ir = out.ir;
    svg = out.svg;
    reference = out.reference;
    format = 'image';
  }

  await stage('convert');
  const mapped = irToDiagram(ir, { report, format, name, alloc: ctx.alloc, inferAttachments });
  resolveReportRefs(report.entries, mapped.idMap);
  const placement: ReferencePlacement | undefined = reference
    ? { ...reference, scale: mapped.transform.scale, offsetX: mapped.transform.offsetX, offsetY: mapped.transform.offsetY }
    : undefined;
  return finish(mapped.diagram, ir, svg, placement, mapped.counts);

  async function finish(
    diagram: ImportResult['diagram'],
    irOut: IRDiagram | undefined,
    svgOut: string | undefined,
    ref: ReferencePlacement | undefined,
    counts?: ImportReport['counts'],
  ): Promise<ImportResult> {
    await stage('latex');
    // The existing generator is the only TikZ path. Running it here proves
    // the imported model generates, before anything is committed.
    const latex = generateLatex(diagram, { mode: 'standalone', comments: false });
    const errors = latex.issues.filter((i) => i.severity === 'error');
    if (errors.length) {
      report.add('partial', `${errors.length} object${errors.length === 1 ? '' : 's'} could not be expressed in TikZ; see the LaTeX panel's issue list.`);
    }
    await stage('finalize');
    if (Object.keys(diagram.nodes).length + Object.keys(diagram.edges).length === 0) {
      throw new ImportError('no-diagram', 'Could not identify a valid diagram.', { detail: 'Nothing importable was found in the file.' });
    }
    const bounds: Rect = diagramBounds(diagram);
    const c = counts ?? {
      shapes: Object.values(diagram.nodes).filter((n) => n.kind !== 'text').length,
      texts: Object.values(diagram.nodes).filter((n) => n.kind === 'text').length,
      connectors: Object.keys(diagram.edges).length,
      groups: Object.keys(diagram.groups).length,
    };
    return {
      diagram,
      detected,
      ir: irOut ?? { version: 1, canvas: { width: bounds.w, height: bounds.h }, background: { color: null, transparent: true, removed: false }, objects: [], connectors: [], groups: [], metadata: { format: 'studio-json', notes: [] } },
      svg: svgOut,
      reference: ref,
      bounds,
      report: {
        format: detected.label,
        fileName: input.name,
        counts: c,
        entries: report.entries,
        durationMs: Date.now() - started,
      },
    };
  }
}

/* ------------------------------------------------------------- raster */

async function rasterToIR(
  input: PipelineInput,
  detected: DetectedFormat,
  ctx: PipelineContext,
  report: ReportBuilder,
  stage: (s: ImportStage, detail?: string) => Promise<void>,
): Promise<{ ir: IRDiagram; svg: string; reference: { width: number; height: number } }> {
  const decoder = ctx.decoder ?? platformDecoder;
  const mime = detected.mime;

  await stage('decode');
  const dims = rasterDimensions(input.bytes, detected.raster!);
  validateRasterDimensions(dims);
  const analysisEdge = ctx.maxAnalysisEdge ?? 1600;
  const decoded = await decoder.decode(input.bytes, mime, analysisEdge);
  if (!decoded) {
    if (!dims) throw new ImportError('invalid-file', 'Could not read the size of this image.');
    throw new ImportError('recognition-failed', 'This browser could not decode the image. Try saving it as PNG and importing again.');
  }
  const width = Math.round(decoded.width / decoded.scale);
  const height = Math.round(decoded.height / decoded.scale);
  if (!(width > 0 && height > 0)) {
    throw new ImportError('invalid-file', 'Could not read the size of this image.');
  }
  if (detected.raster === 'gif') report.add('info', 'Animated GIFs are analysed from their first frame.');

  /* ---- background */
  await stage('background');
  const analysis: BackgroundAnalysis = analyzeBackground(decoded.data, decoded.width, decoded.height);
  if (analysis.transparent) {
    report.add('info', 'The image background is already transparent.');
  } else if (analysis.color && analysis.confidence >= 0.45) {
    report.add(
      'info',
      `Background ${analysis.color} detected (${Math.round(analysis.confidence * 100)}% of the border) and removed by connectivity from the image edge - enclosed areas of the same colour are kept as shape fills.`,
    );
  } else {
    report.add('info', 'No uniform background was detected; the recogniser decides what is background.');
  }

  /* ---- recognition: the built-in offline recogniser (shapes, lines, OCR) */
  await stage('analyze', 'Offline recognition');
  ctx.onProgress({ type: 'note', detail: 'Loading the offline text reader' });
  const { recognizeLocally } = await import('./local/recognize');
  const factory = ctx.ocr ?? (await import('./local/ocr')).createDefaultOcr;
  const ocr = await factory();
  let result;
  try {
    result = await recognizeLocally(decoded.data, decoded.width, decoded.height, analysis, {
      ocr,
      signal: ctx.signal,
      onNote: (detail) => ctx.onProgress({ type: 'note', detail }),
    });
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') throw new ImportError('cancelled');
    throw err;
  } finally {
    await ocr?.dispose().catch(() => undefined);
  }
  if (ctx.signal.aborted) throw new ImportError('cancelled');
  await stage('extract');
  report.add(
    'info',
    `Converted with the built-in offline recogniser (nothing uploaded): ${result.stats.shapes} shape${result.stats.shapes === 1 ? '' : 's'}, ${result.stats.connectors} connector${result.stats.connectors === 1 ? '' : 's'}, ${result.stats.texts} text block${result.stats.texts === 1 ? '' : 's'}. It works best on clean digital diagrams (exports and screenshots).`,
  );
  if (!result.stats.ocr) {
    report.add('partial', 'The offline text reader could not start, so text was not recognised; shapes and connectors were. Type the labels in, or try again.');
  }
  if (result.stats.ignoredMarks) {
    report.add('partial', `${result.stats.ignoredMarks} small mark${result.stats.ignoredMarks === 1 ? '' : 's'} (decorations, specks or unreadable text) ${result.stats.ignoredMarks === 1 ? 'was' : 'were'} not reproduced.`);
  }
  let ir = validateIR(result.raw, { report });
  ir = transformIR(ir, 1 / decoded.scale, 0, 0, { width, height });
  ir.metadata = { ...ir.metadata, generator: 'offline' };

  /* ---- bring into shape: normalise, background decisions */
  ir = normalizeIR(ir, { report, attachText: true, removeCanvasBackground: true });
  ir = applyBackgroundAnalysis(ir, analysis, decoded.scale, report);
  if (!analysis.transparent) ir = keepPageTextReadable(ir, analysis.color, report);
  ir.background = {
    color: analysis.color ?? null,
    transparent: !!analysis.transparent,
    removed: true,
    confidence: analysis.confidence,
    method: 'connectivity',
  };
  ir.metadata = { ...ir.metadata, format: 'image' };
  const low = ir.objects.filter((o) => o.confidence !== undefined && o.confidence < 0.6).length;
  if (low) report.add('partial', `${low} object${low === 1 ? ' was' : 's were'} recognised with low confidence; compare with the original using the reference overlay.`);

  /* ---- SVG representation, then back through the SVG importer */
  await stage('svg');
  const svg = irToSvg(ir);
  await stage('sanitize');
  const scratch = new ReportBuilder();
  const reparsed = svgToIR(svg, { report: scratch, format: 'image' });
  for (const e of scratch.entries) {
    if (e.category !== 'info') report.add(e.category, `SVG stage: ${e.message}`, e.ref);
  }
  return { ir: reparsed, svg, reference: { width, height } };
}
