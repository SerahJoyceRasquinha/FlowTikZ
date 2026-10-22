import type { Rect } from '../../model/types';

/**
 * Background detection by *connectivity*, not by colour.
 *
 * "Remove every white pixel" would erase every white-filled shape. What makes
 * a pixel background is that it belongs to the region that surrounds the
 * drawing - the one that touches the edge of the image. A white process box
 * has a border all the way round it, so its white interior is *not* connected
 * to the image edge and is kept, however white it is.
 *
 * The analysis:
 *  1. Decide what the background looks like from the image border (fully
 *     transparent, or the dominant border colour - robust to scans, paper
 *     tint, screenshots, coloured backgrounds).
 *  2. Flood-fill from the border through pixels that look like background.
 *     That region, and only that region, is the background.
 *  3. Report the content bounds (so surrounding whitespace can be cropped
 *     before analysis) and how many background-coloured pixels were *kept*
 *     because they are enclosed - evidence of white shapes.
 *
 * Pure and synchronous over an RGBA buffer, so it runs in a Web Worker.
 */

export interface BackgroundAnalysis {
  width: number;
  height: number;
  /** Background colour as #rrggbb, or null when the background is transparent. */
  color: string | null;
  transparent: boolean;
  /** Share of the border that agreed on the background, 0..1. */
  confidence: number;
  /** 1 where the pixel is background. */
  mask: Uint8Array;
  backgroundPixels: number;
  /** Background-coloured pixels that are enclosed by the drawing (kept). */
  enclosedPixels: number;
  /** Bounds of everything that is not background. */
  contentBox: Rect;
  /** Colour tolerance used, in RGB distance. */
  tolerance: number;
}

function hex2(v: number) {
  return Math.round(v).toString(16).padStart(2, '0');
}

export function analyzeBackground(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): BackgroundAnalysis {
  const n = width * height;
  const mask = new Uint8Array(n);
  const empty: BackgroundAnalysis = {
    width,
    height,
    color: null,
    transparent: false,
    confidence: 0,
    mask,
    backgroundPixels: 0,
    enclosedPixels: 0,
    contentBox: { x: 0, y: 0, w: width, h: height },
    tolerance: 0,
  };
  if (width < 3 || height < 3 || rgba.length < n * 4) return empty;

  /* ---- 1. border statistics */
  const ring = Math.max(1, Math.min(3, Math.floor(Math.min(width, height) / 50)));
  const border: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= ring && y >= ring && x < width - ring && y < height - ring) {
        x = width - ring - 1;
        continue;
      }
      border.push(y * width + x);
    }
  }
  let transparentCount = 0;
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (const i of border) {
    const o = i * 4;
    if (rgba[o + 3] < 24) {
      transparentCount++;
      continue;
    }
    const key = ((rgba[o] >> 4) << 8) | ((rgba[o + 1] >> 4) << 4) | (rgba[o + 2] >> 4);
    const b = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    b.count++;
    b.r += rgba[o];
    b.g += rgba[o + 1];
    b.b += rgba[o + 2];
    buckets.set(key, b);
  }

  let isBg: (o: number) => boolean;
  let color: string | null = null;
  let transparent = false;
  let confidence: number;
  let tolerance = 0;

  if (transparentCount / border.length >= 0.6) {
    transparent = true;
    confidence = transparentCount / border.length;
    isBg = (o) => rgba[o + 3] < 24;
  } else {
    // Merge neighbouring buckets: paper grain and JPEG noise straddle edges.
    let best: { count: number; r: number; g: number; b: number } | null = null;
    for (const [key, b] of buckets) {
      let total = { ...b };
      for (const [k2, b2] of buckets) {
        if (k2 === key) continue;
        const dr = Math.abs((k2 >> 8) - (key >> 8));
        const dg = Math.abs(((k2 >> 4) & 15) - ((key >> 4) & 15));
        const db = Math.abs((k2 & 15) - (key & 15));
        if (dr <= 1 && dg <= 1 && db <= 1) {
          total = { count: total.count + b2.count, r: total.r + b2.r, g: total.g + b2.g, b: total.b + b2.b };
        }
      }
      if (!best || total.count > best.count) best = total;
    }
    if (!best) return empty;
    confidence = best.count / border.length;
    const br = best.r / best.count;
    const bgc = best.g / best.count;
    const bb = best.b / best.count;
    color = `#${hex2(br)}${hex2(bgc)}${hex2(bb)}`;
    // Tolerance from the spread of the border itself: a clean export gets a
    // tight threshold, a photographed page a looser one.
    let variance = 0;
    let samples = 0;
    for (const i of border) {
      const o = i * 4;
      // Transparent pixels carry arbitrary colour values: not part of the spread.
      if (rgba[o + 3] < 24) continue;
      const d = Math.hypot(rgba[o] - br, rgba[o + 1] - bgc, rgba[o + 2] - bb);
      if (d < 60) {
        variance += d * d;
        samples++;
      }
    }
    const std = samples ? Math.sqrt(variance / samples) : 0;
    tolerance = Math.min(70, Math.max(18, std * 3 + 16));
    const t2 = tolerance * tolerance;
    isBg = (o) => {
      if (rgba[o + 3] < 24) return true;
      const dr = rgba[o] - br;
      const dg = rgba[o + 1] - bgc;
      const db = rgba[o + 2] - bb;
      return dr * dr + dg * dg + db * db <= t2;
    };
    if (confidence < 0.45) {
      // No dominant border colour (the drawing runs off the edge, or a busy
      // screenshot): nothing is removed rather than guessing.
      return { ...empty, color, confidence, tolerance };
    }
  }

  /* ---- 2. flood fill from the border */
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (const i of border) {
    if (!mask[i] && isBg(i * 4)) {
      mask[i] = 1;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    const y = (i - x) / width;
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (y > 0) visit(i - width);
    if (y < height - 1) visit(i + width);
  }
  function visit(j: number) {
    if (mask[j]) return;
    if (!isBg(j * 4)) return;
    mask[j] = 1;
    queue[tail++] = j;
  }

  /* ---- 3. statistics and content bounds */
  let backgroundPixels = 0;
  let enclosedPixels = 0;
  const rowCount = new Uint32Array(height);
  const colCount = new Uint32Array(width);
  for (let i = 0; i < n; i++) {
    if (mask[i]) {
      backgroundPixels++;
      continue;
    }
    const x = i % width;
    const y = (i - x) / width;
    rowCount[y]++;
    colCount[x]++;
    if (isBg(i * 4)) enclosedPixels++;
  }
  // Ignore isolated specks (dust on a scan) when bounding the content.
  const minRun = Math.max(1, Math.floor(Math.min(width, height) / 400));
  let x0 = 0;
  while (x0 < width && colCount[x0] <= minRun) x0++;
  let x1 = width - 1;
  while (x1 > x0 && colCount[x1] <= minRun) x1--;
  let y0 = 0;
  while (y0 < height && rowCount[y0] <= minRun) y0++;
  let y1 = height - 1;
  while (y1 > y0 && rowCount[y1] <= minRun) y1--;
  const contentBox = x0 >= width || y0 >= height ? { x: 0, y: 0, w: width, h: height } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };

  return {
    width,
    height,
    color,
    transparent,
    confidence,
    mask,
    backgroundPixels,
    enclosedPixels,
    contentBox,
    tolerance,
  };
}

/** Fraction of sample points inside `box` (analysis pixels) that are background. */
export function backgroundShare(a: BackgroundAnalysis, box: Rect, inset = 0.2): number {
  const x0 = box.x + box.w * inset;
  const y0 = box.y + box.h * inset;
  const w = box.w * (1 - inset * 2);
  const h = box.h * (1 - inset * 2);
  let bg = 0;
  let total = 0;
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const x = Math.round(x0 + (w * i) / steps);
      const y = Math.round(y0 + (h * j) / steps);
      if (x < 0 || y < 0 || x >= a.width || y >= a.height) continue;
      total++;
      if (a.mask[y * a.width + x]) bg++;
    }
  }
  return total ? bg / total : 0;
}

/** A copy of the image with background pixels made transparent. */
export function removeBackgroundPixels(rgba: Uint8Array | Uint8ClampedArray, a: BackgroundAnalysis): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < a.mask.length; i++) if (a.mask[i]) out[i * 4 + 3] = 0;
  return out;
}
