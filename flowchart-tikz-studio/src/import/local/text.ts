import { count, thin, type Component } from './morph';
import { Box, RGBImage, boxH, boxW, dist3, encodePGM, resizeGray } from './image';
import type { OcrEngine, OcrMode } from './ocr';

/**
 * Text for the offline recogniser: ink components are grouped into lines and
 * blocks by layout alone, and each block is read by OCR on a clean, enlarged,
 * dark-on-white rendering of just its own pixels - so arrows next to a label
 * and the colour of the shape behind it never confuse the reader.
 */

export interface InkComponent extends Component {
  /** Index of the containing shape, or -1 for the page. */
  container: number;
  /** Colour of what is behind the ink (shape fill or page). */
  surface: [number, number, number];
  /** Estimated stroke thickness, px. */
  stroke: number;
}

export interface TextBlock {
  box: Box;
  container: number;
  text: string;
  confidence: number;
  color: [number, number, number];
  /** Height of a capital letter, px. */
  capHeight: number;
  bold: boolean;
  lines: number;
  componentIds: number[];
}

interface Line {
  members: InkComponent[];
  box: Box;
  height: number;
}

const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

function median(v: number[]): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function quantile(v: number[], q: number): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}

function isThin(c: InkComponent): boolean {
  const w = boxW(c.box);
  const h = boxH(c.box);
  const lo = Math.min(w, h);
  const ratio = Math.max(w, h) / lo;
  if (lo <= 2 && ratio >= 1.8) return true; // a dash of a thin dashed line
  if (ratio < 2.2) return false;
  if (lo <= 4) return true;
  // A bar a little thicker than a hairline: solid, and long for its width.
  return lo <= 6 && ratio >= 4 && c.area / (w * h) >= 0.85;
}

/**
 * Specks and flat dashes (hyphens, underscores, dashed-line pieces): they
 * join text, but never start it. Upright bars (I, l, 1) are real letters.
 */
function isWeak(c: InkComponent): boolean {
  if (c.area <= 6) return true;
  return isThin(c) && boxW(c.box) >= boxH(c.box);
}

/** Letters a component probably holds (bold text often fuses neighbours). */
function glyphCount(strong: InkComponent[], capHeight: number): number {
  return strong.reduce((n, c) => n + Math.max(1, Math.round(boxW(c.box) / Math.max(1, capHeight * 0.8))), 0);
}

/** Group glyph-like components into text lines, then lines into blocks. */
export function groupText(comps: InkComponent[], imageHeight: number): InkComponent[][] {
  const maxH = Math.max(48, imageHeight * 0.1);
  const strong = comps.filter((c) => !isWeak(c) && boxH(c.box) <= maxH && boxW(c.box) <= 8 * boxH(c.box) && c.area >= 4);
  const weak = comps.filter((c) => isWeak(c) && boxH(c.box) <= maxH);

  // Union-find over strong glyphs.
  const parent = strong.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const order = strong.map((_, i) => i).sort((a, b) => strong[a].box.x0 - strong[b].box.x0);
  for (let oi = 0; oi < order.length; oi++) {
    const a = strong[order[oi]];
    const ha = boxH(a.box);
    for (let oj = oi + 1; oj < order.length; oj++) {
      const b = strong[order[oj]];
      const hb = boxH(b.box);
      const hmax = Math.max(ha, hb);
      if (b.box.x0 - a.box.x1 > hmax + 4) {
        if (b.box.x0 - a.box.x1 > maxH * 2) break;
        continue;
      }
      if (a.container !== b.container) continue;
      const gap = Math.max(0, b.box.x0 - a.box.x1 - 1, a.box.x0 - b.box.x1 - 1);
      const overlap = Math.min(a.box.y1, b.box.y1) - Math.max(a.box.y0, b.box.y0) + 1;
      const hmin = Math.min(ha, hb);
      if (overlap < 0.4 * hmin) continue;
      if (hmax / Math.max(1, hmin) > 2.2 && hmin > 4) continue;
      if (gap > 0.85 * hmax + 2) continue;
      parent[find(order[oi])] = find(order[oj]);
    }
  }
  const lineMap = new Map<number, InkComponent[]>();
  strong.forEach((c, i) => {
    const r = find(i);
    lineMap.set(r, [...(lineMap.get(r) ?? []), c]);
  });
  const lines: Line[] = [...lineMap.values()].map((members) => {
    const box = members.map((m) => m.box).reduce(union);
    return { members, box, height: median(members.map((m) => boxH(m.box))) };
  });

  // Weak pieces (hyphens, dots of i, commas) join the line they sit on.
  for (const c of weak) {
    const cy = (c.box.y0 + c.box.y1) / 2;
    let best: Line | null = null;
    let bestGap = Infinity;
    for (const l of lines) {
      if (l.members[0].container !== c.container) continue;
      const pad = l.height * 0.35;
      if (cy < l.box.y0 - pad || cy > l.box.y1 + pad) continue;
      const gap = Math.max(0, c.box.x0 - l.box.x1 - 1, l.box.x0 - c.box.x1 - 1);
      if (gap <= 0.7 * l.height + 2 && gap < bestGap && boxW(c.box) <= 2 * l.height) {
        best = l;
        bestGap = gap;
      }
    }
    if (best) {
      best.members.push(c);
      best.box = union(best.box, c.box);
    }
  }

  // Lines into blocks: stacked lines of similar size, overlapping horizontally.
  const used = new Set<Line>();
  const blocks: InkComponent[][] = [];
  const sorted = [...lines].sort((a, b) => a.box.y0 - b.box.y0);
  for (const l of sorted) {
    if (used.has(l)) continue;
    used.add(l);
    const block = [l];
    let box = l.box;
    // Lines of nothing but upright bars are dashed connectors; never stack them.
    const barsOnly = (x: Line) => x.members.every((c) => isThin(c) || isWeak(c));
    for (const m of sorted) {
      if (barsOnly(l)) break;
      if (used.has(m) || m.members[0].container !== l.members[0].container || barsOnly(m)) continue;
      // A column of single marks on the page is a dotted/dashed line, not a paragraph.
      if (l.members[0].container < 0 && l.members.length === 1 && m.members.length === 1) continue;
      const vgap = m.box.y0 - box.y1;
      const hOverlap = Math.min(box.x1, m.box.x1) - Math.max(box.x0, m.box.x0);
      const sameShape = l.members[0].container >= 0;
      const similar = Math.max(m.height, l.height) / Math.max(1, Math.min(m.height, l.height)) < 1.8;
      const vOverlap = Math.min(box.y1, m.box.y1) - Math.max(box.y0, m.box.y0);
      const hgap = Math.max(m.box.x0 - box.x1, box.x0 - m.box.x1);
      const sameRow = vOverlap >= 0.5 * Math.min(m.height, l.height) && hgap <= Math.max(m.height, l.height) * (sameShape ? 2.5 : 1.2);
      const stacked = vgap >= -2 && vgap <= Math.max(m.height, l.height) * (sameShape ? 1.6 : 1.0) && (sameShape || hOverlap > 0.3 * Math.min(boxW(box), boxW(m.box)));
      if (similar && (sameRow || stacked)) {
        block.push(m);
        used.add(m);
        box = union(box, m.box);
      }
    }
    blocks.push(block.flatMap((b) => b.members));
  }
  return blocks;
}

export interface ReadOptions {
  img: RGBImage;
  labels: Int32Array;
  ocr: OcrEngine | null;
  /** Median capital height of text already accepted, for sanity checks. */
  signal?: AbortSignal;
}

/**
 * Read a block with OCR. Returns null when it is not text after all (a
 * cluster of arrow heads, a dashed line) - its pixels then go to the
 * connector finder.
 */
export async function readBlock(block: InkComponent[], opts: ReadOptions): Promise<TextBlock | null> {
  const { img, labels } = opts;
  const W = img.width;
  const box = block.map((c) => c.box).reduce(union);
  const strong = block.filter((c) => !isWeak(c));
  if (!strong.length) return null;
  // Upright bars alone - one, or a column of them - are lines (a dashed
  // connector), not "I I I".
  if (strong.every(isThin)) return null;
  const surface = block[0].surface;
  const ids = new Set(block.map((c) => c.id));

  // Text colour: the most saturated ink, away from the anti-aliased rim.
  const samples: { d: number; p: number }[] = [];
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const p = y * W + x;
      if (!ids.has(labels[p])) continue;
      samples.push({ d: dist3(img.rgb[p * 3], img.rgb[p * 3 + 1], img.rgb[p * 3 + 2], ...surface), p });
    }
  }
  if (!samples.length) return null;
  samples.sort((a, b) => b.d - a.d);
  const core = samples.slice(0, Math.max(1, Math.ceil(samples.length * 0.35)));
  const color: [number, number, number] = [0, 0, 0];
  for (const s of core) for (let k = 0; k < 3; k++) color[k] += img.rgb[s.p * 3 + k] / core.length;
  const contrast = Math.max(12, dist3(...color, ...surface));

  // Letter height from the solid core of each glyph, not its soft halo.
  const coreBox = new Map<number, Box>();
  for (const s of samples) {
    if (s.d < contrast * 0.5) continue;
    const id = labels[s.p];
    const x = s.p % W;
    const y = (s.p - x) / W;
    const b = coreBox.get(id);
    if (!b) coreBox.set(id, { x0: x, y0: y, x1: x, y1: y });
    else {
      b.x0 = Math.min(b.x0, x);
      b.y0 = Math.min(b.y0, y);
      b.x1 = Math.max(b.x1, x);
      b.y1 = Math.max(b.y1, y);
    }
  }
  // Capitals and ascenders set the size: the tallest group of glyphs, less
  // the odd tail (Q, J) or bracket.
  // Descenders (g, p, y) hang below the baseline; leave them out.
  const rows: InkComponent[][] = [];
  const midY = (c: InkComponent) => (c.box.y0 + c.box.y1) / 2;
  const typical = median(strong.map((c) => boxH(c.box)));
  for (const c of [...strong].sort((a, b) => midY(a) - midY(b))) {
    const row = rows[rows.length - 1];
    if (row && midY(c) - midY(row[row.length - 1]) <= typical * 0.6) row.push(c);
    else rows.push([c]);
  }
  const heights: number[] = [];
  for (const row of rows) {
    const baseline = median(row.map((c) => (coreBox.get(c.id) ?? c.box).y1));
    for (const c of row) {
      const b = coreBox.get(c.id) ?? c.box;
      if (b.y1 <= baseline + Math.max(1, typical * 0.12)) heights.push(boxH(b));
    }
  }
  if (!heights.length) heights.push(typical);
  const top = quantile(heights, 0.9);
  const capHeight = Math.max(4, median(heights.filter((v) => v >= top * 0.85)));

  // Bold: stroke thickness relative to letter height.
  // Bold: stroke thickness of the solid core (area over skeleton length)
  // relative to the letter height.
  const bw = boxW(box);
  const bh = boxH(box);
  const coreMask = new Uint8Array(bw * bh);
  let coreCount = 0;
  for (const s of samples) {
    if (s.d < contrast * 0.5) continue;
    const x = (s.p % W) - box.x0;
    const y = Math.floor(s.p / W) - box.y0;
    coreMask[y * bw + x] = 1;
    coreCount++;
  }
  const skeleton = count(thin(coreMask, bw, bh));
  const bold = coreCount / Math.max(1, skeleton) / capHeight >= 0.18;

  let text = '';
  let confidence = 0;
  if (opts.ocr) {
    const lines = Math.max(1, Math.round((boxH(box) + capHeight * 0.4) / (capHeight * 1.9)));
    const glyphs = glyphCount(strong, capHeight);
    const pad = Math.round(capHeight * 0.6) + 2;
    const cw = boxW(box) + pad * 2;
    const ch = boxH(box) + pad * 2;
    const gray = new Uint8Array(cw * ch).fill(255);
    for (let y = 0; y < boxH(box); y++) {
      for (let x = 0; x < boxW(box); x++) {
        const p = (y + box.y0) * W + x + box.x0;
        if (!ids.has(labels[p])) continue;
        const d = dist3(img.rgb[p * 3], img.rgb[p * 3 + 1], img.rgb[p * 3 + 2], ...surface);
        // Suppress the anti-aliased halo: at small sizes it fills the gaps
        // between letters and makes them run together.
        const ink = Math.max(0, Math.min(1, (d / contrast - 0.35) / 0.4));
        gray[(y + pad) * cw + x + pad] = Math.round(255 * (1 - ink));
      }
    }
    // Tesseract reads best at a cap height of roughly 30-40 px.
    const k = Math.max(1, Math.min(6, 34 / capHeight));
    const nw = Math.round(cw * k);
    const nh = Math.round(ch * k);
    const big = k > 1 ? resizeGray(gray, cw, ch, nw, nh) : gray;

    const mode: OcrMode = lines > 1 ? 'block' : glyphs <= 1 ? 'word' : 'line';
    const image = encodePGM(big, k > 1 ? nw : cw, k > 1 ? nh : ch);
    // Tesseract's layout analysis sometimes gives up on short, heavy words;
    // reading the image as one raw line is the fallback.
    for (const m of lines > 1 ? [mode] : [mode, 'raw' as const]) {
      try {
        const r = await opts.ocr.recognize({ image, mode: m });
        const t = cleanText(r.text);
        if (/[A-Za-z0-9]/.test(t) && r.confidence > confidence) {
          text = t;
          confidence = r.confidence;
        }
      } catch {
        /* try the next mode */
      }
      if (confidence >= 70) break;
    }
    if (!/[A-Za-z0-9]/.test(text)) return null;
    // One bar-like character alone on the page is a piece of a line.
    if (block[0].container < 0 && /^[1Il|!ij:;.,'`-]$/.test(text.trim())) return null;
    // A single blob read as one character is more often an arrow than a letter.
    const minConf = glyphs >= 3 ? 30 : glyphs === 2 ? 45 : block[0].container >= 0 ? 60 : 82;
    if (confidence < minConf) return null;
  } else {
    // Without OCR only blocks that clearly look like writing are kept, as
    // placeholders the user can type into.
    if (glyphCount(strong, capHeight) < 2) return null;
    text = '?';
    confidence = 0;
  }

  return {
    box,
    container: block[0].container,
    text,
    confidence: confidence / 100,
    color,
    capHeight,
    bold,
    lines: Math.max(1, text.split('\n').length),
    componentIds: [...ids],
  };
}

/** Tidy OCR output: trim, collapse spaces, drop stray edge marks. */
export function cleanText(raw: string): string {
  return raw
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').replace(/^[\s|_~`'".,:;]+|[\s|_~`'",:;]+$/g, '').trim())
    .filter(Boolean)
    .join('\n');
}
