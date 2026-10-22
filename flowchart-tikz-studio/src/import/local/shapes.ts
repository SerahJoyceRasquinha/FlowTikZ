import type { Point } from '../../model/types';
import type { IRShapeType } from '../ir/types';
import { Box, RGBImage, boxH, boxW, dist3, mixDistance } from './image';
import { components, count, dilate, distanceTransform, fillHoles, open, simplifyClosed, traceContour } from './morph';

/**
 * Shape detection for the offline recogniser.
 *
 *  1. The image is split into regions of (nearly) uniform colour.
 *  2. A region is a shape body when, with its holes (text) filled, it is
 *     large, thick and compact. That covers filled shapes directly, and
 *     outlined shapes through their interior - an enclosed region bounded
 *     by the outline, whatever its colour (white-on-white included).
 *  3. The body's outline is probed for a stroke of a different colour.
 *  4. The filled silhouette is compared with parametric templates of the
 *     flowchart symbols; the best match wins, and anything that matches
 *     none of them is kept as an exact polygon, so nothing is lost.
 */

export interface Region {
  id: number;
  area: number;
  box: Box;
  color: [number, number, number];
}

export interface Segmentation {
  /** Region id per pixel; 0 = page background. */
  labels: Int32Array;
  regions: Region[];
}

export function segment(img: RGBImage, bgMask: Uint8Array, tol: number): Segmentation {
  const { width: w, height: h, rgb } = img;
  const labels = new Int32Array(w * h);
  const regions: Region[] = [{ id: 0, area: 0, box: { x0: 0, y0: 0, x1: 0, y1: 0 }, color: [0, 0, 0] }];
  const stack = new Int32Array(w * h);
  const localTol = tol * 0.7;
  for (let start = 0; start < w * h; start++) {
    if (bgMask[start] || labels[start]) continue;
    const id = regions.length;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = id;
    let n = 0;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    let mr = rgb[start * 3];
    let mg = rgb[start * 3 + 1];
    let mb = rgb[start * 3 + 2];
    while (sp) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
      n++;
      sr += rgb[p * 3];
      sg += rgb[p * 3 + 1];
      sb += rgb[p * 3 + 2];
      if ((n & 63) === 0) {
        mr = sr / n;
        mg = sg / n;
        mb = sb / n;
      }
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const pr = rgb[p * 3];
      const pg = rgb[p * 3 + 1];
      const pb = rgb[p * 3 + 2];
      const tryQ = (q: number) => {
        if (labels[q] || bgMask[q]) return;
        const qr = rgb[q * 3];
        const qg = rgb[q * 3 + 1];
        const qb = rgb[q * 3 + 2];
        if (dist3(qr, qg, qb, mr, mg, mb) > tol) return;
        if (dist3(qr, qg, qb, pr, pg, pb) > localTol) return;
        labels[q] = id;
        stack[sp++] = q;
      };
      if (x > 0) tryQ(p - 1);
      if (x < w - 1) tryQ(p + 1);
      if (y > 0) tryQ(p - w);
      if (y < h - 1) tryQ(p + w);
    }
    regions.push({ id, area: n, box: { x0, y0, x1, y1 }, color: [sr / n, sg / n, sb / n] });
  }
  return { labels, regions };
}

/* ------------------------------------------------------------------ */

export interface ShapeCandidate {
  regionId: number;
  /** Bounds of the body (the fill), image px, inclusive. */
  box: Box;
  /** Filled silhouette of the body within `box`. */
  mask: Uint8Array;
  fill: [number, number, number];
  /** True when the body is page-coloured (an outlined shape on the page). */
  pageColoured: boolean;
  stroke: { color: [number, number, number]; width: number } | null;
  /** Pixels this shape accounts for (body + outline + anti-aliasing), image-sized. */
  thickness: number;
  type: IRShapeType;
  score: number;
  cornerRadius: number;
  /** Exact outline (image px) when the silhouette matched no template. */
  polygon?: Point[];
  /** Cylinders: height of the lid, whose rim line is part of the shape. */
  lidHeight?: number;
}

interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

function cropOf(b: Box, pad: number, W: number, H: number): Crop {
  const x = Math.max(0, b.x0 - pad);
  const y = Math.max(0, b.y0 - pad);
  return { x, y, w: Math.min(W - 1, b.x1 + pad) - x + 1, h: Math.min(H - 1, b.y1 + pad) - y + 1 };
}

function maskBox(mask: Uint8Array, w: number, h: number): Box | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

function subMask(mask: Uint8Array, w: number, b: Box): Uint8Array {
  const bw = boxW(b);
  const bh = boxH(b);
  const out = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) out[y * bw + x] = mask[(y + b.y0) * w + x + b.x0];
  return out;
}

export interface ShapeOptions {
  tol: number;
  bgColor: [number, number, number];
  /** Smallest body area worth considering, px. */
  minArea: number;
  /** Colour distance under which a fill counts as the page itself. */
  pageTol: number;
}

/** Find shape bodies among the segmented regions. */
export function findShapes(img: RGBImage, seg: Segmentation, bgMask: Uint8Array, opts: ShapeOptions): ShapeCandidate[] {
  const W = img.width;
  const H = img.height;
  const out: ShapeCandidate[] = [];
  for (const r of seg.regions) {
    if (r.id === 0 || r.area < opts.minArea * 0.35) continue;
    const bw = boxW(r.box);
    const bh = boxH(r.box);
    if (bw < 12 || bh < 10) continue;
    const c = cropOf(r.box, 1, W, H);
    const own = new Uint8Array(c.w * c.h);
    for (let y = 0; y < c.h; y++) {
      for (let x = 0; x < c.w; x++) if (seg.labels[(y + c.y) * W + x + c.x] === r.id) own[y * c.w + x] = 1;
    }
    let filled = fillHoles(own, c.w, c.h);
    let area = count(filled);
    if (area < opts.minArea) continue;
    // Hollow regions (outlines, rings, letters like "O") are not bodies:
    // their enclosed interior is a region of its own and is judged there.
    if (r.area / area < 0.45) continue;
    let dt = distanceTransform(filled, c.w, c.h);
    let D = 0;
    for (let i = 0; i < dt.length; i++) if (dt[i] > D) D = dt[i];
    if (D < 4) continue;

    // Cut off thin appendages of the same colour (a connector drawn in the
    // shape's colour and touching it), keeping sharp corners intact.
    const k = Math.max(2, Math.min(5, Math.round(D * 0.25)));
    const opened = open(filled, c.w, c.h, k);
    const diff = new Uint8Array(c.w * c.h);
    for (let i = 0; i < diff.length; i++) diff[i] = filled[i] && !opened[i] ? 1 : 0;
    const dc = components(diff, c.w, c.h);
    let cut = false;
    for (const comp of dc.comps) {
      if (Math.max(boxW(comp.box), boxH(comp.box)) >= 5 * k && comp.area >= 4 * k) {
        for (let i = 0; i < diff.length; i++) if (dc.labels[i] === comp.id) filled[i] = 0;
        cut = true;
      }
    }
    if (cut) {
      // Keep the largest remaining piece.
      const pc = components(filled, c.w, c.h, false);
      const big = pc.comps.sort((a, b) => b.area - a.area)[0];
      if (!big) continue;
      for (let i = 0; i < filled.length; i++) filled[i] = pc.labels[i] === big.id ? 1 : 0;
      area = big.area;
      dt = distanceTransform(filled, c.w, c.h);
    }
    const lb = maskBox(filled, c.w, c.h);
    if (!lb) continue;
    const mw = boxW(lb);
    const mh = boxH(lb);
    if (Math.min(mw, mh) < 12 || area / (mw * mh) < 0.3) continue;
    const mask = subMask(filled, c.w, lb);
    const box: Box = { x0: lb.x0 + c.x, y0: lb.y0 + c.y, x1: lb.x1 + c.x, y1: lb.y1 + c.y };
    const pageColoured = dist3(...r.color, ...opts.bgColor) <= opts.pageTol;
    const stroke = probeStroke(img, bgMask, mask, box, r.color, opts);
    if (pageColoured && !stroke) continue; // page showing through a gap: not a shape
    if (pageColoured && stroke && stroke.width > 0.3 * Math.min(mw, mh)) continue; // the counter of a bold letter
    const cls = classify(mask, mw, mh);
    // A page-coloured area that matches no symbol is a gap enclosed by lines
    // and neighbouring shapes (a loop-back connector), not a shape.
    if (pageColoured && cls.type === 'polygon') continue;
    out.push({
      regionId: r.id,
      box,
      mask,
      fill: r.color,
      pageColoured,
      stroke,
      thickness: D,
      ...cls,
      polygon: cls.polygon?.map((p) => ({ x: p.x + box.x0, y: p.y + box.y0 })),
    });
  }
  return out;
}

/**
 * Look outward from a body for an outline: rings 1..8 px out, each pixel
 * classified as fill, page, an anti-aliased mix of the two, or "other". A
 * consistent band of "other" is the stroke.
 */
function probeStroke(
  img: RGBImage,
  bgMask: Uint8Array,
  mask: Uint8Array,
  box: Box,
  fill: [number, number, number],
  opts: ShapeOptions,
): { color: [number, number, number]; width: number } | null {
  const W = img.width;
  const H = img.height;
  const pad = 10;
  const c = cropOf(box, pad, W, H);
  const base = new Uint8Array(c.w * c.h);
  const bw = boxW(box);
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) if (mask[(y - box.y0) * bw + (x - box.x0)]) base[(y - c.y) * c.w + (x - c.x)] = 1;
  }
  let prev: Uint8Array = base;
  let width = 0;
  let started = false;
  let sum = [0, 0, 0];
  let n = 0;
  for (let d = 1; d <= 8; d++) {
    const grown = dilate(base, c.w, c.h, d);
    let ringCount = 0;
    let other = 0;
    const acc = [0, 0, 0];
    for (let i = 0; i < grown.length; i++) {
      if (!grown[i] || prev[i]) continue;
      const x = (i % c.w) + c.x;
      const y = Math.floor(i / c.w) + c.y;
      const p = y * W + x;
      ringCount++;
      if (bgMask[p]) continue;
      const px = [img.rgb[p * 3], img.rgb[p * 3 + 1], img.rgb[p * 3 + 2]];
      if (dist3(px[0], px[1], px[2], ...fill) <= opts.tol) continue;
      if (mixDistance(px, fill, opts.bgColor).d <= opts.tol * 0.5) continue;
      if (started && n) {
        const m = [sum[0] / n, sum[1] / n, sum[2] / n];
        if (dist3(px[0], px[1], px[2], m[0], m[1], m[2]) > opts.tol * 1.5) continue;
      }
      other++;
      acc[0] += px[0];
      acc[1] += px[1];
      acc[2] += px[2];
    }
    prev = grown;
    const share = ringCount ? other / ringCount : 0;
    if (share >= (started ? 0.45 : 0.6)) {
      started = true;
      width++;
      sum = [sum[0] + acc[0], sum[1] + acc[1], sum[2] + acc[2]];
      n += other;
    } else if (started || d >= 2) {
      break;
    }
  }
  if (!started || !n) return null;
  return { color: [sum[0] / n, sum[1] / n, sum[2] / n], width };
}

/* ------------------------------------------------------------ classify */

type Inside = (u: number, v: number) => boolean;

interface Template {
  type: IRShapeType;
  inside: Inside;
  /** Exact outline in unit coordinates, for non-native variants. */
  outline?: [number, number][];
  cornerRadius?: number;
}

function templates(w: number, h: number, cornerPx: number): Template[] {
  const t: Template[] = [];
  const rr = (rPx: number): Inside => {
    const ru = rPx / w;
    const rv = rPx / h;
    return (u, v) => {
      const du = Math.min(u, 1 - u);
      const dv = Math.min(v, 1 - v);
      if (du >= ru || dv >= rv) return true;
      const a = (ru - du) / ru;
      const b = (rv - dv) / rv;
      return a * a + b * b <= 1;
    };
  };
  const m = Math.min(w, h);
  const elongated = Math.max(w, h) / m >= 1.2;
  if (cornerPx >= 0.42 * m && elongated) t.push({ type: 'terminator', inside: rr(m / 2), cornerRadius: m / 2 });
  // Corners that round off the whole side of a squarish box make a circle:
  // left to the ellipse template.
  else if (cornerPx >= 0.42 * m) t.push({ type: 'rectangle', inside: () => true });
  else if (cornerPx >= 2) t.push({ type: 'rounded-rectangle', inside: rr(cornerPx), cornerRadius: cornerPx });
  else t.push({ type: 'rectangle', inside: () => true });
  t.push({ type: 'ellipse', inside: (u, v) => (2 * u - 1) ** 2 + (2 * v - 1) ** 2 <= 1 });
  t.push({ type: 'diamond', inside: (u, v) => Math.abs(2 * u - 1) + Math.abs(2 * v - 1) <= 1 });
  // Diamonds with rounded corners: the box is measured on the rounded tips.
  for (const f of [1.06, 1.12, 1.18]) t.push({ type: 'diamond', inside: (u, v) => Math.abs(2 * u - 1) + Math.abs(2 * v - 1) <= f });
  for (const s of [0.08, 0.12, 0.16, 0.2, 0.25, 0.3, 0.4]) {
    t.push({ type: 'parallelogram', inside: (u, v) => u >= s * (1 - v) && u <= 1 - s * v });
    t.push({
      type: 'polygon',
      inside: (u, v) => u >= s * v && u <= 1 - s * (1 - v),
      outline: [
        [0, 0],
        [1 - s, 0],
        [1, 1],
        [s, 1],
      ],
    });
    t.push({ type: 'trapezoid', inside: (u, v) => u >= s * v && u <= 1 - s * v });
    t.push({
      type: 'polygon',
      inside: (u, v) => u >= s * (1 - v) && u <= 1 - s * (1 - v),
      outline: [
        [s, 0],
        [1 - s, 0],
        [1, 1],
        [0, 1],
      ],
    });
  }
  for (const c of [0.1, 0.15, 0.2, 0.25, 0.3]) {
    t.push({ type: 'hexagon', inside: (u, v) => u >= c * Math.abs(2 * v - 1) && u <= 1 - c * Math.abs(2 * v - 1) });
  }
  t.push({ type: 'triangle', inside: (u, v) => Math.abs(2 * u - 1) <= v });
  t.push({ type: 'inverted-triangle', inside: (u, v) => Math.abs(2 * u - 1) <= 1 - v });
  for (const a of [0.1, 0.15, 0.2]) {
    t.push({ type: 'document', inside: (u, v) => v <= 1 - a / 2 + (a / 2) * Math.sin(2 * Math.PI * u + Math.PI) });
    t.push({ type: 'document', inside: (u, v) => v <= 1 - a / 2 + (a / 2) * Math.sin(2 * Math.PI * u) });
  }
  for (const s of [0.15, 0.25, 0.35]) t.push({ type: 'manual-input', inside: (u, v) => v >= s * (1 - u) });
  t.push({ type: 'off-page', inside: (u, v) => v <= 0.75 || Math.abs(2 * u - 1) <= (1 - v) / 0.25 });
  t.push({ type: 'delay', inside: (u, v) => u <= 0.5 || ((u - 0.5) / 0.5) ** 2 + (2 * v - 1) ** 2 <= 1 });
  return t;
}

/** Radius of rounded corners, from the empty area in the corners of the box. */
function cornerRadius(mask: Uint8Array, w: number, h: number): number {
  const m = Math.floor(Math.min(w, h) / 2);
  let total = 0;
  for (const [cx, cy, sx, sy] of [
    [0, 0, 1, 1],
    [w - 1, 0, -1, 1],
    [0, h - 1, 1, -1],
    [w - 1, h - 1, -1, -1],
  ]) {
    // Empty pixels in the corner square, counted from the corner inwards
    // along each row until the first set pixel.
    let empty = 0;
    for (let j = 0; j < m; j++) {
      const y = cy + sy * j;
      for (let i = 0; i < m; i++) {
        const x = cx + sx * i;
        if (mask[y * w + x]) break;
        empty++;
      }
    }
    total += empty;
  }
  const r = Math.sqrt(total / 4 / (1 - Math.PI / 4));
  return r < 2 ? 0 : Math.min(r, Math.min(w, h) / 2);
}

export function classify(mask: Uint8Array, w: number, h: number): Pick<ShapeCandidate, 'type' | 'score' | 'cornerRadius' | 'polygon'> {
  const gw = Math.min(w, 96);
  const gh = Math.min(h, 96);
  const samples = new Uint8Array(gw * gh);
  let setCount = 0;
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const x = Math.min(w - 1, Math.floor(((i + 0.5) / gw) * w));
      const y = Math.min(h - 1, Math.floor(((j + 0.5) / gh) * h));
      samples[j * gw + i] = mask[y * w + x];
      setCount += samples[j * gw + i];
    }
  }
  const corner = cornerRadius(mask, w, h);
  let best: { t: Template; iou: number } | null = null;
  for (const t of templates(w, h, corner)) {
    let inter = 0;
    let uni = 0;
    for (let j = 0; j < gh; j++) {
      const v = (j + 0.5) / gh;
      for (let i = 0; i < gw; i++) {
        const u = (i + 0.5) / gw;
        const a = samples[j * gw + i];
        const b = t.inside(u, v) ? 1 : 0;
        if (a && b) inter++;
        if (a || b) uni++;
      }
    }
    const iou = uni ? inter / uni : 0;
    // Earlier templates are simpler; a later one must be clearly better.
    if (!best || iou > best.iou + 0.004) best = { t, iou };
  }
  if (best && best.iou >= 0.88) {
    let type = best.t.type;
    if (type === 'ellipse' && Math.abs(w - h) <= 0.06 * Math.max(w, h)) type = 'circle';
    return {
      type,
      score: best.iou,
      cornerRadius: best.t.cornerRadius ?? 0,
      polygon: best.t.outline?.map(([u, v]) => ({ x: u * (w - 1), y: v * (h - 1) })),
    };
  }
  // No template fits: keep the exact silhouette.
  const pad = new Uint8Array((w + 2) * (h + 2));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pad[(y + 1) * (w + 2) + x + 1] = mask[y * w + x];
  const ring = traceContour(pad, w + 2, h + 2).map((p) => ({ x: p.x - 1, y: p.y - 1 }));
  const poly = simplifyClosed(ring, Math.max(1.2, Math.min(w, h) * 0.015));
  return { type: 'polygon', score: best?.iou ?? 0, cornerRadius: 0, polygon: poly.length >= 3 ? poly : undefined };
}

/** Pixels that belong to a shape (body, outline and the anti-aliased rim). */
export function paintShapeFootprint(target: Uint8Array, W: number, H: number, s: ShapeCandidate, seg: Segmentation): void {
  const extra = (s.stroke?.width ?? 0) + 1;
  const c = cropOf(s.box, extra + 1, W, H);
  const base = new Uint8Array(c.w * c.h);
  const bw = boxW(s.box);
  for (let y = s.box.y0; y <= s.box.y1; y++) {
    for (let x = s.box.x0; x <= s.box.x1; x++) {
      const p = y * W + x;
      // The body's own pixels only - text inside it (holes) stays ink.
      if (s.mask[(y - s.box.y0) * bw + (x - s.box.x0)] && seg.labels[p] === s.regionId) base[(y - c.y) * c.w + (x - c.x)] = 1;
    }
  }
  // The rim: grow outwards from the silhouette, not into the text holes.
  const sil = new Uint8Array(c.w * c.h);
  for (let y = s.box.y0; y <= s.box.y1; y++) {
    for (let x = s.box.x0; x <= s.box.x1; x++) if (s.mask[(y - s.box.y0) * bw + (x - s.box.x0)]) sil[(y - c.y) * c.w + (x - c.x)] = 1;
  }
  const rim = dilate(sil, c.w, c.h, extra);
  // A cylinder's lid rim is drawn across its body: part of the outline.
  const rimRows = s.lidHeight ? s.box.y0 + s.lidHeight * 1.25 : -1;
  const strokeColor = s.stroke?.color;
  for (let i = 0; i < base.length; i++) {
    if (strokeColor && sil[i] && Math.floor(i / c.w) + c.y <= rimRows) {
      const p = (Math.floor(i / c.w) + c.y) * W + (i % c.w) + c.x;
      const px = seg.regions[seg.labels[p]]?.color;
      if (px && Math.hypot(px[0] - strokeColor[0], px[1] - strokeColor[1], px[2] - strokeColor[2]) <= 80) base[i] = 1;
    }
    if (!(base[i] || (rim[i] && !sil[i]))) continue;
    const x = (i % c.w) + c.x;
    const y = Math.floor(i / c.w) + c.y;
    target[y * W + x] = 1;
  }
}
