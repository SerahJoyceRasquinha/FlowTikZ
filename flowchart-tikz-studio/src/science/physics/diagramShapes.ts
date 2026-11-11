import type { ShapeDef, PortDef } from '../../model/shapes';
import { C, KAPPA, L, M, Seg, Z, polygon, polyline, rect } from '../../model/path';

/**
 * General physics diagram parts. These are plain registry shapes built from
 * the shared path language, so the existing node emitter writes them as TikZ
 * `\draw` paths and every canvas gesture already applies.
 */

const box = (w: number, h: number): PortDef[] => [
  { id: 'n', p: { x: w / 2, y: 0 }, dir: { x: 0, y: -1 } },
  { id: 'e', p: { x: w, y: h / 2 }, dir: { x: 1, y: 0 } },
  { id: 's', p: { x: w / 2, y: h }, dir: { x: 0, y: 1 } },
  { id: 'w', p: { x: 0, y: h / 2 }, dir: { x: -1, y: 0 } },
];

const ring = (cx: number, cy: number, rx: number, ry = rx): Seg[] => {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    M(cx + rx, cy),
    C(cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry),
    C(cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy),
    C(cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry),
    C(cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy),
    Z,
  ];
};

const seg = (x1: number, y1: number, x2: number, y2: number): Seg[] => [M(x1, y1), L(x2, y2)];

const arrowTip = (x: number, y: number, dx: number, dy: number, s: number): Seg[] => {
  const n = Math.hypot(dx, dy) || 1;
  const ux = dx / n;
  const uy = dy / n;
  return polygon([
    { x, y },
    { x: x - ux * s - uy * s * 0.42, y: y - uy * s + ux * s * 0.42 },
    { x: x - ux * s + uy * s * 0.42, y: y - uy * s - ux * s * 0.42 },
  ]);
};

const hatch = (w: number, y: number, n: number, depth: number): Seg[][] => {
  const out: Seg[][] = [];
  for (let i = 0; i <= n; i++) {
    const x = (w * i) / n;
    out.push(seg(x, y, x - depth, y + depth));
  }
  return out;
};

type Part = Omit<ShapeDef, 'category' | 'ports' | 'textBox' | 'flippable'> & { keywords: string; group: string };

const parts: Part[] = [
  {
    id: 'physics.force', label: 'Force vector', group: 'Mechanics', keywords: 'arrow f vector newton',
    defaultSize: { w: 110, h: 20 }, noOutline: true,
    outline: (w, h) => polyline([{ x: 0, y: h / 2 }, { x: w - 10, y: h / 2 }]),
    solids: (w, h) => [arrowTip(w, h / 2, 1, 0, 14)],
  },
  {
    id: 'physics.block', label: 'Mass block', group: 'Mechanics', keywords: 'box m body object',
    defaultSize: { w: 80, h: 60 }, outline: (w, h) => rect(0, 0, w, h),
  },
  {
    id: 'physics.ball', label: 'Ball / particle', group: 'Mechanics', keywords: 'sphere bob mass point',
    defaultSize: { w: 50, h: 50 }, outline: (w, h) => ring(w / 2, h / 2, w / 2, h / 2),
  },
  {
    id: 'physics.incline', label: 'Inclined plane', group: 'Mechanics', keywords: 'ramp wedge slope triangle',
    defaultSize: { w: 200, h: 100 },
    outline: (w, h) => polygon([{ x: 0, y: h }, { x: w, y: h }, { x: w, y: 0 }]),
    decorations: (w, h) => [[M(46, h), C(46, h - 8, 42, h - 18, 38, h - 19)]].map((s) => (w > 60 ? s : [])),
  },
  {
    id: 'physics.surface', label: 'Fixed surface', group: 'Mechanics', keywords: 'ground wall hatch floor support',
    defaultSize: { w: 200, h: 20 }, noOutline: true,
    outline: (w) => polyline([{ x: 0, y: 2 }, { x: w, y: 2 }]),
    decorations: (w, h) => hatch(w, 2, Math.max(4, Math.round(w / 14)), Math.max(6, h - 4)),
  },
  {
    id: 'physics.spring', label: 'Spring', group: 'Mechanics', keywords: 'hooke oscillator zigzag coil k',
    defaultSize: { w: 140, h: 30 }, noOutline: true,
    outline: (w, h) => {
      const lead = w * 0.1;
      const turns = 8;
      const step = (w - 2 * lead) / turns;
      const pts = [{ x: 0, y: h / 2 }, { x: lead, y: h / 2 }];
      for (let i = 0; i < turns; i++) pts.push({ x: lead + step * (i + 0.5), y: i % 2 ? h : 0 });
      pts.push({ x: w - lead, y: h / 2 }, { x: w, y: h / 2 });
      return polyline(pts);
    },
  },
  {
    id: 'physics.pulley', label: 'Pulley', group: 'Mechanics', keywords: 'wheel rope sheave',
    defaultSize: { w: 70, h: 70 },
    outline: (w, h) => ring(w / 2, h / 2, w / 2, h / 2),
    solids: (w, h) => [ring(w / 2, h / 2, 3.5)],
  },
  {
    id: 'physics.pendulum', label: 'Pendulum', group: 'Mechanics', keywords: 'bob string swing',
    defaultSize: { w: 100, h: 160 }, noOutline: true,
    outline: (w) => polyline([{ x: w * 0.15, y: 0 }, { x: w * 0.85, y: 0 }]),
    decorations: (w, h) => [seg(w / 2, 0, w * 0.72, h - 22), seg(w / 2, 0, w / 2, h * 0.75), ...hatch(w * 0.7, 0, 5, -8).map((s) => s.map((p) => (p.c === 'Z' ? p : shift(p, w * 0.15))))],
    bodies: (w, h) => [ring(w * 0.76, h - 12, 12)],
  },
  {
    id: 'physics.axes', label: 'Coordinate axes', group: 'Fields & waves', keywords: 'x y graph origin',
    defaultSize: { w: 170, h: 130 }, noOutline: true,
    outline: (_w, h) => polyline([{ x: 8, y: h - 8 }, { x: 8, y: 12 }]),
    decorations: (w, h) => [seg(8, h - 8, w - 12, h - 8)],
    solids: (w, h) => [arrowTip(8, 0, 0, -1, 12), arrowTip(w, h - 8, 1, 0, 12)],
  },
  {
    id: 'physics.sine', label: 'Sine wave', group: 'Fields & waves', keywords: 'wave oscillation wavelength frequency',
    defaultSize: { w: 200, h: 60 }, noOutline: true,
    outline: (w, h) => {
      const cycles = 2;
      const step = w / (cycles * 2);
      const out: Seg[] = [M(0, h / 2)];
      for (let i = 0; i < cycles * 2; i++) {
        const y = i % 2 ? h : 0;
        const x0 = step * i;
        // Cubic fit of a half sine.
        out.push(C(x0 + step * 0.3642, y + (h / 2 - y) * -0.0, x0 + step * 0.6358, y, x0 + step, h / 2));
      }
      return out;
    },
  },
  {
    id: 'physics.charge-plus', label: 'Positive charge', group: 'Fields & waves', keywords: 'proton + electric q',
    defaultSize: { w: 40, h: 40 }, outline: (w, h) => ring(w / 2, h / 2, w / 2, h / 2),
    decorations: (w, h) => [seg(w * 0.25, h / 2, w * 0.75, h / 2), seg(w / 2, h * 0.25, w / 2, h * 0.75)],
  },
  {
    id: 'physics.charge-minus', label: 'Negative charge', group: 'Fields & waves', keywords: 'electron - electric q',
    defaultSize: { w: 40, h: 40 }, outline: (w, h) => ring(w / 2, h / 2, w / 2, h / 2),
    decorations: (w, h) => [seg(w * 0.25, h / 2, w * 0.75, h / 2)],
  },
  {
    id: 'physics.field-out', label: 'Field out of page', group: 'Fields & waves', keywords: 'magnetic dot b vector',
    defaultSize: { w: 30, h: 30 }, outline: (w, h) => ring(w / 2, h / 2, w / 2, h / 2),
    solids: (w, h) => [ring(w / 2, h / 2, Math.min(w, h) * 0.12)],
  },
  {
    id: 'physics.field-in', label: 'Field into page', group: 'Fields & waves', keywords: 'magnetic cross b vector',
    defaultSize: { w: 30, h: 30 }, outline: (w, h) => ring(w / 2, h / 2, w / 2, h / 2),
    decorations: (w, h) => {
      const k = Math.SQRT1_2;
      const rx = (w / 2) * k;
      const ry = (h / 2) * k;
      return [seg(w / 2 - rx, h / 2 - ry, w / 2 + rx, h / 2 + ry), seg(w / 2 - rx, h / 2 + ry, w / 2 + rx, h / 2 - ry)];
    },
  },
  {
    id: 'physics.lens-convex', label: 'Convex lens', group: 'Optics', keywords: 'converging optics glass',
    defaultSize: { w: 40, h: 150 },
    outline: (w, h) => [M(w / 2, 0), C(w * 1.15, h * 0.3, w * 1.15, h * 0.7, w / 2, h), C(-w * 0.15, h * 0.7, -w * 0.15, h * 0.3, w / 2, 0), Z],
  },
  {
    id: 'physics.lens-concave', label: 'Concave lens', group: 'Optics', keywords: 'diverging optics glass',
    defaultSize: { w: 50, h: 150 },
    outline: (w, h) => [M(0, 0), L(w, 0), C(w * 0.55, h * 0.3, w * 0.55, h * 0.7, w, h), L(0, h), C(w * 0.45, h * 0.7, w * 0.45, h * 0.3, 0, 0), Z],
  },
  {
    id: 'physics.mirror', label: 'Mirror', group: 'Optics', keywords: 'plane reflection optics',
    defaultSize: { w: 20, h: 150 }, noOutline: true,
    outline: (w, h) => polyline([{ x: w - 2, y: 0 }, { x: w - 2, y: h }]),
    decorations: (w, h) => {
      const n = Math.max(4, Math.round(h / 14));
      const out: Seg[][] = [];
      for (let i = 0; i <= n; i++) out.push(seg(w - 2, (h * i) / n, 2, (h * i) / n + w - 4));
      return out;
    },
  },
  {
    id: 'physics.prism', label: 'Prism', group: 'Optics', keywords: 'triangle dispersion glass',
    defaultSize: { w: 120, h: 104 },
    outline: (w, h) => polygon([{ x: w / 2, y: 0 }, { x: w, y: h }, { x: 0, y: h }]),
  },
  {
    id: 'physics.ray', label: 'Light ray', group: 'Optics', keywords: 'beam arrow optics',
    defaultSize: { w: 160, h: 16 }, noOutline: true,
    outline: (w, h) => polyline([{ x: 0, y: h / 2 }, { x: w, y: h / 2 }]),
    solids: (w, h) => [arrowTip(w * 0.56, h / 2, 1, 0, 11)],
  },
];

function shift(s: Seg, dx: number): Seg {
  if (s.c === 'M' || s.c === 'L') return { ...s, p: { x: s.p.x + dx, y: s.p.y } };
  return s;
}

export const PHYSICS_SHAPE_DEFS: (ShapeDef & { keywords: string; group: string })[] = parts.map((p) => ({
  ...p,
  category: 'Basic',
  ports: box,
  textBox: (w: number, h: number) => ({ x: 0, y: 0, w, h }),
  flippable: true,
}));

export const PHYSICS_GROUPS = Array.from(new Set(parts.map((p) => p.group)));
