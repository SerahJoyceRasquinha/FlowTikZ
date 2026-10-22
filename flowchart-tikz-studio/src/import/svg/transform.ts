import type { Point } from '../../model/types';
import type { Seg } from '../../model/path';

/**
 * 2-D affine transforms, SVG convention: [a b c d e f] maps
 *   x' = a x + c y + e,   y' = b x + d y + f.
 */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function apply(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function translateM(tx: number, ty: number): Matrix {
  return [1, 0, 0, 1, tx, ty];
}

export function scaleM(sx: number, sy = sx): Matrix {
  return [sx, 0, 0, sy, 0, 0];
}

export function rotateM(deg: number, cx = 0, cy = 0): Matrix {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const rot: Matrix = [c, s, -s, c, 0, 0];
  if (!cx && !cy) return rot;
  return multiply(multiply(translateM(cx, cy), rot), translateM(-cx, -cy));
}

/** Parse an SVG `transform` attribute. Unparseable input yields identity. */
export function parseTransform(src: string | undefined): Matrix {
  if (!src) return IDENTITY;
  let m: Matrix = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src))) {
    const args = match[2]
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (args.some((v) => !Number.isFinite(v))) continue;
    let t: Matrix = IDENTITY;
    switch (match[1].toLowerCase()) {
      case 'matrix':
        if (args.length === 6) t = args as Matrix;
        break;
      case 'translate':
        t = translateM(args[0] ?? 0, args[1] ?? 0);
        break;
      case 'scale':
        t = scaleM(args[0] ?? 1, args[1] ?? args[0] ?? 1);
        break;
      case 'rotate':
        t = rotateM(args[0] ?? 0, args[1] ?? 0, args[2] ?? 0);
        break;
      case 'skewx':
        t = [1, 0, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewy':
        t = [1, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = multiply(m, t);
  }
  return m;
}

export interface Decomposed {
  tx: number;
  ty: number;
  /** Degrees, clockwise on screen. */
  rotation: number;
  sx: number;
  sy: number;
  /** True when the matrix contains skew or a reflection. */
  skewed: boolean;
}

/** Split into translate * rotate * scale, flagging skew / mirroring. */
export function decompose(m: Matrix): Decomposed {
  const [a, b, c, d, e, f] = m;
  const sx = Math.hypot(a, b);
  const det = a * d - b * c;
  const sy = sx > 1e-12 ? det / sx : 0;
  const rotation = (Math.atan2(b, a) * 180) / Math.PI;
  // Orthogonality of the column vectors: zero for pure rotate+scale.
  const dot = a * c + b * d;
  const skewed = Math.abs(dot) > 1e-6 * Math.max(1, sx * Math.abs(sy)) || sy < 0;
  return { tx: e, ty: f, rotation, sx, sy: Math.abs(sy), skewed };
}

/** Mean linear scale of a matrix (for stroke widths and font sizes). */
export function meanScale(m: Matrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
}

export function transformSegs(segs: Seg[], m: Matrix): Seg[] {
  return segs.map((s) =>
    s.c === 'Z'
      ? s
      : s.c === 'C'
        ? { c: 'C', c1: apply(m, s.c1), c2: apply(m, s.c2), p: apply(m, s.p) }
        : { c: s.c, p: apply(m, s.p) },
  );
}

export function isIdentity(m: Matrix): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}
