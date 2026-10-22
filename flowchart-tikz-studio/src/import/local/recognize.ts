import type { Point } from '../../model/types';
import type { BackgroundAnalysis } from '../raster/background';
import { projectOnPath } from '../ir/normalize';
import { Box, boxH, boxW, dist3, hexToRgb, rgbToHex, toRGB } from './image';
import { components } from './morph';
import { findShapes, paintShapeFootprint, segment, ShapeCandidate } from './shapes';
import { groupText, InkComponent, readBlock, TextBlock } from './text';
import { chainPieces, componentPieces, ConnectorPath, Piece, polylineLength, tidyPath } from './lines';
import type { OcrEngine } from './ocr';

/**
 * The offline recogniser: a flowchart picture in, an IR-shaped answer out -
 * the IR JSON contract, validated and mapped by the same code as every other
 * import afterwards. No network, no key, deterministic.
 *
 * It reads clean digital diagrams (exports, screenshots, slides) very well;
 * hand drawings, photos and heavily decorated charts are harder, and the
 * report says when the result looks uncertain.
 */

export interface LocalRecognizeOptions {
  ocr: OcrEngine | null;
  signal?: AbortSignal;
  onNote?: (detail: string) => void;
}

export interface LocalRecognizeResult {
  /** IR-shaped JSON in the analysed image's pixels. */
  raw: Record<string, unknown>;
  stats: {
    shapes: number;
    texts: number;
    connectors: number;
    ocr: boolean;
    lowConfidenceText: number;
    ignoredMarks: number;
  };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

function yieldNow(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function rectDistance(p: Point, b: Box): number {
  const dx = Math.max(b.x0 - p.x, 0, p.x - b.x1);
  const dy = Math.max(b.y0 - p.y, 0, p.y - b.y1);
  return Math.hypot(dx, dy);
}

function polylineRectDistance(pts: Point[], b: Box): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const c = pts[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.y - a.y) / 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      best = Math.min(best, rectDistance({ x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t }, b));
    }
  }
  if (pts.length === 1) best = rectDistance(pts[0], b);
  return best;
}

export async function recognizeLocally(
  rgba: Uint8Array | Uint8ClampedArray,
  W: number,
  H: number,
  analysis: BackgroundAnalysis,
  opts: LocalRecognizeOptions,
): Promise<LocalRecognizeResult> {
  const check = () => {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  };
  const bg: [number, number, number] = analysis.transparent || !analysis.color ? [255, 255, 255] : hexToRgb(analysis.color);
  const img = toRGB(rgba, W, H, bg);
  const bgMask = analysis.mask;
  const tol = Math.max(22, Math.min(48, (analysis.tolerance || 20) * 1.3));

  /* ---- shapes */
  opts.onNote?.('Finding shapes');
  const seg = segment(img, bgMask, tol);
  await yieldNow();
  check();
  const minArea = Math.max(150, 0.0003 * W * H);
  const pageTol = Math.max(8, (analysis.tolerance || 18) * 0.8);
  let shapes = findShapes(img, seg, bgMask, { tol, bgColor: bg, minArea, pageTol });
  shapes = mergeCylinders(dedupeShapes(shapes));
  shapes = dropGlyphLikeShapes(shapes, seg.regions, H, tol);
  shapes.sort((a, b) => boxW(b.box) * boxH(b.box) - boxW(a.box) * boxH(a.box));
  await yieldNow();
  check();

  // Which shape each pixel belongs to (smaller shapes win: painted last).
  const shapeAt = new Int16Array(W * H).fill(-1);
  shapes.forEach((s, i) => {
    const bw = boxW(s.box);
    for (let y = s.box.y0; y <= s.box.y1; y++) {
      for (let x = s.box.x0; x <= s.box.x1; x++) if (s.mask[(y - s.box.y0) * bw + (x - s.box.x0)]) shapeAt[y * W + x] = i;
    }
  });
  const consumed = new Uint8Array(W * H);
  for (const s of shapes) paintShapeFootprint(consumed, W, H, s, seg);

  /* ---- ink: everything else that is not page */
  const ink = new Uint8Array(W * H);
  // Ink differs from what it is drawn on: the fill of the shape it sits in,
  // or the page (areas of page colour enclosed by lines are not ink).
  const inkTol = tol * 0.6;
  for (let i = 0; i < W * H; i++) {
    if (bgMask[i] || consumed[i]) continue;
    const s = shapeAt[i];
    const surf = s >= 0 && !shapes[s].pageColoured ? shapes[s].fill : bg;
    if (dist3(img.rgb[i * 3], img.rgb[i * 3 + 1], img.rgb[i * 3 + 2], ...surf) <= inkTol) continue;
    ink[i] = 1;
  }
  const cc = components(ink, W, H, true);
  const perimeter = new Int32Array(cc.comps.length + 1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const l = cc.labels[p];
      if (!l) continue;
      if (x === 0 || x === W - 1 || y === 0 || y === H - 1 || cc.labels[p - 1] !== l || cc.labels[p + 1] !== l || cc.labels[p - W] !== l || cc.labels[p + W] !== l) perimeter[l]++;
    }
  }
  const inkComps: InkComponent[] = [];
  for (const c of cc.comps) {
    if (c.area < 2) continue;
    const cx = Math.min(W - 1, Math.max(0, Math.round(c.cx)));
    const cy = Math.min(H - 1, Math.max(0, Math.round(c.cy)));
    // The container: the shape under most of the component's box corners and centre.
    const votes = new Map<number, number>();
    for (const [x, y] of [
      [cx, cy],
      [c.box.x0, c.box.y0],
      [c.box.x1, c.box.y0],
      [c.box.x0, c.box.y1],
      [c.box.x1, c.box.y1],
    ]) {
      const s = shapeAt[y * W + x];
      votes.set(s, (votes.get(s) ?? 0) + (x === cx && y === cy ? 2 : 1));
    }
    const container = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const surface = container >= 0 ? (shapes[container].pageColoured ? bg : shapes[container].fill) : bg;
    inkComps.push({ ...c, container, surface, stroke: Math.max(0.8, (2 * c.area) / Math.max(1, perimeter[c.id])) });
  }

  /* ---- each component's pixels and colour, for arrows and connectors */
  const local = new Map<number, { mask: Uint8Array; w: number; h: number; color: [number, number, number] }>();
  const localOf = (c: InkComponent) => {
    const hit = local.get(c.id);
    if (hit) return hit;
    const pad = 1;
    const w = boxW(c.box) + pad * 2;
    const h = boxH(c.box) + pad * 2;
    const mask = new Uint8Array(w * h);
    const samples: number[] = [];
    for (let y = c.box.y0; y <= c.box.y1; y++) {
      for (let x = c.box.x0; x <= c.box.x1; x++) {
        const p = y * W + x;
        if (cc.labels[p] !== c.id) continue;
        mask[(y - c.box.y0 + pad) * w + (x - c.box.x0 + pad)] = 1;
        samples.push(p);
      }
    }
    const d = (p: number) => dist3(img.rgb[p * 3], img.rgb[p * 3 + 1], img.rgb[p * 3 + 2], ...c.surface);
    samples.sort((a, b) => d(b) - d(a));
    const core = samples.slice(0, Math.max(1, Math.ceil(samples.length * 0.4)));
    const color: [number, number, number] = [0, 0, 0];
    for (const p of core) for (let k = 0; k < 3; k++) color[k] += img.rgb[p * 3 + k] / core.length;
    // Geometry from the solid core only: the anti-aliased halo thickens
    // lines and blunts arrow heads. Kept whole if that would erase it.
    const contrast = dist3(...color, ...c.surface);
    const solid = new Uint8Array(w * h);
    let kept = 0;
    for (const p of samples) {
      if (d(p) < contrast * 0.45) continue;
      const x = p % W;
      const y = (p - x) / W;
      solid[(y - c.box.y0 + pad) * w + (x - c.box.x0 + pad)] = 1;
      kept++;
    }
    if (kept >= Math.max(3, samples.length * 0.3)) mask.set(solid);
    const entry = { mask, w, h, color };
    local.set(c.id, entry);
    return entry;
  };
  const piecesOf = (c: InkComponent, bareChevron: boolean) => {
    const l = localOf(c);
    return componentPieces(l.mask, l.w, l.h, { x: c.box.x0 - 1, y: c.box.y0 - 1 }, l.color, c.id, { bareChevron });
  };

  // Arrows and long lines are never text, however letter-like a short one
  // looks: a line with an open arrow head, or a long, sparse, thin mark.
  const arrows = new Set<number>();
  for (const c of inkComps) {
    const bw = boxW(c.box);
    const bh = boxH(c.box);
    if (Math.max(bw, bh) < 8) continue;
    if (Math.max(bw, bh) >= 30 && Math.max(bw, bh) >= 4 * Math.min(bw, bh) && c.area / (bw * bh) <= 0.35) {
      arrows.add(c.id);
      continue;
    }
    const ps = piecesOf(c, false);
    if (ps.some((p) => p.heads.some((h) => h.kind === 'open')) && ps.reduce((n, p) => n + p.length, 0) >= 10) arrows.add(c.id);
  }

  /* ---- text */
  const blocks = groupText(inkComps.filter((c) => !arrows.has(c.id)), H);
  const texts: TextBlock[] = [];
  for (let i = 0; i < blocks.length; i++) {
    check();
    opts.onNote?.(`Reading text ${i + 1} of ${blocks.length}`);
    const t = await readBlock(blocks[i], { img, labels: cc.labels, ocr: opts.ocr });
    if (t) texts.push(t);
  }
  const textIds = new Set(texts.flatMap((t) => t.componentIds));

  /* ---- connectors */
  opts.onNote?.('Tracing connectors');
  await yieldNow();
  check();
  const pieces: Piece[] = [];
  let ignoredMarks = 0;
  for (const c of inkComps) {
    if (textIds.has(c.id)) continue;
    if (c.container >= 0) {
      // Marks entirely inside a shape (inner bars, decorations, unread text)
      // are not connectors.
      const s = shapes[c.container];
      if (c.box.x0 > s.box.x0 && c.box.x1 < s.box.x1 && c.box.y0 > s.box.y0 && c.box.y1 < s.box.y1) {
        ignoredMarks++;
        continue;
      }
    }
    pieces.push(...piecesOf(c, true));
  }
  const paths = chainPieces(pieces).filter((p) => polylineLength(p.points) >= Math.max(8, p.lineWidth * 3) || p.arrowStart || p.arrowEnd);

  /* ---- attach ends to shapes */
  const outlines = shapes.map((s) => outlinePixels(s));
  const nearestShape = (p: Point, lw: number): number => {
    const dMax = Math.max(14, lw * 5 + 6);
    let best = -1;
    let bd = dMax;
    shapes.forEach((s, i) => {
      if (rectDistance(p, s.box) > dMax) return;
      for (const q of outlines[i]) {
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
    });
    return best;
  };

  interface Built {
    points: Point[];
    orthogonal: boolean;
    path: ConnectorPath;
    source: number;
    target: number;
    label?: TextBlock;
  }
  const built: Built[] = paths.map((path) => {
    let { points, orthogonal } = tidyPath(path.points, path.lineWidth);
    const setEnd = (end: 'start' | 'end', tip: Point) => {
      const i = end === 'start' ? 0 : points.length - 1;
      const j = end === 'start' ? 1 : points.length - 2;
      const a = points[j];
      const b = points[i];
      if (!a) {
        points[i] = tip;
        return;
      }
      if (a.x === b.x) points[i] = { x: a.x, y: tip.y };
      else if (a.y === b.y) points[i] = { x: tip.x, y: a.y };
      else points[i] = tip;
    };
    if (path.arrowStart) setEnd('start', path.arrowStart.tip);
    if (path.arrowEnd) setEnd('end', path.arrowEnd.tip);
    let source = nearestShape(points[0], path.lineWidth);
    let target = nearestShape(points[points.length - 1], path.lineWidth);
    // Arrows point at their target: an arrow only at the start means the
    // line was traced backwards.
    if (path.arrowStart && !path.arrowEnd) {
      points = [...points].reverse();
      [source, target] = [target, source];
      path = { ...path, arrowEnd: path.arrowStart, arrowStart: null };
    }
    return { points, orthogonal, path, source, target };
  });

  // Short marks attached to nothing and pointing nowhere are specks or
  // unread letters, not connectors.
  for (let i = built.length - 1; i >= 0; i--) {
    const b = built[i];
    if (b.source < 0 && b.target < 0 && !b.path.arrowStart && !b.path.arrowEnd && polylineLength(b.points) < 30) {
      built.splice(i, 1);
      ignoredMarks++;
    }
  }

  /* ---- labels: page text beside a connector */
  const freeTexts: TextBlock[] = [];
  for (const t of texts.filter((x) => x.container < 0)) {
    let best: Built | null = null;
    let bd = Math.max(18, t.capHeight * 2.6);
    for (const b of built) {
      if (b.label) continue;
      const d = polylineRectDistance(b.points, t.box);
      if (d < bd && boxW(t.box) <= Math.max(160, polylineLength(b.points) * 1.5)) {
        bd = d;
        best = b;
      }
    }
    if (best) best.label = t;
    else freeTexts.push(t);
  }

  /* ---- emit */
  const hex = (c: readonly number[]) => rgbToHex(c[0], c[1], c[2]);
  const textStyle = (t: TextBlock) => ({
    fontSize: r1(t.capHeight * 1.4),
    fontFamily: 'sans-serif',
    bold: t.bold,
    italic: false,
    underline: false,
    color: hex(t.color),
    align: 'center',
    valign: 'middle',
    confidence: t.confidence,
  });
  const objects: Record<string, unknown>[] = [];
  let z = 0;
  let lowConfidenceText = 0;
  shapes.forEach((s, i) => {
    const inside = texts.filter((t) => t.container === i).sort((a, b) => a.box.y0 - b.box.y0);
    const sw = s.stroke?.width ?? 0;
    const half = sw / 2;
    const x = s.box.x0 - half;
    const y = s.box.y0 - half;
    const w = boxW(s.box) + sw;
    const h = boxH(s.box) + sw;
    const obj: Record<string, unknown> = {
      id: `s${i + 1}`,
      shape: s.type,
      x: r1(x),
      y: r1(y),
      w: r1(w),
      h: r1(h),
      rotation: 0,
      style: {
        fill: hex(s.pageColoured ? bg : s.fill),
        stroke: s.stroke ? hex(s.stroke.color) : 'none',
        strokeWidth: s.stroke ? s.stroke.width : 1,
        dash: 'solid',
        cornerRadius: r1(s.cornerRadius),
      },
      z: z++,
      confidence: Math.round(s.score * 100) / 100,
    };
    if (s.polygon && s.polygon.length >= 3) {
      obj.path = [
        { c: 'M', p: { x: r1(s.polygon[0].x), y: r1(s.polygon[0].y) } },
        ...s.polygon.slice(1).map((p) => ({ c: 'L', p: { x: r1(p.x), y: r1(p.y) } })),
        { c: 'Z' },
      ];
    }
    if (inside.length) {
      const main = inside.reduce((a, b) => (b.capHeight * b.text.length > a.capHeight * a.text.length ? b : a));
      obj.text = { ...textStyle(main), content: inside.map((t) => t.text).join('\n'), confidence: Math.min(...inside.map((t) => t.confidence)) };
      if (inside.some((t) => t.confidence < 0.8)) lowConfidenceText++;
    }
    objects.push(obj);
  });
  const connectors: Record<string, unknown>[] = built.map((b, i) => {
    const kind = (h: { kind: string } | null) => (h ? h.kind : 'none');
    const c: Record<string, unknown> = {
      id: `c${i + 1}`,
      points: b.points.map((p) => ({ x: r1(p.x), y: r1(p.y) })),
      routing: b.points.length <= 2 ? 'straight' : b.orthogonal ? 'orthogonal' : 'polyline',
      arrowStart: kind(b.path.arrowStart),
      arrowEnd: kind(b.path.arrowEnd),
      style: {
        stroke: hex(b.path.color),
        strokeWidth: r1(b.path.lineWidth),
        dash: b.path.dashed ? (b.path.dashed.dotted ? 'dotted' : 'dashed') : 'solid',
        ...(b.path.dashed ? { dashArray: [r1(b.path.dashed.dash), r1(b.path.dashed.gap)] } : {}),
        opacity: 1,
      },
      z: z++,
      confidence: b.source >= 0 && b.target >= 0 ? 0.9 : 0.6,
    };
    if (b.source >= 0) c.source = { objectId: `s${b.source + 1}` };
    if (b.target >= 0) c.target = { objectId: `s${b.target + 1}` };
    if (b.label) {
      const t = b.label;
      const where = projectOnPath(b.points, { x: (t.box.x0 + t.box.x1) / 2, y: (t.box.y0 + t.box.y1) / 2 });
      c.label = {
        text: t.text,
        position: where.position,
        offset: where.offset,
        fontSize: r1(t.capHeight * 1.4),
        color: hex(t.color),
        background: false,
        bold: t.bold,
        confidence: t.confidence,
      };
      if (t.confidence < 0.8) lowConfidenceText++;
    }
    return c;
  });
  for (const t of freeTexts) {
    const pad = Math.max(2, t.capHeight * 0.3);
    objects.push({
      id: `t${objects.length + 1}`,
      shape: 'text',
      x: r1(t.box.x0 - pad),
      y: r1(t.box.y0 - pad),
      w: r1(boxW(t.box) + pad * 2),
      h: r1(boxH(t.box) + pad * 2),
      rotation: 0,
      style: { fill: 'none', stroke: 'none' },
      text: { ...textStyle(t), content: t.text },
      z: z++,
      confidence: t.confidence,
    });
    if (t.confidence < 0.8) lowConfidenceText++;
  }

  return {
    raw: {
      canvas: { width: W, height: H },
      background: { color: analysis.transparent ? undefined : hex(bg) },
      objects,
      connectors,
      groups: [],
    },
    stats: {
      shapes: shapes.length,
      texts: texts.length,
      connectors: connectors.length,
      ocr: !!opts.ocr,
      lowConfidenceText,
      ignoredMarks,
    },
  };
}

/**
 * A database cylinder's top rim splits its fill in two: an ellipse (the lid)
 * sitting on the body. Same fill, same width, lid centred on the body's top
 * edge: one cylinder.
 */
function mergeCylinders(shapes: ShapeCandidate[]): ShapeCandidate[] {
  const out = [...shapes];
  for (const lid of shapes) {
    if (lid.type !== 'ellipse' && lid.type !== 'circle') continue;
    const lw = boxW(lid.box);
    const lh = boxH(lid.box);
    const body = out.find(
      (b) =>
        b !== lid &&
        Math.abs(b.box.x0 - lid.box.x0) <= Math.max(3, lw * 0.03) &&
        Math.abs(b.box.x1 - lid.box.x1) <= Math.max(3, lw * 0.03) &&
        Math.abs(b.box.y0 - (lid.box.y0 + lh / 2)) <= lh * 0.6 &&
        boxH(b.box) > lh * 0.8 &&
        dist3(...b.fill, ...lid.fill) <= 30,
    );
    if (!body) continue;
    const box: Box = { x0: Math.min(body.box.x0, lid.box.x0), y0: lid.box.y0, x1: Math.max(body.box.x1, lid.box.x1), y1: body.box.y1 };
    const bw = boxW(box);
    const bh = boxH(box);
    const mask = new Uint8Array(bw * bh);
    for (const part of [lid, body]) {
      const pw = boxW(part.box);
      for (let y = part.box.y0; y <= part.box.y1; y++) {
        for (let x = part.box.x0; x <= part.box.x1; x++) if (part.mask[(y - part.box.y0) * pw + (x - part.box.x0)]) mask[(y - box.y0) * bw + (x - box.x0)] = 1;
      }
    }
    // The rim line between the two parts belongs to the cylinder too.
    for (let x = 0; x < bw; x++) {
      let top = -1;
      for (let y = 0; y < bh; y++) {
        if (mask[y * bw + x]) {
          if (top >= 0 && y - top > 1) for (let k = top + 1; k < y; k++) mask[k * bw + x] = 1;
          top = y;
        }
      }
    }
    const merged: ShapeCandidate = { ...body, box, mask, type: 'cylinder', score: Math.min(body.score, lid.score), polygon: undefined, cornerRadius: 0, lidHeight: lh };
    out.splice(out.indexOf(body), 1, merged);
    out.splice(out.indexOf(lid), 1);
  }
  return out;
}

/** Keep one of two candidates that describe the same shape. */
function dedupeShapes(shapes: ShapeCandidate[]): ShapeCandidate[] {
  const area = (s: ShapeCandidate) => boxW(s.box) * boxH(s.box);
  const sorted = [...shapes].sort((a, b) => area(b) - area(a));
  const out: ShapeCandidate[] = [];
  for (const s of sorted) {
    const dup = out.some((o) => {
      const ix = Math.min(o.box.x1, s.box.x1) - Math.max(o.box.x0, s.box.x0) + 1;
      const iy = Math.min(o.box.y1, s.box.y1) - Math.max(o.box.y0, s.box.y0) + 1;
      if (ix <= 0 || iy <= 0) return false;
      const inter = ix * iy;
      return inter / (area(o) + area(s) - inter) >= 0.85;
    });
    if (!dup) out.push(s);
  }
  return out;
}

/**
 * Large bold letters can look like small solid shapes. A candidate that
 * matched no symbol template and sits in a row of same-coloured, same-height
 * marks is a glyph, not a shape.
 */
function dropGlyphLikeShapes(shapes: ShapeCandidate[], regions: { id: number; area: number; box: Box; color: [number, number, number] }[], H: number, tol: number): ShapeCandidate[] {
  return shapes.filter((s) => {
    const h = boxH(s.box);
    if (h > Math.max(60, H * 0.1)) return true;
    // Well-matched symbols need a close neighbour of the very same colour and
    // height to be doubted; unmatched outlines only a looser one.
    const strict = s.type !== 'polygon';
    for (const r of regions) {
      if (r.id === 0 || r.id === s.regionId || r.area < 6) continue;
      const rh = boxH(r.box);
      if (strict ? rh < h * 0.7 || rh > h * 1.45 : rh < h * 0.5 || rh > h * 2) continue;
      if (dist3(...r.color, ...s.fill) > tol) continue;
      const overlap = Math.min(r.box.y1, s.box.y1) - Math.max(r.box.y0, s.box.y0);
      if (overlap < 0.5 * Math.min(h, rh)) continue;
      const gap = Math.max(r.box.x0 - s.box.x1, s.box.x0 - r.box.x1);
      if (gap <= (strict ? 0.6 : 0.8) * h) return false;
    }
    return true;
  });
}

/** Boundary pixels of a shape's silhouette (image px), thinned out for speed. */
function outlinePixels(s: ShapeCandidate): Point[] {
  const bw = boxW(s.box);
  const bh = boxH(s.box);
  const out: Point[] = [];
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      if (!s.mask[y * bw + x]) continue;
      const edge = x === 0 || y === 0 || x === bw - 1 || y === bh - 1 || !s.mask[y * bw + x - 1] || !s.mask[y * bw + x + 1] || !s.mask[(y - 1) * bw + x] || !s.mask[(y + 1) * bw + x];
      if (edge && (x + y) % 2 === 0) out.push({ x: x + s.box.x0, y: y + s.box.y0 });
    }
  }
  return out;
}
