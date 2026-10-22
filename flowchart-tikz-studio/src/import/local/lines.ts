import type { Point } from '../../model/types';
import type { IRArrow } from '../ir/types';
import { Box, boxH, boxW } from './image';
import { components, count, dilate, distanceTransform, fillHoles, simplify, thin } from './morph';

/**
 * Connectors for the offline recogniser.
 *
 * Each remaining ink component is reduced to a one-pixel skeleton. Filled
 * arrow heads show up as thick blobs at a line's end and open (chevron)
 * heads as two short barbs meeting at a point; both are recognised, recorded
 * and removed, leaving plain paths. Dashed and dotted lines arrive as many
 * short pieces, which are chained back together end to end.
 */

export interface ArrowHead {
  tip: Point;
  /** Unit vector the arrow points in. */
  dir: Point;
  kind: IRArrow;
  /**
   * Other readings of a lone, near-equilateral triangle: any side could be
   * its base. The line it ends decides which one is meant.
   */
  alternatives?: { tip: Point; dir: Point }[];
}

export interface Piece {
  /** Ordered skeleton pixels, image px. */
  points: Point[];
  length: number;
  lineWidth: number;
  color: [number, number, number];
  heads: ArrowHead[];
  compId: number;
  /** Only an arrow head (a chevron whose shaft is a separate dash). */
  headOnly?: boolean;
}

export interface ConnectorPath {
  points: Point[];
  lineWidth: number;
  color: [number, number, number];
  dashed: null | { dash: number; gap: number; dotted: boolean };
  arrowStart: ArrowHead | null;
  arrowEnd: ArrowHead | null;
}

const N8: [number, number][] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

const len = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (v: Point): Point => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};
const angleBetween = (a: Point, b: Point) => {
  const ua = unit(a);
  const ub = unit(b);
  return (Math.acos(Math.max(-1, Math.min(1, ua.x * ub.x + ua.y * ub.y))) * 180) / Math.PI;
};

export function polylineLength(pts: Point[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += len(pts[i - 1], pts[i]);
  return l;
}

/** Skeleton graph helpers over a local mask. */
function neighbours(sk: Uint8Array, w: number, h: number, p: number): number[] {
  const x = p % w;
  const y = (p - x) / w;
  const out: number[] = [];
  for (const [dx, dy] of N8) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const q = ny * w + nx;
    if (sk[q]) out.push(q);
  }
  return out;
}

/** Walk from `start` (the first pixel after `from`) until an end or a junction. */
function walk(sk: Uint8Array, w: number, h: number, start: number, from: number, isNode: (p: number) => boolean, avoid?: Set<number>): number[] {
  const path = [from, start];
  let prev = from;
  let cur = start;
  const seen = new Set<number>([from, start]);
  while (!isNode(cur)) {
    const next = neighbours(sk, w, h, cur).filter((q) => q !== prev && !seen.has(q) && !avoid?.has(q));
    if (!next.length) break;
    // Prefer 4-neighbours so diagonal corners do not branch.
    const four = next.filter((q) => Math.abs(q - cur) === 1 || Math.abs(q - cur) === w);
    prev = cur;
    cur = (four.length ? four : next)[0];
    seen.add(cur);
    path.push(cur);
  }
  return path;
}

interface Branch {
  pixels: number[];
  /** Ends at a free end (not another junction). */
  leaf: boolean;
}

function degreeMap(sk: Uint8Array, w: number, h: number): Uint8Array {
  const deg = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) if (sk[p]) deg[p] = neighbours(sk, w, h, p).length;
  return deg;
}

/** Remove short spurs (thinning artefacts) hanging off junctions. */
function pruneSpurs(sk: Uint8Array, w: number, h: number, maxLen: number): void {
  for (let iter = 0; iter < 3; iter++) {
    const deg = degreeMap(sk, w, h);
    let changed = false;
    for (let p = 0; p < w * h; p++) {
      if (!sk[p] || deg[p] !== 1) continue;
      const path = walk(sk, w, h, p, p, (q) => deg[q] >= 3);
      const body = path.slice(1);
      const endsAtJunction = deg[body[body.length - 1]] >= 3;
      if (endsAtJunction && body.length - 1 <= maxLen) {
        for (const q of body.slice(0, -1)) sk[q] = 0;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

function branchDir(pixels: number[], w: number, n: number): Point {
  const a = pixels[0];
  const b = pixels[Math.min(pixels.length - 1, n)];
  return { x: (b % w) - (a % w), y: Math.floor(b / w) - Math.floor(a / w) };
}

/** Analyse one ink component: arrow heads out, skeleton paths in. */
export function componentPieces(
  mask: Uint8Array,
  w: number,
  h: number,
  origin: { x: number; y: number },
  color: [number, number, number],
  compId: number,
  opts: { bareChevron?: boolean } = {},
): Piece[] {
  const area = count(mask);
  if (area < 3) return [];
  // Thinning eats hairline diagonals (1-2 px staircases) from both ends;
  // thickened by a pixel first, they thin to a proper centre line.
  const thinSource = (m: Uint8Array) => (hairline ? dilate(m, w, h, 1) : m);
  let hairline = false;
  let sk = thin(mask, w, h);
  const skLen = Math.max(1, count(sk), Math.max(w, h) - 2);
  // Line width: area over length overestimates short pieces, twice the
  // distance to the edge along the skeleton underestimates thin ones.
  const edgeDist = distanceTransform(mask, w, h);
  const ridge: number[] = [];
  for (let i = 0; i < w * h; i++) if (sk[i]) ridge.push(edgeDist[i]);
  ridge.sort((a, b) => a - b);
  const medRidge = ridge.length ? ridge[Math.floor(ridge.length / 2)] : 1;
  const lw = Math.max(1, Math.min(12, area / skLen, 2 * medRidge));
  hairline = lw < 2.6;
  if (hairline) sk = thin(thinSource(mask), w, h);
  const heads: ArrowHead[] = [];
  const toImg = (p: number): Point => ({ x: (p % w) + origin.x, y: Math.floor(p / w) + origin.y });

  /* ---- a lone filled triangle: an arrow head whose line stops short of it
     (dashed lines) or was drawn apart from it */
  if (opts.bareChevron) {
    const lone = loneTriangle(mask, w, h, area);
    if (lone?.length) {
      const readings = lone.map((r) => ({ tip: { x: r.tip.x + origin.x, y: r.tip.y + origin.y }, dir: r.dir }));
      const [first] = readings;
      return [{ points: [first.tip], length: 0, lineWidth: 1, color, heads: [{ ...first, kind: 'triangle', alternatives: readings }], compId, headOnly: true }];
    }
  }

  /* ---- filled (or hollow) arrow heads: thick blobs */
  const solid = fillHoles(mask, w, h);
  const holeArea = count(solid) - area;
  const dt = distanceTransform(solid, w, h);
  const seedLevel = lw / 2 + 1.6;
  const seeds = new Uint8Array(w * h);
  let anySeed = false;
  for (let i = 0; i < w * h; i++) {
    if (dt[i] >= seedLevel) {
      seeds[i] = 1;
      anySeed = true;
    }
  }
  let lineMask = mask;
  if (anySeed) {
    const grown = dilate(seeds, w, h, Math.ceil(seedLevel) + 1);
    const blob = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) blob[i] = grown[i] && solid[i] ? 1 : 0;
    const bc = components(blob, w, h);
    lineMask = mask.slice();
    for (const b of bc.comps) {
      if (b.area < Math.max(16, (3 * lw) ** 2)) continue;
      if (boxW(b.box) > 60 || boxH(b.box) > 60) continue; // a thick bar, not a head
      // Where the line enters the blob.
      let sx = 0;
      let sy = 0;
      let n = 0;
      let holes = 0;
      for (let i = 0; i < w * h; i++) {
        if (bc.labels[i] !== b.id) continue;
        if (!mask[i]) holes++;
        const x = i % w;
        const y = (i - x) / w;
        for (const [dx, dy] of N8) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (mask[q] && bc.labels[q] !== b.id) {
            sx += nx;
            sy += ny;
            n++;
          }
        }
      }
      if (!n) continue; // an isolated dot, not a head on a line
      const base = { x: sx / n, y: sy / n };
      let tip = base;
      let far = -1;
      for (let i = 0; i < w * h; i++) {
        if (bc.labels[i] !== b.id) continue;
        const p = { x: i % w, y: Math.floor(i / w) };
        const d = len(p, base);
        if (d > far) {
          far = d;
          tip = p;
        }
      }
      if (far < 3 * lw) continue;
      // A head tapers from its base to its tip and sits on some line; the
      // thick joints of bold letters do neither.
      let rest = 0;
      for (let i = 0; i < w * h; i++) if (sk[i] && bc.labels[i] !== b.id) rest++;
      if (rest < 3) continue;
      const axis = unit({ x: tip.x - base.x, y: tip.y - base.y });
      let nearBase = 0;
      let nearTip = 0;
      for (let i = 0; i < w * h; i++) {
        if (bc.labels[i] !== b.id) continue;
        const px = (i % w) - base.x;
        const py = Math.floor(i / w) - base.y;
        const t = (px * axis.x + py * axis.y) / far;
        const across = Math.abs(-px * axis.y + py * axis.x);
        if (t < 0.4) nearBase = Math.max(nearBase, across);
        else if (t > 0.75) nearTip = Math.max(nearTip, across);
      }
      if (nearBase < 1.6 * Math.max(1, nearTip)) continue;
      heads.push({
        tip: { x: tip.x + origin.x, y: tip.y + origin.y },
        dir: unit({ x: tip.x - base.x, y: tip.y - base.y }),
        kind: holes > 0.25 * b.area && holeArea > 0 ? 'open-triangle' : 'triangle',
      });
      for (let i = 0; i < w * h; i++) if (bc.labels[i] === b.id) lineMask[i] = 0;
      // Reconnect the line to the head's base so the path reaches it.
    }
    if (heads.length) sk = thin(thinSource(lineMask), w, h);
  }

  /* ---- skeleton clean-up and open (chevron) heads */
  pruneSpurs(sk, w, h, Math.max(2, Math.round(lw)));
  const barbMax = Math.max(6, Math.min(26, lw * 9));
  for (let iter = 0; iter < 4; iter++) {
    const deg = degreeMap(sk, w, h);
    const isNode = (q: number) => deg[q] >= 3 || deg[q] <= 1;
    const visitedJ = new Set<number>();
    let found = false;
    for (let p = 0; p < w * h && !found; p++) {
      if (!sk[p] || deg[p] < 3 || visitedJ.has(p)) continue;
      // The junction may be a small cluster of pixels: treat it as one node.
      const cluster = new Set<number>([p]);
      const stack = [p];
      while (stack.length) {
        const c = stack.pop()!;
        for (const n of neighbours(sk, w, h, c)) {
          if (deg[n] >= 3 && !cluster.has(n)) {
            cluster.add(n);
            stack.push(n);
          }
        }
      }
      cluster.forEach((c) => visitedJ.add(c));
      const branches: Branch[] = [];
      const claimed = new Set<number>(cluster);
      for (const c of cluster) {
        for (const e of neighbours(sk, w, h, c)) {
          if (claimed.has(e)) continue;
          const pixels = walk(sk, w, h, e, c, isNode, cluster);
          pixels.slice(1).forEach((q) => claimed.add(q));
          branches.push({ pixels, leaf: deg[pixels[pixels.length - 1]] <= 1 });
        }
      }
      if (branches.length !== 3) continue;
      // Try each branch as the shaft; keep the most symmetric reading.
      let pick: { b1: Branch; b2: Branch; ds: Point; asym: number } | null = null;
      for (let si = 0; si < 3; si++) {
        const shaft = branches[si];
        const [b1, b2] = branches.filter((_, i) => i !== si);
        if (!b1.leaf || !b2.leaf) continue;
        const l1 = b1.pixels.length - 1;
        const l2 = b2.pixels.length - 1;
        const ls = shaft.pixels.length - 1;
        // The shaft may be short: on a dashed line it is only the first dash.
        if (l1 > barbMax || l2 > barbMax || ls < Math.max(2, Math.max(l1, l2) * 0.25)) continue;
        if (Math.max(l1, l2) > 2.2 * Math.max(2, Math.min(l1, l2))) continue;
        const d1 = branchDir(b1.pixels, w, 6);
        const d2 = branchDir(b2.pixels, w, 6);
        const ds = branchDir(shaft.pixels, w, 8);
        const spread = angleBetween(d1, d2);
        if (spread < 30 || spread > 160) continue;
        const bis = { x: unit(d1).x + unit(d2).x, y: unit(d1).y + unit(d2).y };
        const asym = angleBetween(bis, ds);
        if (asym > 35) continue;
        if (!pick || asym < pick.asym) pick = { b1, b2, ds, asym };
      }
      if (!pick) continue;
      const { b1, b2, ds } = pick;
      // The tip: the cluster pixel farthest along the arrow's direction.
      const dir = unit({ x: -ds.x, y: -ds.y });
      let tipPx = p;
      let bestAlong = -Infinity;
      for (const c of cluster) {
        const along = (c % w) * dir.x + Math.floor(c / w) * dir.y;
        if (along > bestAlong) {
          bestAlong = along;
          tipPx = c;
        }
      }
      heads.push({ tip: toImg(tipPx), dir, kind: 'open' });
      for (const q of [...b1.pixels.slice(1), ...b2.pixels.slice(1)]) sk[q] = 0;
      found = true;
    }
    if (!found) break;
  }

  /* ---- a bare chevron: "<" on its own (its shaft is dashed or apart) */
  if (opts.bareChevron && !heads.length) {
    const d0 = degreeMap(sk, w, h);
    const endsV: number[] = [];
    let junction = false;
    for (let p = 0; p < w * h; p++) {
      if (!sk[p]) continue;
      if (d0[p] === 1) endsV.push(p);
      if (d0[p] >= 3) junction = true;
    }
    const rawPath = endsV.length === 2 ? walk(sk, w, h, neighbours(sk, w, h, endsV[0])[0] ?? endsV[0], endsV[0], (q) => d0[q] <= 1) : [];
    // Stair-stepped diagonals give pixels three neighbours without being a
    // real fork: a single path from end to end that covers the skeleton is
    // what matters.
    const simplePath = rawPath.length > 0 && rawPath[rawPath.length - 1] === endsV[1] && rawPath.length >= 0.85 * count(sk);
    if ((!junction || simplePath) && endsV.length === 2 && simplePath) {
      const path = rawPath.map(toImg);
      // The apex: the point farthest from the line joining the two ends.
      const A = path[0];
      const B = path[path.length - 1];
      const ab = len(A, B);
      let vi = 0;
      let vd = -1;
      path.forEach((p, i) => {
        const d = ab ? Math.abs((B.x - A.x) * (A.y - p.y) - (A.x - p.x) * (B.y - A.y)) / ab : len(A, p);
        if (d > vd) {
          vd = d;
          vi = i;
        }
      });
      // A blunt apex is a short run of equally distant points: take its middle.
      const far = path.map((p, i) => ({ p, i })).filter(({ p }) => (ab ? Math.abs((B.x - A.x) * (A.y - p.y) - (A.x - p.x) * (B.y - A.y)) / ab : len(A, p)) >= vd - 0.75);
      const mid = far[Math.floor(far.length / 2)]?.i ?? vi;
      const v = far.length > 1 ? { x: (far[0].p.x + far[far.length - 1].p.x) / 2, y: (far[0].p.y + far[far.length - 1].p.y) / 2 } : path[mid];
      const la = len(A, v);
      const lb = len(B, v);
      const ang = angleBetween({ x: A.x - v.x, y: A.y - v.y }, { x: B.x - v.x, y: B.y - v.y });
      const axis = (d: Point) => {
        const a = (Math.atan2(Math.abs(d.y), Math.abs(d.x)) * 180) / Math.PI;
        return a < 8 || a > 82;
      };
      // Both arms on the axes is the corner of a dashed elbow, not a head.
      const corner = axis({ x: A.x - v.x, y: A.y - v.y }) && axis({ x: B.x - v.x, y: B.y - v.y });
      if (
        !corner &&
        vd >= 0.25 * ab &&
        la >= 3 &&
        lb >= 3 &&
        la <= barbMax &&
        lb <= barbMax &&
        Math.max(la, lb) <= 1.5 * Math.min(la, lb) &&
        ang >= 35 &&
        ang <= 130
      ) {
        const ua = unit({ x: A.x - v.x, y: A.y - v.y });
        const ub = unit({ x: B.x - v.x, y: B.y - v.y });
        return [{ points: [v], length: 0, lineWidth: lw, color, heads: [{ tip: v, dir: unit({ x: -(ua.x + ub.x), y: -(ua.y + ub.y) }), kind: 'open' }], compId, headOnly: true }];
      }
    }
  }

  /* ---- paths */
  const deg = degreeMap(sk, w, h);
  const ends: number[] = [];
  for (let p = 0; p < w * h; p++) if (sk[p] && deg[p] <= 1) ends.push(p);
  const pieces: Piece[] = [];
  const colorOf = color;
  if (!ends.length) {
    // A closed loop or a single dot.
    const any = sk.findIndex((v) => v === 1);
    if (any < 0) return [];
    const pts = deg[any] === 0 ? [toImg(any)] : walk(sk, w, h, neighbours(sk, w, h, any)[0], any, () => false).map(toImg);
    pieces.push({ points: pts, length: polylineLength(pts), lineWidth: lw, color: colorOf, heads, compId });
    return pieces;
  }
  // Longest end-to-end path (tree diameter by BFS twice), then leftover branches.
  const bfs = (src: number) => {
    const prev = new Int32Array(w * h).fill(-1);
    const dist = new Int32Array(w * h).fill(-1);
    const q = [src];
    dist[src] = 0;
    let last = src;
    for (let qi = 0; qi < q.length; qi++) {
      const p = q[qi];
      last = p;
      for (const n of neighbours(sk, w, h, p)) {
        if (dist[n] >= 0) continue;
        dist[n] = dist[p] + 1;
        prev[n] = p;
        q.push(n);
      }
    }
    // farthest end
    let far = last;
    for (const e of ends) if (dist[e] > dist[far]) far = e;
    return { prev, dist, far };
  };
  const remaining = sk.slice();
  let guard = 0;
  while (guard++ < 12) {
    const endsLeft = ends.filter((e) => remaining[e]);
    const start = endsLeft[0] ?? remaining.findIndex((v) => v === 1);
    if (start === undefined || start < 0) break;
    const saved = sk;
    sk = remaining;
    const a = bfs(start);
    const b = bfs(a.far);
    sk = saved;
    // b was run from a.far, so walk back from b.far.
    const path: number[] = [];
    for (let p = b.far; p >= 0; p = b.prev[p]) path.push(p);
    for (const p of path) remaining[p] = 0;
    const pts = path.map(toImg);
    const length = polylineLength(pts);
    if (pieces.length === 0 || length >= Math.max(4, lw * 3)) {
      pieces.push({ points: pts, length, lineWidth: lw, color: colorOf, heads: [], compId });
    }
    if (count(remaining) < 2) break;
  }
  // Heads belong to the piece whose end is closest to their tip.
  for (const hd of heads) {
    let best: Piece | null = null;
    let bd = Infinity;
    for (const pc of pieces) {
      const d = Math.min(len(pc.points[0], hd.tip), len(pc.points[pc.points.length - 1], hd.tip));
      if (d < bd) {
        bd = d;
        best = pc;
      }
    }
    if (best && bd <= Math.max(16, lw * 8)) best.heads.push(hd);
  }
  return pieces;
}

/** A small solid triangle: the plausible (tip, direction) readings, best first. */
function loneTriangle(mask: Uint8Array, w: number, h: number, area: number): { tip: Point; dir: Point }[] | null {
  const bw = w - 2;
  const bh = h - 2;
  if (Math.max(bw, bh) > 40 || Math.min(bw, bh) < 5) return null;
  if (count(fillHoles(mask, w, h)) - area > area * 0.1) return null;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    cx += i % w;
    cy += Math.floor(i / w);
  }
  cx /= area;
  cy /= area;
  // The pointing direction: the one along which the shape narrows most,
  // from a wide base to a sharp tip.
  const scored: { dir: Point; score: number; nearBase: number; nearTip: number; tMax: number }[] = [];
  for (let k = 0; k < 24; k++) {
    const a = (k * Math.PI) / 12;
    const dir = { x: Math.cos(a), y: Math.sin(a) };
    let tMin = Infinity;
    let tMax = -Infinity;
    for (let i = 0; i < w * h; i++) {
      if (!mask[i]) continue;
      const t = ((i % w) - cx) * dir.x + (Math.floor(i / w) - cy) * dir.y;
      tMin = Math.min(tMin, t);
      tMax = Math.max(tMax, t);
    }
    const span = tMax - tMin;
    if (span < 4) continue;
    // Full width of the band at the base end and at the tip end: a real
    // head has a straight, wide base and a point; a corner-first direction
    // is narrow at both ends.
    let b0 = Infinity;
    let b1 = -Infinity;
    let t0 = Infinity;
    let t1 = -Infinity;
    for (let i = 0; i < w * h; i++) {
      if (!mask[i]) continue;
      const px = (i % w) - cx;
      const py = Math.floor(i / w) - cy;
      const t = (px * dir.x + py * dir.y - tMin) / span;
      const across = -px * dir.y + py * dir.x;
      if (t < 0.2) {
        b0 = Math.min(b0, across);
        b1 = Math.max(b1, across);
      } else if (t > 0.8) {
        t0 = Math.min(t0, across);
        t1 = Math.max(t1, across);
      }
    }
    const nearBase = b1 >= b0 ? (b1 - b0 + 1) / 2 : 0;
    const nearTip = t1 >= t0 ? (t1 - t0 + 1) / 2 : 0;
    const score = nearBase / Math.max(1, nearTip);
    scored.push({ dir, score, nearBase, nearTip, tMax });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return null;
  const { nearBase, nearTip } = best;
  // Local maxima of the score, well apart: one per side that could be the base.
  const readings: { dir: Point; tMax: number }[] = [];
  for (const c of scored) {
    // A tip clipped where it touches a shape reads blunter than the others.
    if (c.score < 0.45 * best.score || c.score < 1.3) break;
    if (readings.some((r) => angleBetween(r.dir, c.dir) < 50)) continue;
    readings.push(c);
  }
  const tipOf = (dir: Point, tMax: number): Point => {
    let tx = 0;
    let ty = 0;
    let tn = 0;
    for (let i = 0; i < w * h; i++) {
      if (!mask[i]) continue;
      const t = ((i % w) - cx) * dir.x + (Math.floor(i / w) - cy) * dir.y;
      if (t >= tMax - 1) {
        tx += i % w;
        ty += Math.floor(i / w);
        tn++;
      }
    }
    return { x: tx / tn, y: ty / tn };
  };
  const fillRatio = area / (bw * bh);
  if (nearBase < 2 * Math.max(1, nearTip) || nearBase < 2.5 || fillRatio < 0.42 || fillRatio > 0.75) return null;
  return readings.map((r) => ({ tip: tipOf(r.dir, r.tMax), dir: r.dir }));
}

/* ------------------------------------------------------------------ */

interface End {
  piece: number;
  /** 0 = first point, 1 = last point. */
  side: 0 | 1;
  p: Point;
  dir: Point | null;
}

function endOf(pc: Piece, side: 0 | 1): End['p'] {
  return side === 0 ? pc.points[0] : pc.points[pc.points.length - 1];
}

function outward(pc: Piece, side: 0 | 1): Point | null {
  const pts = pc.points;
  if (pts.length < 3 || pc.length < 3) return null;
  const k = Math.min(pts.length - 1, 6);
  const a = side === 0 ? pts[0] : pts[pts.length - 1];
  const b = side === 0 ? pts[k] : pts[pts.length - 1 - k];
  return unit({ x: a.x - b.x, y: a.y - b.y });
}

function hasHeadAt(pc: Piece, side: 0 | 1): boolean {
  const e = endOf(pc, side);
  const o = endOf(pc, side === 0 ? 1 : 0);
  return pc.heads.some((h) => len(h.tip, e) < len(h.tip, o));
}

/** Chain short pieces (dashes, dots) back into whole lines. */
export function chainPieces(all: Piece[]): ConnectorPath[] {
  const orphans = all.filter((p) => p.headOnly).flatMap((p) => p.heads);
  const pieces = all.filter((p) => !p.headOnly);
  const out = chainLines(pieces);
  // Loose arrow heads go on the nearest free line end behind them.
  for (const orphan of orphans) {
    let best: { c: ConnectorPath; end: 'start' | 'end'; d: number; hd: ArrowHead } | null = null;
    for (const reading of orphan.alternatives ?? [orphan]) {
      const hd: ArrowHead = { tip: reading.tip, dir: reading.dir, kind: orphan.kind };
      for (const c of out) {
        for (const end of ['start', 'end'] as const) {
          if ((end === 'start' ? c.arrowStart : c.arrowEnd) !== null) continue;
          const p = end === 'start' ? c.points[0] : c.points[c.points.length - 1];
          const d = len(p, hd.tip);
          const toward = unit({ x: hd.tip.x - p.x, y: hd.tip.y - p.y });
          if (d > Math.max(20, c.lineWidth * 8)) continue;
          const align = toward.x * hd.dir.x + toward.y * hd.dir.y;
          if (d > 2 && align < 0.8) continue;
          // Prefer the reading whose tip lies straight ahead of the line.
          const score = d * (2 - align);
          if (!best || score < best.d) best = { c, end, d: score, hd };
        }
      }
    }
    if (!best) continue;
    if (best.end === 'start') {
      best.c.points.unshift(best.hd.tip);
      best.c.arrowStart = best.hd;
    } else {
      best.c.points.push(best.hd.tip);
      best.c.arrowEnd = best.hd;
    }
  }
  return out;
}

function chainLines(pieces: Piece[]): ConnectorPath[] {
  const shortLen = (pc: Piece) => pc.length <= Math.max(16, pc.lineWidth * 8);
  const ends: End[] = [];
  pieces.forEach((pc, i) => {
    ends.push({ piece: i, side: 0, p: endOf(pc, 0), dir: outward(pc, 0) });
    ends.push({ piece: i, side: 1, p: endOf(pc, 1), dir: outward(pc, 1) });
  });
  const cands: { a: End; b: End; g: number }[] = [];
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i];
      const b = ends[j];
      if (a.piece === b.piece) continue;
      const pa = pieces[a.piece];
      const pb = pieces[b.piece];
      if (!shortLen(pa) && !shortLen(pb)) continue;
      if (hasHeadAt(pa, a.side) || hasHeadAt(pb, b.side)) continue;
      const g = len(a.p, b.p);
      const lwm = Math.max(pa.lineWidth, pb.lineWidth);
      const maxGap = Math.min(22, Math.max(3 * lwm + 5, 1.4 * Math.min(pa.length, pb.length) + 3));
      if (g > maxGap) continue;
      const colorOk = Math.hypot(pa.color[0] - pb.color[0], pa.color[1] - pb.color[1], pa.color[2] - pb.color[2]) < 90;
      if (!colorOk) continue;
      const v = { x: b.p.x - a.p.x, y: b.p.y - a.p.y };
      const okA = !a.dir || g < 1.5 || angleBetween(a.dir, v) <= 40;
      const okB = !b.dir || g < 1.5 || angleBetween(b.dir, { x: -v.x, y: -v.y }) <= 40;
      if (!(okA && okB) && !((okA || okB) && g <= maxGap * 0.8)) continue;
      cands.push({ a, b, g });
    }
  }
  cands.sort((x, y) => x.g - y.g);
  const parent = pieces.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const link = new Map<string, End>();
  const key = (e: End) => `${e.piece}:${e.side}`;
  for (const c of cands) {
    if (link.has(key(c.a)) || link.has(key(c.b))) continue;
    // A dot has one point: both its "ends" are the same place; use each once.
    if (find(c.a.piece) === find(c.b.piece)) continue;
    link.set(key(c.a), c.b);
    link.set(key(c.b), c.a);
    parent[find(c.a.piece)] = find(c.b.piece);
  }

  const done = new Set<number>();
  const out: ConnectorPath[] = [];
  const startOrder = pieces.map((_, i) => i).sort((a, b) => {
    const la = (link.has(`${a}:0`) ? 1 : 0) + (link.has(`${a}:1`) ? 1 : 0);
    const lb = (link.has(`${b}:0`) ? 1 : 0) + (link.has(`${b}:1`) ? 1 : 0);
    return la - lb;
  });
  for (const s of startOrder) {
    if (done.has(s)) continue;
    // Start from a free end.
    let side: 0 | 1 = link.has(`${s}:0`) ? 1 : 0;
    let cur = s;
    const seq: { piece: number; reversed: boolean }[] = [];
    let gaps: number[] = [];
    let safety = 0;
    while (!done.has(cur) && safety++ < 10_000) {
      done.add(cur);
      // Traverse the piece starting at `side`.
      seq.push({ piece: cur, reversed: side === 1 });
      const exitSide: 0 | 1 = side === 0 ? 1 : 0;
      const nxt = link.get(`${cur}:${exitSide}`);
      if (!nxt || done.has(nxt.piece)) break;
      gaps.push(len(endOf(pieces[cur], exitSide), nxt.p));
      cur = nxt.piece;
      side = nxt.side;
    }
    const pts: Point[] = [];
    const heads: ArrowHead[] = [];
    let lwSum = 0;
    const col: [number, number, number] = [0, 0, 0];
    let totalLen = 0;
    for (const it of seq) {
      const pc = pieces[it.piece];
      const p = it.reversed ? [...pc.points].reverse() : pc.points;
      pts.push(...p);
      heads.push(...pc.heads);
      lwSum += pc.lineWidth * Math.max(1, pc.length);
      totalLen += Math.max(1, pc.length);
      for (let k = 0; k < 3; k++) col[k] += pc.color[k] * Math.max(1, pc.length);
    }
    const lw = lwSum / totalLen;
    const color = col.map((v) => v / totalLen) as [number, number, number];
    let dashed: ConnectorPath['dashed'] = null;
    if (seq.length >= 3) {
      const dashLens = seq.map((it) => pieces[it.piece].length + lw);
      const dash = dashLens.slice(1, -1).reduce((a, b) => a + b, 0) / Math.max(1, dashLens.length - 2);
      const gap = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length) - lw;
      dashed = { dash: Math.max(1, dash), gap: Math.max(1, gap), dotted: dash <= lw * 1.3 };
    } else if (seq.length === 2) {
      gaps = gaps.filter((g) => g > 0);
    }
    if (!pts.length) continue;
    // Arrow heads at either end.
    const first = pts[0];
    const last = pts[pts.length - 1];
    let arrowStart: ArrowHead | null = null;
    let arrowEnd: ArrowHead | null = null;
    for (const hd of heads) {
      if (len(hd.tip, first) <= len(hd.tip, last)) arrowStart = arrowStart ?? hd;
      else arrowEnd = arrowEnd ?? hd;
    }
    out.push({ points: pts, lineWidth: lw, color, dashed, arrowStart, arrowEnd });
  }
  return out;
}

/** Reduce a pixel path to its corners; square up nearly-axis-aligned runs. */
export function tidyPath(raw: Point[], lw: number): { points: Point[]; orthogonal: boolean } {
  let pts = simplify(raw, Math.max(1.5, lw * 0.8));
  if (pts.length === 1) pts = [pts[0], pts[0]];
  // Drop tiny zig-zags left by stair-stepped pixels.
  const minSeg = Math.max(3, lw * 1.5);
  pts = pts.filter((p, i) => i === 0 || i === pts.length - 1 || (len(p, pts[i - 1]) >= minSeg && len(p, pts[i + 1]) >= minSeg));
  let orthogonal = true;
  const out = pts.map((p) => ({ ...p }));
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1];
    const b = out[i];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dx <= Math.max(2, 0.1 * dy)) b.x = a.x;
    else if (dy <= Math.max(2, 0.1 * dx)) b.y = a.y;
    else orthogonal = false;
  }
  // Merge collinear neighbours.
  const merged: Point[] = [out[0]];
  for (let i = 1; i < out.length; i++) {
    const p = out[i];
    if (merged.length >= 2) {
      const a = merged[merged.length - 2];
      const b = merged[merged.length - 1];
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (Math.abs(cross) <= 1e-6 * Math.max(1, len(a, p) ** 2) || (a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)) {
        merged[merged.length - 1] = p;
        continue;
      }
    }
    if (len(p, merged[merged.length - 1]) > 0.01) merged.push(p);
  }
  if (merged.length === 1) merged.push({ ...merged[0] });
  return { points: merged, orthogonal };
}

export type { Box };
