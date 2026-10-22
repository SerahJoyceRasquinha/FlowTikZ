import type { Point } from '../../model/types';
import type { Seg } from '../../model/path';

/**
 * SVG path data -> the project's four-command path language.
 *
 * Every SVG command is supported. Quadratics are promoted to cubics exactly,
 * elliptical arcs are converted to cubics (at most 90 degrees per piece, the
 * standard error of which is far below a pixel), and H/V/S/T are expanded.
 * The result is absolute and can be rendered by the canvas and emitted as TikZ
 * without further approximation.
 */

const CMD = /[MmLlHhVvCcSsQqTtAaZz]/;

function tokenize(d: string): (string | number)[] {
  const out: (string | number)[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    if (m[1]) out.push(m[1]);
    else out.push(Number(m[2]));
  }
  return out;
}

/** Flags in arc commands may be written without separators ("a1 1 0 00 1 1"). */
function tokenizeArcAware(d: string): (string | number)[] {
  const out: (string | number)[] = [];
  let i = 0;
  let current = '';
  let argIndex = 0;
  const num = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
  while (i < d.length) {
    const ch = d[i];
    if (CMD.test(ch)) {
      out.push(ch);
      current = ch.toLowerCase();
      argIndex = 0;
      i++;
      continue;
    }
    if (/[\s,]/.test(ch)) {
      i++;
      continue;
    }
    if (current === 'a' && (argIndex % 7 === 3 || argIndex % 7 === 4) && (ch === '0' || ch === '1')) {
      out.push(Number(ch));
      argIndex++;
      i++;
      continue;
    }
    const m = num.exec(d.slice(i));
    if (!m) {
      i++;
      continue;
    }
    out.push(Number(m[0]));
    argIndex++;
    i += m[0].length;
  }
  return out;
}

/** Arc to cubic segments, following the SVG implementation notes (F.6). */
export function arcToCubics(
  p0: Point,
  rxIn: number,
  ryIn: number,
  phiDeg: number,
  largeArc: boolean,
  sweep: boolean,
  p1: Point,
): Seg[] {
  if (p0.x === p1.x && p0.y === p1.y) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx < 1e-9 || ry < 1e-9) return [{ c: 'L', p: p1 }];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2;
  const dy = (p0.y - p1.y) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (p0.x + p1.x) / 2;
  const cy = sin * cxp + cos * cyp + (p0.y + p1.y) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dtheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  else if (sweep && dtheta < 0) dtheta += 2 * Math.PI;

  const pieces = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2) - 1e-9));
  const delta = dtheta / pieces;
  const t = (4 / 3) * Math.tan(delta / 4);
  const segs: Seg[] = [];
  let a = theta1;
  const point = (ang: number): Point => ({
    x: cx + rx * Math.cos(ang) * cos - ry * Math.sin(ang) * sin,
    y: cy + rx * Math.cos(ang) * sin + ry * Math.sin(ang) * cos,
  });
  const deriv = (ang: number): Point => ({
    x: -rx * Math.sin(ang) * cos - ry * Math.cos(ang) * sin,
    y: -rx * Math.sin(ang) * sin + ry * Math.cos(ang) * cos,
  });
  for (let i = 0; i < pieces; i++) {
    const b = a + delta;
    const pa = point(a);
    const pb = i === pieces - 1 ? p1 : point(b);
    const da = deriv(a);
    const db = deriv(b);
    segs.push({
      c: 'C',
      c1: { x: pa.x + t * da.x, y: pa.y + t * da.y },
      c2: { x: pb.x - t * db.x, y: pb.y - t * db.y },
      p: pb,
    });
    a = b;
  }
  return segs;
}

export class PathDataError extends Error {}

/** Parse path data into absolute segments. Malformed data throws. */
export function parsePathData(d: string): Seg[] {
  const tokens = /[Aa]/.test(d) ? tokenizeArcAware(d) : tokenize(d);
  const segs: Seg[] = [];
  let i = 0;
  let cmd = '';
  let cur: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let lastCtrl: Point | null = null;
  let lastCmd = '';

  const next = (): number => {
    const v = tokens[i++];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new PathDataError('Malformed path data');
    return v;
  };

  let guard = 0;
  while (i < tokens.length) {
    if (guard++ > 200_000) throw new PathDataError('Path data is too long');
    const t = tokens[i];
    if (typeof t === 'string') {
      cmd = t;
      i++;
      if (cmd === 'Z' || cmd === 'z') {
        segs.push({ c: 'Z' });
        cur = start;
        lastCtrl = null;
        lastCmd = 'Z';
        continue;
      }
    } else if (!cmd) {
      throw new PathDataError('Path data must begin with a command');
    }
    const rel = cmd === cmd.toLowerCase();
    const off = (p: Point): Point => (rel ? { x: cur.x + p.x, y: cur.y + p.y } : p);
    switch (cmd.toUpperCase()) {
      case 'M': {
        const p = off({ x: next(), y: next() });
        segs.push({ c: 'M', p });
        cur = p;
        start = p;
        lastCtrl = null;
        // Further coordinate pairs after a moveto are implicit linetos.
        cmd = rel ? 'l' : 'L';
        lastCmd = 'M';
        break;
      }
      case 'L': {
        const p = off({ x: next(), y: next() });
        segs.push({ c: 'L', p });
        cur = p;
        lastCtrl = null;
        lastCmd = 'L';
        break;
      }
      case 'H': {
        const x = next();
        const p = { x: rel ? cur.x + x : x, y: cur.y };
        segs.push({ c: 'L', p });
        cur = p;
        lastCtrl = null;
        lastCmd = 'L';
        break;
      }
      case 'V': {
        const y = next();
        const p = { x: cur.x, y: rel ? cur.y + y : y };
        segs.push({ c: 'L', p });
        cur = p;
        lastCtrl = null;
        lastCmd = 'L';
        break;
      }
      case 'C': {
        const c1 = off({ x: next(), y: next() });
        const c2 = off({ x: next(), y: next() });
        const p = off({ x: next(), y: next() });
        segs.push({ c: 'C', c1, c2, p });
        cur = p;
        lastCtrl = c2;
        lastCmd = 'C';
        break;
      }
      case 'S': {
        const c1: Point = lastCtrl && lastCmd === 'C' ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : cur;
        const c2 = off({ x: next(), y: next() });
        const p = off({ x: next(), y: next() });
        segs.push({ c: 'C', c1, c2, p });
        cur = p;
        lastCtrl = c2;
        lastCmd = 'C';
        break;
      }
      case 'Q': {
        const q = off({ x: next(), y: next() });
        const p = off({ x: next(), y: next() });
        segs.push(quad(cur, q, p));
        cur = p;
        lastCtrl = q;
        lastCmd = 'Q';
        break;
      }
      case 'T': {
        const q: Point = lastCtrl && lastCmd === 'Q' ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : cur;
        const p = off({ x: next(), y: next() });
        segs.push(quad(cur, q, p));
        cur = p;
        lastCtrl = q;
        lastCmd = 'Q';
        break;
      }
      case 'A': {
        const rx = next();
        const ry = next();
        const rot = next();
        const large = next() !== 0;
        const sweep = next() !== 0;
        const p = off({ x: next(), y: next() });
        segs.push(...arcToCubics(cur, rx, ry, rot, large, sweep, p));
        cur = p;
        lastCtrl = null;
        lastCmd = 'A';
        break;
      }
      default:
        throw new PathDataError(`Unknown path command ${cmd}`);
    }
    // Implicit repetition: a further number simply repeats `cmd`.
  }
  if (segs.length && segs[0].c !== 'M') throw new PathDataError('Path data must begin with a moveto');
  return segs;
}

function quad(p0: Point, q: Point, p1: Point): Seg {
  return {
    c: 'C',
    c1: { x: p0.x + (2 / 3) * (q.x - p0.x), y: p0.y + (2 / 3) * (q.y - p0.y) },
    c2: { x: p1.x + (2 / 3) * (q.x - p1.x), y: p1.y + (2 / 3) * (q.y - p1.y) },
    p: p1,
  };
}

/** Split a path into its subpaths (each beginning with M). */
export function subpaths(segs: Seg[]): Seg[][] {
  const out: Seg[][] = [];
  for (const s of segs) {
    if (s.c === 'M' || out.length === 0) out.push([]);
    out[out.length - 1].push(s);
  }
  return out.filter((sp) => sp.length > 1);
}

/** Vertices of a path made only of lines (null if it contains curves). */
export function polygonVertices(segs: Seg[]): Point[] | null {
  const pts: Point[] = [];
  for (const s of segs) {
    if (s.c === 'C') return null;
    if (s.c === 'M' || s.c === 'L') pts.push(s.p);
  }
  // Drop a closing vertex that repeats the first.
  if (pts.length > 1) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) pts.pop();
  }
  return pts;
}
