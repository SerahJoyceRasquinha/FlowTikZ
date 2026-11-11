import type { Point } from '../../model/types';
import type { PortDef, ShapeDef } from '../../model/shapes';
import { C, KAPPA, L, M, Seg, Z, polygon, polyline } from '../../model/path';

/**
 * Electrical symbol library.
 *
 * Each component is one ordinary entry in the shape registry, so it is
 * selected, dragged, rotated, snapped and hit-tested by the existing canvas
 * code, and wires are ordinary connectors bound to its terminals. The table
 * below records both faces of a component: how the canvas draws it, and which
 * CircuiTikZ element the generator emits for it.
 *
 * The anchors of the three- and four-terminal parts were measured from a real
 * CircuiTikZ compile (see `docs/SCIENCE.md`), so a wire ends exactly on the
 * compiled terminal.
 */

export type CircuitGroup =
  | 'Passive'
  | 'Sources'
  | 'Switches & protection'
  | 'Semiconductors'
  | 'Meters & machines'
  | 'Connections';

interface Art {
  /** Stroked only. */
  strokes?: Seg[][];
  /** Closed outlines that take the fill colour. */
  bodies?: Seg[][];
  /** Filled with the line colour (arrowheads, dots, thick plates). */
  solids?: Seg[][];
}

export interface CircuitDef {
  id: string;
  label: string;
  group: CircuitGroup;
  keywords: string;
  /**
   * `bipole`  drawn with `to[name]` between two terminals; the leads stretch.
   * `node`    a CircuiTikZ node with named anchors.
   * `oneport` a node whose centre is its single connection point.
   */
  mode: 'bipole' | 'node' | 'oneport';
  /** Element name in CircuiTikZ. May include `=text` for labelled bipoles. */
  tikz: string;
  /** Default size of the box, in diagram units. */
  size: { w: number; h: number };
  /** Bipoles: body length as a fraction of the bipole length unit. */
  body?: number;
  /** Letter drawn inside the symbol on the canvas. */
  glyph?: string;
  /** Prefix for the first auto-suggested label, e.g. R, C. */
  designator?: string;
  /** Drawing. Bipoles: origin at the centre, `u` is the bipole length unit. */
  art: (u: number, w: number, h: number) => Art;
  /** Terminals beyond the left/right pair of a bipole, or all of a node's. */
  ports?: (w: number, h: number) => PortDef[];
  /** Node mode: where the TikZ centre sits, as a fraction of the box. */
  origin?: Point;
}

/** Bipole length unit `u`, in du, for a box of height `h`. */
export const bipoleUnit = (h: number) => h * 1.75;

const circle = (cx: number, cy: number, r: number): Seg[] => {
  const k = r * KAPPA;
  return [
    M(cx + r, cy),
    C(cx + r, cy + k, cx + k, cy + r, cx, cy + r),
    C(cx - k, cy + r, cx - r, cy + k, cx - r, cy),
    C(cx - r, cy - k, cx - k, cy - r, cx, cy - r),
    C(cx + k, cy - r, cx + r, cy - k, cx + r, cy),
    Z,
  ];
};

const seg = (x1: number, y1: number, x2: number, y2: number): Seg[] => [M(x1, y1), L(x2, y2)];

/** Filled arrowhead at (x, y) pointing along (dx, dy). */
function head(x: number, y: number, dx: number, dy: number, size: number): Seg[] {
  const n = Math.hypot(dx, dy) || 1;
  const ux = dx / n;
  const uy = dy / n;
  return polygon([
    { x, y },
    { x: x - ux * size - uy * size * 0.38, y: y - uy * size + ux * size * 0.38 },
    { x: x - ux * size + uy * size * 0.38, y: y - uy * size - ux * size * 0.38 },
  ]);
}

function zigzag(u: number): Seg[] {
  const half = 0.4 * u;
  const amp = 0.15 * u;
  const step = (2 * half) / 6;
  const pts: Point[] = [{ x: -half, y: 0 }];
  for (let i = 0; i < 6; i++) pts.push({ x: -half + step * (i + 0.5), y: i % 2 === 0 ? -amp : amp });
  pts.push({ x: half, y: 0 });
  return polyline(pts);
}

function humps(u: number): Seg[] {
  const half = 0.4 * u;
  const n = 4;
  const step = (2 * half) / n;
  const rise = 0.2 * u;
  const out: Seg[] = [M(-half, 0)];
  for (let i = 0; i < n; i++) {
    const x0 = -half + step * i;
    out.push(C(x0, -rise, x0 + step, -rise, x0 + step, 0));
  }
  return out;
}

const diagonalArrow = (u: number, r = 0.32): Art => ({
  strokes: [seg(-r * u, r * u, r * u * 0.9, -r * u * 0.9)],
  solids: [head(r * u, -r * u, 1, -1, 0.14 * u)],
});

const merge = (...arts: Art[]): Art => ({
  strokes: arts.flatMap((a) => a.strokes ?? []),
  bodies: arts.flatMap((a) => a.bodies ?? []),
  solids: arts.flatMap((a) => a.solids ?? []),
});

const R = 0.3; // radius of round symbols, in u

const roundBody = (u: number): Art => ({ bodies: [circle(0, 0, R * u)] });

const diode = (u: number): Art => ({
  bodies: [polygon([{ x: -0.15 * u, y: -0.2 * u }, { x: 0.15 * u, y: 0 }, { x: -0.15 * u, y: 0.2 * u }])],
  strokes: [seg(0.15 * u, -0.2 * u, 0.15 * u, 0.2 * u), seg(-0.15 * u, 0, 0.15 * u, 0)],
});

const cornerPorts = (w: number, h: number): PortDef[] => [
  { id: 'a1', p: { x: 0, y: 0 }, dir: { x: -1, y: 0 } },
  { id: 'a2', p: { x: 0, y: h }, dir: { x: -1, y: 0 } },
  { id: 'b1', p: { x: w, y: 0 }, dir: { x: 1, y: 0 } },
  { id: 'b2', p: { x: w, y: h }, dir: { x: 1, y: 0 } },
];

/** All four directions from one point: a wire may leave a dot any way it likes. */
const hubPorts = (w: number, h: number): PortDef[] => {
  const p = { x: w / 2, y: h / 2 };
  return [
    { id: 'n', p, dir: { x: 0, y: -1 } },
    { id: 'e', p, dir: { x: 1, y: 0 } },
    { id: 's', p, dir: { x: 0, y: 1 } },
    { id: 'w', p, dir: { x: -1, y: 0 } },
  ];
};

const topPort = (w: number): PortDef[] => [{ id: 'n', p: { x: w / 2, y: 0 }, dir: { x: 0, y: -1 } }];

const BJT_SIZE = { w: 42, h: 77 };
const MOS_SIZE = { w: 49, h: 77 };
const OPAMP_SIZE = { w: 119, h: 98 };
const TRANSFORMER_SIZE = { w: 105, h: 105 };

function bjt(pnp: boolean) {
  return (_u: number, w: number, h: number): Art => {
    const barX = w * 0.48;
    const top = h * 0.22;
    const bottom = h * 0.78;
    const armTop = h * 0.36;
    const armBottom = h * 0.64;
    // Collector and emitter leave the base bar diagonally, then run vertically.
    const upper: Seg[] = polyline([
      { x: barX, y: armTop },
      { x: w, y: top },
      { x: w, y: 0 },
    ]);
    const lower: Seg[] = polyline([
      { x: barX, y: armBottom },
      { x: w, y: bottom },
      { x: w, y: h },
    ]);
    const solids = pnp
      ? [head(barX + (w - barX) * 0.25, armTop - (armTop - top) * 0.25, barX - w, armTop - top, 9)]
      : [head(w - (w - barX) * 0.12, bottom - (bottom - armBottom) * 0.12, w - barX, bottom - armBottom, 9)];
    return {
      strokes: [seg(0, h / 2, barX, h / 2), seg(barX, h * 0.28, barX, h * 0.72), upper, lower],
      solids,
    };
  };
}

function mos(p: boolean) {
  return (_u: number, w: number, h: number): Art => {
    const gateX = w * 0.42;
    const chanX = w * 0.58;
    const top = h * 0.3;
    const bottom = h * 0.7;
    const out: Art = {
      strokes: [
        seg(0, h / 2, gateX, h / 2),
        seg(gateX, top, gateX, bottom),
        seg(chanX, top * 0.95, chanX, bottom * 1.02),
        polyline([{ x: w, y: 0 }, { x: w, y: top }, { x: chanX, y: top }]),
        polyline([{ x: w, y: h }, { x: w, y: bottom }, { x: chanX, y: bottom }]),
      ],
    };
    if (p) out.strokes!.push(circle(gateX - 4, h / 2, 3.2));
    return out;
  };
}

const transistorPorts =
  (a: string, b: string, c: string) =>
  (w: number, h: number): PortDef[] => [
    { id: a, p: { x: 0, y: h / 2 }, dir: { x: -1, y: 0 } },
    { id: b, p: { x: w, y: 0 }, dir: { x: 0, y: -1 } },
    { id: c, p: { x: w, y: h }, dir: { x: 0, y: 1 } },
  ];

/** Bipole body with both straight halves of a contact. */
function switchArt(closed: boolean) {
  return (u: number): Art => {
    const half = 0.25 * u;
    return closed
      ? { strokes: [seg(-half, 0, half, -0.03 * u), seg(half, -0.12 * u, half, 0.02 * u)] }
      : { strokes: [seg(-half, 0, half * 0.85, -0.2 * u)] };
  };
}

export const CIRCUIT_DEFS: CircuitDef[] = [
  /* ------------------------------------------------------------- passive */
  {
    id: 'circuit.resistor', label: 'Resistor', group: 'Passive', keywords: 'r ohm zigzag american',
    mode: 'bipole', tikz: 'R', size: { w: 100, h: 40 }, body: 0.8, designator: 'R',
    art: (u) => ({ strokes: [zigzag(u)] }),
  },
  {
    id: 'circuit.resistor-iec', label: 'Resistor (IEC)', group: 'Passive', keywords: 'generic box european impedance',
    mode: 'bipole', tikz: 'generic', size: { w: 100, h: 40 }, body: 0.8, designator: 'R',
    art: (u) => ({ bodies: [polygon([{ x: -0.4 * u, y: -0.15 * u }, { x: 0.4 * u, y: -0.15 * u }, { x: 0.4 * u, y: 0.15 * u }, { x: -0.4 * u, y: 0.15 * u }])] }),
  },
  {
    id: 'circuit.variable-resistor', label: 'Variable resistor', group: 'Passive', keywords: 'rheostat vr adjustable',
    mode: 'bipole', tikz: 'vR', size: { w: 100, h: 40 }, body: 0.8, designator: 'R',
    art: (u) => merge({ strokes: [zigzag(u)] }, diagonalArrow(u)),
  },
  {
    id: 'circuit.potentiometer', label: 'Potentiometer', group: 'Passive', keywords: 'pot wiper three terminal',
    mode: 'bipole', tikz: 'pR', size: { w: 100, h: 40 }, body: 0.8, designator: 'R',
    art: (u) => ({ strokes: [zigzag(u), seg(0, -0.4 * u, 0, -0.2 * u)], solids: [head(0, -0.15 * u, 0, 1, 0.12 * u)] }),
    ports: (w, h) => [
      { id: 'wiper', p: { x: w / 2, y: h / 2 - 0.4 * bipoleUnit(h) }, dir: { x: 0, y: -1 } },
    ],
  },
  {
    id: 'circuit.capacitor', label: 'Capacitor', group: 'Passive', keywords: 'c farad plates',
    mode: 'bipole', tikz: 'C', size: { w: 100, h: 40 }, body: 0.2, designator: 'C',
    art: (u) => ({ strokes: [seg(-0.1 * u, -0.3 * u, -0.1 * u, 0.3 * u), seg(0.1 * u, -0.3 * u, 0.1 * u, 0.3 * u)] }),
  },
  {
    id: 'circuit.variable-capacitor', label: 'Variable capacitor', group: 'Passive', keywords: 'trimmer tuning vc',
    mode: 'bipole', tikz: 'vC', size: { w: 100, h: 40 }, body: 0.2, designator: 'C',
    art: (u) => merge({ strokes: [seg(-0.1 * u, -0.3 * u, -0.1 * u, 0.3 * u), seg(0.1 * u, -0.3 * u, 0.1 * u, 0.3 * u)] }, diagonalArrow(u, 0.4)),
  },
  {
    id: 'circuit.polar-capacitor', label: 'Polarised capacitor', group: 'Passive', keywords: 'electrolytic polar ec',
    mode: 'bipole', tikz: 'eC', size: { w: 100, h: 40 }, body: 0.2, designator: 'C',
    art: (u) => ({
      strokes: [seg(-0.1 * u, -0.3 * u, -0.1 * u, 0.3 * u), seg(-0.25 * u, -0.28 * u, -0.17 * u, -0.28 * u), seg(-0.21 * u, -0.32 * u, -0.21 * u, -0.24 * u)],
      solids: [polygon([{ x: 0.05 * u, y: -0.3 * u }, { x: 0.13 * u, y: -0.3 * u }, { x: 0.13 * u, y: 0.3 * u }, { x: 0.05 * u, y: 0.3 * u }])],
    }),
  },
  {
    id: 'circuit.inductor', label: 'Inductor / coil', group: 'Passive', keywords: 'l henry coil choke',
    mode: 'bipole', tikz: 'L', size: { w: 100, h: 40 }, body: 0.8, designator: 'L',
    art: (u) => ({ strokes: [humps(u)] }),
  },
  {
    id: 'circuit.variable-inductor', label: 'Variable inductor', group: 'Passive', keywords: 'adjustable coil vl',
    mode: 'bipole', tikz: 'vL', size: { w: 100, h: 40 }, body: 0.8, designator: 'L',
    art: (u) => merge({ strokes: [humps(u)] }, diagonalArrow(u)),
  },

  /* ------------------------------------------------------------- sources */
  {
    id: 'circuit.cell', label: 'Cell', group: 'Sources', keywords: 'battery single dc emf',
    mode: 'bipole', tikz: 'battery1', size: { w: 100, h: 40 }, body: 0.14, designator: 'E',
    art: (u) => ({ strokes: [seg(-0.07 * u, -0.3 * u, -0.07 * u, 0.3 * u)], solids: [polygon([{ x: 0.05 * u, y: -0.15 * u }, { x: 0.09 * u, y: -0.15 * u }, { x: 0.09 * u, y: 0.15 * u }, { x: 0.05 * u, y: 0.15 * u }])] }),
  },
  {
    id: 'circuit.battery', label: 'Battery', group: 'Sources', keywords: 'cells dc multi emf',
    mode: 'bipole', tikz: 'battery', size: { w: 100, h: 40 }, body: 0.3, designator: 'E',
    art: (u) => ({
      strokes: [seg(-0.14 * u, -0.3 * u, -0.14 * u, 0.3 * u), seg(0.02 * u, -0.3 * u, 0.02 * u, 0.3 * u), seg(0.1 * u, -0.15 * u, 0.1 * u, 0.15 * u), seg(-0.06 * u, -0.15 * u, -0.06 * u, 0.15 * u)],
    }),
  },
  {
    id: 'circuit.dc-source', label: 'DC voltage source', group: 'Sources', keywords: 'v vcc supply plus minus',
    mode: 'bipole', tikz: 'V', size: { w: 100, h: 40 }, body: 0.6, designator: 'V',
    art: (u) => merge(roundBody(u), { strokes: [seg(-0.2 * u, 0, -0.08 * u, 0), seg(-0.14 * u, -0.06 * u, -0.14 * u, 0.06 * u), seg(0.14 * u, -0.06 * u, 0.14 * u, 0.06 * u)] }),
  },
  {
    id: 'circuit.ac-source', label: 'AC voltage source', group: 'Sources', keywords: 'sinusoidal alternating mains sine',
    mode: 'bipole', tikz: 'sV', size: { w: 100, h: 40 }, body: 0.6, designator: 'V',
    art: (u) => merge(roundBody(u), { strokes: [[M(0, -0.2 * u), C(-0.2 * u, -0.1 * u, 0.2 * u, 0.1 * u, 0, 0.2 * u)]] }),
  },
  {
    id: 'circuit.current-source', label: 'Current source', group: 'Sources', keywords: 'i constant ampere',
    mode: 'bipole', tikz: 'I', size: { w: 100, h: 40 }, body: 0.6, designator: 'I',
    art: (u) => merge(roundBody(u), { strokes: [seg(-0.2 * u, 0, 0.1 * u, 0)], solids: [head(0.2 * u, 0, 1, 0, 0.12 * u)] }),
  },

  /* ---------------------------------------------- switches & protection */
  {
    id: 'circuit.switch-open', label: 'Switch (open)', group: 'Switches & protection', keywords: 'spst nos off normally open',
    mode: 'bipole', tikz: 'nos', size: { w: 100, h: 40 }, body: 0.5, designator: 'S', art: switchArt(false),
  },
  {
    id: 'circuit.switch-closed', label: 'Switch (closed)', group: 'Switches & protection', keywords: 'spst ncs on normally closed',
    mode: 'bipole', tikz: 'ncs', size: { w: 100, h: 40 }, body: 0.5, designator: 'S', art: switchArt(true),
  },
  {
    id: 'circuit.fuse', label: 'Fuse', group: 'Switches & protection', keywords: 'protection breaker',
    mode: 'bipole', tikz: 'fuse', size: { w: 100, h: 40 }, body: 0.5, designator: 'F',
    art: (u) => ({
      bodies: [polygon([{ x: -0.25 * u, y: -0.1 * u }, { x: 0.25 * u, y: -0.1 * u }, { x: 0.25 * u, y: 0.1 * u }, { x: -0.25 * u, y: 0.1 * u }])],
      strokes: [seg(-0.25 * u, 0, 0.25 * u, 0)],
    }),
  },

  /* ------------------------------------------------------ semiconductors */
  {
    id: 'circuit.diode', label: 'Diode', group: 'Semiconductors', keywords: 'd rectifier pn',
    mode: 'bipole', tikz: 'D', size: { w: 100, h: 40 }, body: 0.3, designator: 'D', art: diode,
  },
  {
    id: 'circuit.led', label: 'LED', group: 'Semiconductors', keywords: 'light emitting diode',
    mode: 'bipole', tikz: 'leD', size: { w: 100, h: 40 }, body: 0.3, designator: 'D',
    art: (u) => merge(diode(u), {
      strokes: [seg(0, -0.26 * u, 0.1 * u, -0.42 * u), seg(0.12 * u, -0.26 * u, 0.22 * u, -0.42 * u)],
      solids: [head(0.13 * u, -0.46 * u, 0.6, -1, 0.09 * u), head(0.25 * u, -0.46 * u, 0.6, -1, 0.09 * u)],
    }),
  },
  {
    id: 'circuit.zener', label: 'Zener diode', group: 'Semiconductors', keywords: 'regulator breakdown z',
    mode: 'bipole', tikz: 'zD', size: { w: 100, h: 40 }, body: 0.3, designator: 'D',
    art: (u) => merge(diode(u), { strokes: [seg(0.15 * u, -0.2 * u, 0.08 * u, -0.2 * u)] }),
  },
  {
    id: 'circuit.schottky', label: 'Schottky diode', group: 'Semiconductors', keywords: 'fast diode',
    mode: 'bipole', tikz: 'sD', size: { w: 100, h: 40 }, body: 0.3, designator: 'D',
    art: (u) => merge(diode(u), { strokes: [polyline([{ x: 0.08 * u, y: -0.14 * u }, { x: 0.08 * u, y: -0.2 * u }, { x: 0.15 * u, y: -0.2 * u }]), polyline([{ x: 0.22 * u, y: 0.14 * u }, { x: 0.22 * u, y: 0.2 * u }, { x: 0.15 * u, y: 0.2 * u }])] }),
  },
  {
    id: 'circuit.photodiode', label: 'Photodiode', group: 'Semiconductors', keywords: 'light sensor pd',
    mode: 'bipole', tikz: 'pD', size: { w: 100, h: 40 }, body: 0.3, designator: 'D',
    art: (u) => merge(diode(u), {
      strokes: [seg(0.1 * u, -0.42 * u, 0, -0.27 * u), seg(0.22 * u, -0.42 * u, 0.12 * u, -0.27 * u)],
      solids: [head(-0.02 * u, -0.23 * u, -0.6, 1, 0.09 * u), head(0.1 * u, -0.23 * u, -0.6, 1, 0.09 * u)],
    }),
  },
  {
    id: 'circuit.npn', label: 'NPN transistor', group: 'Semiconductors', keywords: 'bjt bipolar q amplifier',
    mode: 'node', tikz: 'npn', size: BJT_SIZE, origin: { x: 1, y: 0.5 }, designator: 'Q',
    art: bjt(false), ports: transistorPorts('B', 'C', 'E'),
  },
  {
    id: 'circuit.pnp', label: 'PNP transistor', group: 'Semiconductors', keywords: 'bjt bipolar q',
    mode: 'node', tikz: 'pnp', size: BJT_SIZE, origin: { x: 1, y: 0.5 }, designator: 'Q',
    art: bjt(true), ports: transistorPorts('B', 'C', 'E'),
  },
  {
    id: 'circuit.nmos', label: 'N-MOSFET', group: 'Semiconductors', keywords: 'mos fet transistor gate drain source',
    mode: 'node', tikz: 'nmos', size: MOS_SIZE, origin: { x: 1, y: 0.5 }, designator: 'M',
    art: mos(false), ports: transistorPorts('G', 'D', 'S'),
  },
  {
    id: 'circuit.pmos', label: 'P-MOSFET', group: 'Semiconductors', keywords: 'mos fet transistor gate drain source',
    mode: 'node', tikz: 'pmos', size: MOS_SIZE, origin: { x: 1, y: 0.5 }, designator: 'M',
    art: mos(true), ports: transistorPorts('G', 'S', 'D'),
  },
  {
    id: 'circuit.opamp', label: 'Op-amp', group: 'Semiconductors', keywords: 'operational amplifier inverting',
    mode: 'node', tikz: 'op amp', size: OPAMP_SIZE, origin: { x: 0.5, y: 0.5 }, designator: 'U',
    art: (_u, w, h) => {
      const left = w * 0.16;
      const right = w * 0.84;
      const inTop = h * 0.5 - h * 0.25;
      const inBottom = h * 0.5 + h * 0.25;
      const s = 3.6;
      const plusX = left + 8;
      return {
        bodies: [polygon([{ x: left, y: 0 }, { x: right, y: h / 2 }, { x: left, y: h }])],
        strokes: [
          seg(0, inTop, left, inTop),
          seg(0, inBottom, left, inBottom),
          seg(right, h / 2, w, h / 2),
          seg(plusX - s, inTop, plusX + s, inTop),
          seg(plusX - s, inBottom, plusX + s, inBottom),
          seg(plusX, inBottom - s, plusX, inBottom + s),
        ],
      };
    },
    ports: (w, h) => [
      { id: 'minus', p: { x: 0, y: h * 0.25 }, dir: { x: -1, y: 0 } },
      { id: 'plus', p: { x: 0, y: h * 0.75 }, dir: { x: -1, y: 0 } },
      { id: 'out', p: { x: w, y: h / 2 }, dir: { x: 1, y: 0 } },
    ],
  },

  /* --------------------------------------------------- meters & machines */
  {
    id: 'circuit.lamp', label: 'Lamp', group: 'Meters & machines', keywords: 'indicator light cross',
    mode: 'bipole', tikz: 'lamp', size: { w: 100, h: 40 }, body: 0.6, designator: 'X',
    art: (u) => {
      const k = R * u * Math.SQRT1_2;
      return merge(roundBody(u), { strokes: [seg(-k, -k, k, k), seg(-k, k, k, -k)] });
    },
  },
  {
    id: 'circuit.bulb', label: 'Bulb', group: 'Meters & machines', keywords: 'incandescent light filament',
    mode: 'bipole', tikz: 'bulb', size: { w: 100, h: 40 }, body: 0.6, designator: 'X',
    art: (u) => merge(roundBody(u), { strokes: [[M(-R * u, 0), C(-0.14 * u, 0, -0.16 * u, -0.2 * u, 0, -0.2 * u), C(0.16 * u, -0.2 * u, 0.14 * u, 0, R * u, 0)]] }),
  },
  {
    id: 'circuit.motor', label: 'Motor', group: 'Meters & machines', keywords: 'electric m machine',
    mode: 'bipole', tikz: 'Telmech=M', size: { w: 100, h: 40 }, body: 0.76, glyph: 'M', designator: 'M',
    art: (u) => merge(roundBody(u), { solids: machineBars(u) }),
  },
  {
    id: 'circuit.generator', label: 'Generator', group: 'Meters & machines', keywords: 'dynamo g alternator machine',
    mode: 'bipole', tikz: 'Telmech=G', size: { w: 100, h: 40 }, body: 0.76, glyph: 'G', designator: 'G',
    art: (u) => merge(roundBody(u), { solids: machineBars(u) }),
  },
  {
    id: 'circuit.ammeter', label: 'Ammeter', group: 'Meters & machines', keywords: 'current meter a',
    mode: 'bipole', tikz: 'ammeter', size: { w: 100, h: 40 }, body: 0.6, glyph: 'A', designator: 'A',
    art: (u) => merge(roundBody(u), diagonalArrow(u, 0.38)),
  },
  {
    id: 'circuit.voltmeter', label: 'Voltmeter', group: 'Meters & machines', keywords: 'voltage meter v',
    mode: 'bipole', tikz: 'voltmeter', size: { w: 100, h: 40 }, body: 0.6, glyph: 'V', designator: 'V',
    art: (u) => merge(roundBody(u), diagonalArrow(u, 0.38)),
  },
  {
    id: 'circuit.transformer', label: 'Transformer', group: 'Meters & machines', keywords: 'coupled coils mutual',
    mode: 'node', tikz: 'transformer', size: TRANSFORMER_SIZE, origin: { x: 0.5, y: 0.5 }, designator: 'T',
    art: (_u, w, h) => {
      const coil = (x: number, bulge: number): Seg[] => {
        const top = h * 0.14;
        const step = (h - 2 * top) / 4;
        const out: Seg[] = [M(x, top)];
        for (let i = 0; i < 4; i++) out.push(C(x + bulge, top + step * i, x + bulge, top + step * (i + 1), x, top + step * (i + 1)));
        return out;
      };
      const lx = w * 0.32;
      const rx = w * 0.68;
      return {
        strokes: [
          polyline([{ x: 0, y: 0 }, { x: lx, y: 0 }, { x: lx, y: h * 0.14 }]),
          polyline([{ x: 0, y: h }, { x: lx, y: h }, { x: lx, y: h * 0.86 }]),
          polyline([{ x: w, y: 0 }, { x: rx, y: 0 }, { x: rx, y: h * 0.14 }]),
          polyline([{ x: w, y: h }, { x: rx, y: h }, { x: rx, y: h * 0.86 }]),
          coil(lx, 11),
          coil(rx, -11),
        ],
      };
    },
    ports: cornerPorts,
  },

  /* --------------------------------------------------------- connections */
  {
    id: 'circuit.junction', label: 'Junction', group: 'Connections', keywords: 'dot node connection wire',
    mode: 'oneport', tikz: 'circ', size: { w: 10, h: 10 },
    art: (_u, w, h) => ({ solids: [circle(w / 2, h / 2, Math.min(w, h) * 0.26)] }),
    ports: hubPorts,
  },
  {
    id: 'circuit.terminal', label: 'Terminal', group: 'Connections', keywords: 'open connector ocirc port',
    mode: 'oneport', tikz: 'ocirc', size: { w: 10, h: 10 },
    art: (_u, w, h) => ({ bodies: [circle(w / 2, h / 2, Math.min(w, h) * 0.26)] }),
    ports: hubPorts,
  },
  {
    id: 'circuit.ground', label: 'Ground', group: 'Connections', keywords: 'gnd earth reference zero',
    mode: 'oneport', tikz: 'ground', size: { w: 30, h: 30 },
    art: (_u, w, h) => ({
      strokes: [
        seg(w / 2, 0, w / 2, h * 0.46),
        seg(w * 0.12, h * 0.46, w * 0.88, h * 0.46),
        seg(w * 0.27, h * 0.66, w * 0.73, h * 0.66),
        seg(w * 0.42, h * 0.86, w * 0.58, h * 0.86),
      ],
    }),
    ports: (w) => topPort(w),
  },
  {
    id: 'circuit.earth', label: 'Earth (chassis)', group: 'Connections', keywords: 'ground protective hatched',
    mode: 'oneport', tikz: 'eground', size: { w: 30, h: 30 },
    art: (_u, w, h) => ({
      strokes: [
        seg(w / 2, 0, w / 2, h * 0.5),
        seg(w * 0.08, h * 0.5, w * 0.92, h * 0.5),
        seg(w * 0.2, h * 0.5, w * 0.08, h * 0.85),
        seg(w * 0.5, h * 0.5, w * 0.38, h * 0.85),
        seg(w * 0.8, h * 0.5, w * 0.68, h * 0.85),
      ],
    }),
    ports: (w) => topPort(w),
  },
  {
    id: 'circuit.signal-ground', label: 'Signal ground', group: 'Connections', keywords: 'gnd reference triangle',
    mode: 'oneport', tikz: 'sground', size: { w: 30, h: 30 },
    art: (_u, w, h) => ({
      strokes: [seg(w / 2, 0, w / 2, h * 0.4)],
      bodies: [polygon([{ x: w * 0.2, y: h * 0.4 }, { x: w * 0.8, y: h * 0.4 }, { x: w * 0.5, y: h * 0.85 }])],
    }),
    ports: (w) => topPort(w),
  },
];

function machineBars(u: number): Seg[][] {
  const bar = (x0: number, x1: number) =>
    polygon([{ x: x0, y: -0.12 * u }, { x: x1, y: -0.12 * u }, { x: x1, y: 0.12 * u }, { x: x0, y: 0.12 * u }]);
  return [bar(-0.38 * u, -0.3 * u), bar(0.3 * u, 0.38 * u)];
}

export const CIRCUIT_BY_ID: Record<string, CircuitDef> = Object.fromEntries(
  CIRCUIT_DEFS.map((d) => [d.id, d]),
);

export const CIRCUIT_GROUPS = Array.from(new Set(CIRCUIT_DEFS.map((d) => d.group)));

export function isCircuitKind(kind: string): boolean {
  return kind.startsWith('circuit.');
}

/** Lead ends and every part of a component's art, in the box's coordinates. */
function artFor(def: CircuitDef, w: number, h: number): Art {
  if (def.mode !== 'bipole') return def.art(0, w, h);
  const u = bipoleUnit(h);
  const art = def.art(u, w, h);
  const shift = (segs: Seg[]) => translate(segs, w / 2, h / 2);
  const reach = Math.min(w / 2, ((def.body ?? 0.8) * u) / 2);
  return {
    strokes: [...(art.strokes ?? []).map(shift), seg(0, h / 2, w / 2 - reach, h / 2), seg(w / 2 + reach, h / 2, w, h / 2)],
    bodies: (art.bodies ?? []).map(shift),
    solids: (art.solids ?? []).map(shift),
  };
}

function translate(segs: Seg[], dx: number, dy: number): Seg[] {
  const t = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
  return segs.map((s) =>
    s.c === 'M' || s.c === 'L'
      ? { ...s, p: t(s.p) }
      : s.c === 'C'
        ? { c: 'C', c1: t(s.c1), c2: t(s.c2), p: t(s.p) }
        : s,
  );
}

const leftRight = (w: number, h: number): PortDef[] => [
  { id: 'w', p: { x: 0, y: h / 2 }, dir: { x: -1, y: 0 } },
  { id: 'e', p: { x: w, y: h / 2 }, dir: { x: 1, y: 0 } },
];

/** Registry entries: a thin adapter from the table to the shape interface. */
export const CIRCUIT_SHAPE_DEFS: ShapeDef[] = CIRCUIT_DEFS.map((d) => ({
  id: d.id,
  label: d.label,
  category: 'Basic',
  defaultSize: d.size,
  // An open, empty outline: the box is the hit area, the art is the picture.
  outline: () => [],
  decorations: (w: number, h: number) => artFor(d, w, h).strokes ?? [],
  bodies: (w: number, h: number) => artFor(d, w, h).bodies ?? [],
  solids: (w: number, h: number) => artFor(d, w, h).solids ?? [],
  ports: (w: number, h: number) =>
    d.mode === 'bipole' ? [...leftRight(w, h), ...(d.ports?.(w, h) ?? [])] : d.ports!(w, h),
  textBox: (w: number, h: number) => ({ x: 0, y: 0, w, h }),
  flippable: true,
  note: 'Electrical component. Drag from a round terminal to wire it; the LaTeX uses CircuiTikZ.',
}));

