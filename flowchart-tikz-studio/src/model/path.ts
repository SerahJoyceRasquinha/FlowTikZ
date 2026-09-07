import type { Point } from './types';
import { round } from './geometry';

/**
 * A minimal path language understood by every renderer in this project.
 *
 * Deliberately limited to move / line / cubic / close: TikZ has a direct,
 * lossless spelling for each of those (`--`, `.. controls .. and .. ..`,
 * `-- cycle`). Elliptical arcs are approximated as cubics at construction
 * time so that the SVG canvas and the compiled PDF trace identical curves.
 */
export type Seg =
  | { c: 'M'; p: Point }
  | { c: 'L'; p: Point }
  | { c: 'C'; c1: Point; c2: Point; p: Point }
  | { c: 'Z' };

/** Circle-to-cubic magic constant. */
export const KAPPA = 0.5522847498307936;

export function M(x: number, y: number): Seg {
  return { c: 'M', p: { x, y } };
}
export function L(x: number, y: number): Seg {
  return { c: 'L', p: { x, y } };
}
export function C(
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  x: number,
  y: number,
): Seg {
  return { c: 'C', c1: { x: c1x, y: c1y }, c2: { x: c2x, y: c2y }, p: { x, y } };
}
export const Z: Seg = { c: 'Z' };

/** Closed polygon through the given points. */
export function polygon(points: Point[]): Seg[] {
  if (points.length === 0) return [];
  const segs: Seg[] = [M(points[0].x, points[0].y)];
  for (let i = 1; i < points.length; i++) segs.push(L(points[i].x, points[i].y));
  segs.push(Z);
  return segs;
}

/** Open polyline. */
export function polyline(points: Point[]): Seg[] {
  if (points.length === 0) return [];
  const segs: Seg[] = [M(points[0].x, points[0].y)];
  for (let i = 1; i < points.length; i++) segs.push(L(points[i].x, points[i].y));
  return segs;
}

export function rect(x: number, y: number, w: number, h: number): Seg[] {
  return polygon([
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]);
}

export function roundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): Seg[] {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr <= 0.001) return rect(x, y, w, h);
  const k = rr * KAPPA;
  return [
    M(x + rr, y),
    L(x + w - rr, y),
    C(x + w - rr + k, y, x + w, y + rr - k, x + w, y + rr),
    L(x + w, y + h - rr),
    C(x + w, y + h - rr + k, x + w - rr + k, y + h, x + w - rr, y + h),
    L(x + rr, y + h),
    C(x + rr - k, y + h, x, y + h - rr + k, x, y + h - rr),
    L(x, y + rr),
    C(x, y + rr - k, x + rr - k, y, x + rr, y),
    Z,
  ];
}

export function ellipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): Seg[] {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    M(cx, cy - ry),
    C(cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy),
    C(cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry),
    C(cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy),
    C(cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry),
    Z,
  ];
}

/**
 * A horizontal "wave" (as on the bottom of a Document symbol), from (x0,y) to
 * (x1,y) with the given amplitude. Emitted as two cubics so both renderers
 * agree exactly.
 */
export function wave(
  x0: number,
  x1: number,
  y: number,
  amp: number,
): Seg[] {
  const q = (x1 - x0) / 4;
  return [
    C(x0 + q, y + amp * 1.4, x0 + q * 2 - q * 0.2, y + amp * 1.2, x0 + q * 2, y),
    C(x0 + q * 2 + q * 0.2, y - amp * 1.2, x1 - q, y - amp * 1.4, x1, y),
  ];
}

export function translateSegs(segs: Seg[], dx: number, dy: number): Seg[] {
  const t = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
  return segs.map((s) => {
    if (s.c === 'M') return { c: 'M', p: t(s.p) } as Seg;
    if (s.c === 'L') return { c: 'L', p: t(s.p) } as Seg;
    if (s.c === 'C') return { c: 'C', c1: t(s.c1), c2: t(s.c2), p: t(s.p) } as Seg;
    return s;
  });
}

/** Serialise to an SVG `d` attribute. */
export function segsToSvgPath(segs: Seg[], dp = 3): string {
  const n = (v: number) => round(v, dp);
  const out: string[] = [];
  for (const s of segs) {
    switch (s.c) {
      case 'M':
        out.push(`M ${n(s.p.x)} ${n(s.p.y)}`);
        break;
      case 'L':
        out.push(`L ${n(s.p.x)} ${n(s.p.y)}`);
        break;
      case 'C':
        out.push(
          `C ${n(s.c1.x)} ${n(s.c1.y)} ${n(s.c2.x)} ${n(s.c2.y)} ${n(s.p.x)} ${n(s.p.y)}`,
        );
        break;
      case 'Z':
        out.push('Z');
        break;
    }
  }
  return out.join(' ');
}

/** True when the path is closed (and therefore fillable). */
export function isClosed(segs: Seg[]): boolean {
  return segs.some((s) => s.c === 'Z');
}
