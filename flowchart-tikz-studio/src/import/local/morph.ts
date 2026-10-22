import type { Point } from '../../model/types';
import type { Box } from './image';

/**
 * Binary-image operations on `Uint8Array` masks (1 = set), `w * h` long.
 * Small, dependency-free implementations of the classics: connected
 * components, hole filling, a chamfer distance transform, square-element
 * morphology, Zhang-Suen thinning, contour tracing and Douglas-Peucker.
 */

export interface Component {
  id: number;
  area: number;
  box: Box;
  cx: number;
  cy: number;
}

const N8 = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/** Label the set pixels of `mask` (8-connected by default). Labels start at 1. */
export function components(mask: Uint8Array, w: number, h: number, eight = true): { labels: Int32Array; comps: Component[] } {
  const labels = new Int32Array(w * h);
  const comps: Component[] = [];
  const stack = new Int32Array(w * h);
  let next = 1;
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || labels[start]) continue;
    const id = next++;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = id;
    let area = 0;
    let sx = 0;
    let sy = 0;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    while (sp) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
      area++;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let k = 0; k < 8; k += eight ? 1 : 2) {
        const nx = x + N8[k][0];
        const ny = y + N8[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (mask[q] && !labels[q]) {
          labels[q] = id;
          stack[sp++] = q;
        }
      }
    }
    comps.push({ id, area, box: { x0, y0, x1, y1 }, cx: sx / area, cy: sy / area });
  }
  return { labels, comps };
}

/** Set every unset pixel that cannot reach the border through unset pixels. */
export function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (p: number) => {
    if (!mask[p] && !outside[p]) {
      outside[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}

/** Distance (in px, chamfer 3-4 approximation) from each set pixel to the nearest unset one or the edge. */
export function distanceTransform(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? INF : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  }
  for (let i = 0; i < w * h; i++) d[i] /= 3;
  return d;
}

function slide(src: Uint8Array, w: number, h: number, r: number, horizontal: boolean, max: boolean): Uint8Array {
  const out = new Uint8Array(w * h);
  const outer = horizontal ? h : w;
  const inner = horizontal ? w : h;
  for (let o = 0; o < outer; o++) {
    const idx = (i: number) => (horizontal ? o * w + i : i * w + o);
    // Running count of set pixels in the window.
    let count = 0;
    for (let i = -r; i <= r; i++) if (i >= 0 && i < inner && src[idx(i)]) count++;
    for (let i = 0; i < inner; i++) {
      const lo = Math.max(0, i - r);
      const hi = Math.min(inner - 1, i + r);
      const size = hi - lo + 1;
      out[idx(i)] = max ? (count > 0 ? 1 : 0) : count === size && i - r >= 0 && i + r < inner ? 1 : 0;
      const leave = i - r;
      const enter = i + r + 1;
      if (leave >= 0 && src[idx(leave)]) count--;
      if (enter < inner && src[idx(enter)]) count++;
    }
  }
  return out;
}

export function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  return slide(slide(mask, w, h, r, true, true), w, h, r, false, true);
}

export function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  return slide(slide(mask, w, h, r, true, false), w, h, r, false, false);
}

export function open(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return dilate(erode(mask, w, h, r), w, h, r);
}

export function count(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i] ? 1 : 0;
  return n;
}

/** Zhang-Suen thinning to one-pixel-wide skeletons. */
export function thin(mask: Uint8Array, w: number, h: number): Uint8Array {
  const img = mask.slice();
  const get = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img[y * w + x]);
  let changed = true;
  const del: number[] = [];
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!img[y * w + x]) continue;
          const p2 = get(x, y - 1);
          const p3 = get(x + 1, y - 1);
          const p4 = get(x + 1, y);
          const p5 = get(x + 1, y + 1);
          const p6 = get(x, y + 1);
          const p7 = get(x - 1, y + 1);
          const p8 = get(x - 1, y);
          const p9 = get(x - 1, y - 1);
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let a = 0;
          for (let k = 0; k < 8; k++) if (!seq[k] && seq[k + 1]) a++;
          if (a !== 1) continue;
          if (pass === 0 ? p2 * p4 * p6 === 0 && p4 * p6 * p8 === 0 : p2 * p4 * p8 === 0 && p2 * p6 * p8 === 0) del.push(y * w + x);
        }
      }
      if (del.length) {
        changed = true;
        for (const i of del) img[i] = 0;
      }
    }
  }
  return img;
}

/** Outer boundary of the component containing the top-left-most set pixel (Moore tracing). */
export function traceContour(mask: Uint8Array, w: number, h: number): Point[] {
  let start = -1;
  for (let i = 0; i < w * h; i++) {
    if (mask[i]) {
      start = i;
      break;
    }
  }
  if (start < 0) return [];
  const get = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  const sx = start % w;
  const sy = (start - sx) / w;
  const pts: Point[] = [{ x: sx, y: sy }];
  // Directions clockwise starting east (screen coordinates).
  const D = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];
  let x = sx;
  let y = sy;
  let dir = 7; // we arrived "from the west/north": start searching from north-east
  const limit = w * h * 4;
  for (let steps = 0; steps < limit; steps++) {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8; // start two steps back (backtrack rule)
      const nx = x + D[d][0];
      const ny = y + D[d][1];
      if (get(nx, ny)) {
        x = nx;
        y = ny;
        dir = d;
        found = true;
        break;
      }
    }
    if (!found) break;
    if (x === sx && y === sy) break;
    pts.push({ x, y });
  }
  return pts;
}

function perpDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy);
  if (!l) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / l;
}

/** Douglas-Peucker simplification of an open polyline. */
export function simplify(pts: Point[], eps: number): Point[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1;
    let bd = eps;
    for (let i = a + 1; i < b; i++) {
      const d = perpDist(pts[i], pts[a], pts[b]);
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Douglas-Peucker for a closed ring: split at the two mutually farthest points. */
export function simplifyClosed(ring: Point[], eps: number): Point[] {
  if (ring.length < 4) return ring.slice();
  let a = 0;
  let far = 0;
  for (let i = 0; i < ring.length; i++) {
    const d = Math.hypot(ring[i].x - ring[0].x, ring[i].y - ring[0].y);
    if (d > far) {
      far = d;
      a = i;
    }
  }
  let b = 0;
  far = 0;
  for (let i = 0; i < ring.length; i++) {
    const d = Math.hypot(ring[i].x - ring[a].x, ring[i].y - ring[a].y);
    if (d > far) {
      far = d;
      b = i;
    }
  }
  const [i0, i1] = a < b ? [a, b] : [b, a];
  const first = simplify(ring.slice(i0, i1 + 1), eps);
  const second = simplify([...ring.slice(i1), ...ring.slice(0, i0 + 1)], eps);
  return [...first, ...second.slice(1, -1)];
}
