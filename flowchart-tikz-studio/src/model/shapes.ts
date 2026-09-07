import type { Point, Rect, PortId, Node } from './types';
import {
  Seg,
  L,
  M,
  Z,
  polygon,
  polyline,
  rect,
  roundedRect,
  ellipse,
  wave,
  translateSegs,
} from './path';

export interface PortDef {
  id: PortId;
  /** Local coordinates within the shape's box. */
  p: Point;
  /** Outward normal, unit length. Drives connector entry/exit direction. */
  dir: Point;
}

export interface TikzNodeMapping {
  /** A built-in TikZ node shape whose bounding box we can control exactly. */
  shape: 'rectangle' | 'diamond' | 'circle' | 'ellipse' | 'rounded rectangle';
  /** Extra node options that depend on the node instance. */
  options?: (n: Node) => string[];
  /** TikZ libraries this mapping requires. */
  libraries?: string[];
}

export interface ShapeDef {
  id: string;
  label: string;
  category: 'Flow' | 'Data' | 'Documents' | 'Extended' | 'Basic' | 'Annotation';
  defaultSize: { w: number; h: number };
  /** True when `style.cornerRadius` is meaningful for this shape. */
  roundable?: boolean;
  /** Filled + stroked outline in local coordinates (0,0)-(w,h). */
  outline: (w: number, h: number, node?: Node) => Seg[];
  /** Extra stroked-only sub-paths (never filled), e.g. cylinder lid. */
  decorations?: (w: number, h: number, node?: Node) => Seg[][];
  /** Region available for text, local coordinates. */
  textBox?: (w: number, h: number) => Rect;
  ports?: (w: number, h: number) => PortDef[];
  /**
   * When present the TikZ generator emits a `\node[shape=...]` instead of an
   * explicit path. Only used where TikZ can reproduce the outline exactly.
   */
  tikzNode?: TikzNodeMapping;
  /** Shapes such as plain text carry no outline. */
  noOutline?: boolean;
  /** Notes for the user, surfaced in the property inspector. */
  note?: string;
}

/* ------------------------------------------------------------------ ports */

function boxPorts(w: number, h: number): PortDef[] {
  return [
    { id: 'n', p: { x: w / 2, y: 0 }, dir: { x: 0, y: -1 } },
    { id: 'e', p: { x: w, y: h / 2 }, dir: { x: 1, y: 0 } },
    { id: 's', p: { x: w / 2, y: h }, dir: { x: 0, y: 1 } },
    { id: 'w', p: { x: 0, y: h / 2 }, dir: { x: -1, y: 0 } },
    { id: 'ne', p: { x: w, y: 0 }, dir: { x: 0.7071, y: -0.7071 } },
    { id: 'se', p: { x: w, y: h }, dir: { x: 0.7071, y: 0.7071 } },
    { id: 'sw', p: { x: 0, y: h }, dir: { x: -0.7071, y: 0.7071 } },
    { id: 'nw', p: { x: 0, y: 0 }, dir: { x: -0.7071, y: -0.7071 } },
  ];
}

function diamondPorts(w: number, h: number): PortDef[] {
  return [
    { id: 'n', p: { x: w / 2, y: 0 }, dir: { x: 0, y: -1 } },
    { id: 'e', p: { x: w, y: h / 2 }, dir: { x: 1, y: 0 } },
    { id: 's', p: { x: w / 2, y: h }, dir: { x: 0, y: 1 } },
    { id: 'w', p: { x: 0, y: h / 2 }, dir: { x: -1, y: 0 } },
  ];
}

function ellipsePorts(w: number, h: number): PortDef[] {
  const k = Math.SQRT1_2;
  const cx = w / 2;
  const cy = h / 2;
  return [
    { id: 'n', p: { x: cx, y: 0 }, dir: { x: 0, y: -1 } },
    { id: 'e', p: { x: w, y: cy }, dir: { x: 1, y: 0 } },
    { id: 's', p: { x: cx, y: h }, dir: { x: 0, y: 1 } },
    { id: 'w', p: { x: 0, y: cy }, dir: { x: -1, y: 0 } },
    { id: 'ne', p: { x: cx + cx * k, y: cy - cy * k }, dir: { x: k, y: -k } },
    { id: 'se', p: { x: cx + cx * k, y: cy + cy * k }, dir: { x: k, y: k } },
    { id: 'sw', p: { x: cx - cx * k, y: cy + cy * k }, dir: { x: -k, y: k } },
    { id: 'nw', p: { x: cx - cx * k, y: cy - cy * k }, dir: { x: -k, y: -k } },
  ];
}

const inset = (w: number, h: number, ix: number, iy = ix): Rect => ({
  x: ix,
  y: iy,
  w: Math.max(0, w - ix * 2),
  h: Math.max(0, h - iy * 2),
});

/* ----------------------------------------------------------- definitions */

const defs: ShapeDef[] = [
  {
    id: 'terminator',
    label: 'Start / End',
    category: 'Flow',
    defaultSize: { w: 140, h: 56 },
    outline: (w, h) => roundedRect(0, 0, w, h, Math.min(h / 2, w / 2)),
    textBox: (w, h) => inset(w, h, Math.min(h / 2, w / 4) * 0.6, 6),
    ports: boxPorts,
    tikzNode: {
      shape: 'rounded rectangle',
      options: () => ['rounded rectangle arc length=180'],
      libraries: ['shapes.misc'],
    },
  },
  {
    id: 'process',
    label: 'Process',
    category: 'Flow',
    defaultSize: { w: 160, h: 70 },
    roundable: true,
    outline: (w, h, n) =>
      n && n.style.cornerRadius > 0
        ? roundedRect(0, 0, w, h, n.style.cornerRadius)
        : rect(0, 0, w, h),
    textBox: (w, h) => inset(w, h, 8, 6),
    ports: boxPorts,
    tikzNode: { shape: 'rectangle' },
  },
  {
    id: 'decision',
    label: 'Decision',
    category: 'Flow',
    defaultSize: { w: 150, h: 100 },
    outline: (w, h) =>
      polygon([
        { x: w / 2, y: 0 },
        { x: w, y: h / 2 },
        { x: w / 2, y: h },
        { x: 0, y: h / 2 },
      ]),
    textBox: (w, h) => inset(w, h, w * 0.25, h * 0.25),
    ports: diamondPorts,
    tikzNode: { shape: 'diamond', libraries: ['shapes.geometric'] },
  },
  {
    id: 'io',
    label: 'Input / Output',
    category: 'Flow',
    defaultSize: { w: 170, h: 70 },
    outline: (w, h) => {
      const k = Math.min(w * 0.18, h * 0.5);
      return polygon([
        { x: k, y: 0 },
        { x: w, y: 0 },
        { x: w - k, y: h },
        { x: 0, y: h },
      ]);
    },
    textBox: (w, h) => inset(w, h, Math.min(w * 0.2, h * 0.55), 6),
    ports: boxPorts,
  },
  {
    id: 'predefined',
    label: 'Predefined process',
    category: 'Flow',
    defaultSize: { w: 170, h: 70 },
    outline: (w, h) => rect(0, 0, w, h),
    decorations: (w, h) => {
      const k = Math.min(w * 0.12, 18);
      return [
        polyline([
          { x: k, y: 0 },
          { x: k, y: h },
        ]),
        polyline([
          { x: w - k, y: 0 },
          { x: w - k, y: h },
        ]),
      ];
    },
    textBox: (w, h) => inset(w, h, Math.min(w * 0.14, 22), 6),
    ports: boxPorts,
  },
  {
    id: 'preparation',
    label: 'Preparation',
    category: 'Flow',
    defaultSize: { w: 170, h: 70 },
    outline: (w, h) => {
      const k = Math.min(w * 0.16, h * 0.5);
      return polygon([
        { x: k, y: 0 },
        { x: w - k, y: 0 },
        { x: w, y: h / 2 },
        { x: w - k, y: h },
        { x: k, y: h },
        { x: 0, y: h / 2 },
      ]);
    },
    textBox: (w, h) => inset(w, h, Math.min(w * 0.18, h * 0.55), 6),
    ports: boxPorts,
  },
  {
    id: 'manual-input',
    label: 'Manual input',
    category: 'Flow',
    defaultSize: { w: 160, h: 70 },
    outline: (w, h) =>
      polygon([
        { x: 0, y: h * 0.28 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ]),
    textBox: (w, h) => ({ x: 8, y: h * 0.32, w: w - 16, h: h * 0.62 }),
    ports: boxPorts,
  },
  {
    id: 'manual-operation',
    label: 'Manual operation',
    category: 'Flow',
    defaultSize: { w: 160, h: 70 },
    outline: (w, h) => {
      const k = w * 0.16;
      return polygon([
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w - k, y: h },
        { x: k, y: h },
      ]);
    },
    textBox: (w, h) => inset(w, h, w * 0.18, 6),
    ports: boxPorts,
  },
  {
    id: 'delay',
    label: 'Delay',
    category: 'Flow',
    defaultSize: { w: 150, h: 70 },
    outline: (w, h) => {
      const r = Math.min(h / 2, w * 0.5);
      const k = r * 0.5523;
      return [
        M(0, 0),
        L(w - r, 0),
        { c: 'C', c1: { x: w - r + k, y: 0 }, c2: { x: w, y: r - k }, p: { x: w, y: r } },
        { c: 'C', c1: { x: w, y: r + k }, c2: { x: w - r + k, y: h }, p: { x: w - r, y: h } },
        L(0, h),
        Z,
      ];
    },
    textBox: (w, h) => inset(w, h, 10, 6),
    ports: boxPorts,
  },
  {
    id: 'display',
    label: 'Display',
    category: 'Flow',
    defaultSize: { w: 170, h: 70 },
    outline: (w, h) => {
      const k = w * 0.14;
      const r = Math.min(h / 2, w * 0.25);
      const c = r * 0.5523;
      return [
        M(k, 0),
        L(w - r, 0),
        { c: 'C', c1: { x: w - r + c, y: 0 }, c2: { x: w, y: h / 2 - c }, p: { x: w, y: h / 2 } },
        { c: 'C', c1: { x: w, y: h / 2 + c }, c2: { x: w - r + c, y: h }, p: { x: w - r, y: h } },
        L(k, h),
        Z,
      ];
    },
    textBox: (w, h) => inset(w, h, w * 0.16, 6),
    ports: boxPorts,
  },
  {
    id: 'connector',
    label: 'Connector',
    category: 'Flow',
    defaultSize: { w: 56, h: 56 },
    outline: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2),
    textBox: (w, h) => inset(w, h, w * 0.16, h * 0.16),
    ports: ellipsePorts,
    tikzNode: { shape: 'circle' },
  },
  {
    id: 'offpage',
    label: 'Off-page connector',
    category: 'Flow',
    defaultSize: { w: 90, h: 80 },
    outline: (w, h) =>
      polygon([
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h * 0.62 },
        { x: w / 2, y: h },
        { x: 0, y: h * 0.62 },
      ]),
    textBox: (w, h) => ({ x: 6, y: 4, w: w - 12, h: h * 0.6 }),
    ports: boxPorts,
  },
  {
    id: 'merge',
    label: 'Merge',
    category: 'Flow',
    defaultSize: { w: 90, h: 60 },
    outline: (w, h) =>
      polygon([
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w / 2, y: h },
      ]),
    textBox: (w, h) => ({ x: w * 0.2, y: 2, w: w * 0.6, h: h * 0.45 }),
    ports: boxPorts,
  },
  {
    id: 'extract',
    label: 'Extract',
    category: 'Flow',
    defaultSize: { w: 90, h: 60 },
    outline: (w, h) =>
      polygon([
        { x: w / 2, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ]),
    textBox: (w, h) => ({ x: w * 0.2, y: h * 0.5, w: w * 0.6, h: h * 0.45 }),
    ports: boxPorts,
  },
  {
    id: 'or',
    label: 'Or',
    category: 'Flow',
    defaultSize: { w: 60, h: 60 },
    outline: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2),
    decorations: (w, h) => [
      polyline([
        { x: 0, y: h / 2 },
        { x: w, y: h / 2 },
      ]),
      polyline([
        { x: w / 2, y: 0 },
        { x: w / 2, y: h },
      ]),
    ],
    ports: ellipsePorts,
    tikzNode: { shape: 'circle' },
  },
  {
    id: 'summing-junction',
    label: 'Summing junction',
    category: 'Flow',
    defaultSize: { w: 60, h: 60 },
    outline: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2),
    decorations: (w, h) => {
      const k = 0.1464; // (1 - 1/sqrt2)/2
      return [
        polyline([
          { x: w * k, y: h * k },
          { x: w * (1 - k), y: h * (1 - k) },
        ]),
        polyline([
          { x: w * (1 - k), y: h * k },
          { x: w * k, y: h * (1 - k) },
        ]),
      ];
    },
    ports: ellipsePorts,
    tikzNode: { shape: 'circle' },
  },
  {
    id: 'document',
    label: 'Document',
    category: 'Documents',
    defaultSize: { w: 160, h: 80 },
    outline: (w, h) => {
      const amp = h * 0.09;
      return [
        M(0, 0),
        L(w, 0),
        L(w, h - amp * 1.6),
        ...wave(w, 0, h - amp * 1.6, amp),
        Z,
      ];
    },
    textBox: (w, h) => ({ x: 8, y: 6, w: w - 16, h: h * 0.72 }),
    ports: boxPorts,
  },
  {
    id: 'multi-document',
    label: 'Multiple documents',
    category: 'Documents',
    defaultSize: { w: 165, h: 90 },
    outline: (w, h) => {
      const off = Math.min(w, h) * 0.1;
      const bw = w - off * 2;
      const bh = h - off * 2;
      const amp = bh * 0.1;
      return translateSegs(
        [
          M(0, 0),
          L(bw, 0),
          L(bw, bh - amp * 1.6),
          ...wave(bw, 0, bh - amp * 1.6, amp),
          Z,
        ],
        0,
        off * 2,
      );
    },
    decorations: (w, h) => {
      const off = Math.min(w, h) * 0.1;
      const bw = w - off * 2;
      const bh = h - off * 2;
      const sheet = (dx: number, dy: number): Seg[] =>
        translateSegs(
          [M(0, 0), L(bw, 0), L(bw, bh * 0.72), L(0, bh * 0.72), Z],
          dx,
          dy,
        );
      return [sheet(off * 2, 0), sheet(off, off)];
    },
    textBox: (w, h) => ({ x: 10, y: h * 0.28, w: w - 24, h: h * 0.5 }),
    ports: boxPorts,
  },
  {
    id: 'database',
    label: 'Database',
    category: 'Data',
    defaultSize: { w: 120, h: 100 },
    outline: (w, h) => {
      const ry = Math.min(h * 0.16, w * 0.3);
      const k = ry * 0.5523;
      const rx = w / 2;
      const kx = rx * 0.5523;
      return [
        M(0, ry),
        { c: 'C', c1: { x: 0, y: ry - k }, c2: { x: rx - kx, y: 0 }, p: { x: rx, y: 0 } },
        { c: 'C', c1: { x: rx + kx, y: 0 }, c2: { x: w, y: ry - k }, p: { x: w, y: ry } },
        L(w, h - ry),
        { c: 'C', c1: { x: w, y: h - ry + k }, c2: { x: rx + kx, y: h }, p: { x: rx, y: h } },
        { c: 'C', c1: { x: rx - kx, y: h }, c2: { x: 0, y: h - ry + k }, p: { x: 0, y: h - ry } },
        Z,
      ];
    },
    decorations: (w, h) => {
      const ry = Math.min(h * 0.16, w * 0.3);
      const k = ry * 0.5523;
      const rx = w / 2;
      const kx = rx * 0.5523;
      return [
        [
          M(0, ry),
          { c: 'C', c1: { x: 0, y: ry + k }, c2: { x: rx - kx, y: ry * 2 }, p: { x: rx, y: ry * 2 } },
          { c: 'C', c1: { x: rx + kx, y: ry * 2 }, c2: { x: w, y: ry + k }, p: { x: w, y: ry } },
        ],
      ];
    },
    textBox: (w, h) => ({ x: 8, y: h * 0.34, w: w - 16, h: h * 0.5 }),
    ports: boxPorts,
  },
  {
    id: 'stored-data',
    label: 'Stored data',
    category: 'Data',
    defaultSize: { w: 150, h: 80 },
    outline: (w, h) => {
      const k = w * 0.14;
      const c = k * 0.8;
      return [
        M(k, 0),
        L(w, 0),
        { c: 'C', c1: { x: w - c, y: h * 0.25 }, c2: { x: w - c, y: h * 0.75 }, p: { x: w, y: h } },
        L(k, h),
        { c: 'C', c1: { x: k - c, y: h * 0.75 }, c2: { x: k - c, y: h * 0.25 }, p: { x: k, y: 0 } },
        Z,
      ];
    },
    textBox: (w, h) => inset(w, h, w * 0.16, 8),
    ports: boxPorts,
  },
  {
    id: 'internal-storage',
    label: 'Internal storage',
    category: 'Data',
    defaultSize: { w: 150, h: 90 },
    outline: (w, h) => rect(0, 0, w, h),
    decorations: (w, h) => {
      const k = Math.min(w * 0.16, 24);
      const m = Math.min(h * 0.22, 24);
      return [
        polyline([
          { x: k, y: 0 },
          { x: k, y: h },
        ]),
        polyline([
          { x: 0, y: m },
          { x: w, y: m },
        ]),
      ];
    },
    textBox: (w, h) => ({
      x: Math.min(w * 0.18, 28),
      y: Math.min(h * 0.24, 28),
      w: w - Math.min(w * 0.18, 28) - 8,
      h: h - Math.min(h * 0.24, 28) - 8,
    }),
    ports: boxPorts,
  },
  {
    id: 'direct-access-storage',
    label: 'Direct access storage',
    category: 'Data',
    defaultSize: { w: 150, h: 80 },
    outline: (w, h) => {
      const rx = Math.min(w * 0.14, h * 0.5);
      const k = rx * 0.5523;
      const ry = h / 2;
      const ky = ry * 0.5523;
      return [
        M(rx, 0),
        L(w - rx, 0),
        { c: 'C', c1: { x: w - rx + k, y: 0 }, c2: { x: w, y: ry - ky }, p: { x: w, y: ry } },
        { c: 'C', c1: { x: w, y: ry + ky }, c2: { x: w - rx + k, y: h }, p: { x: w - rx, y: h } },
        L(rx, h),
        { c: 'C', c1: { x: rx - k, y: h }, c2: { x: 0, y: ry + ky }, p: { x: 0, y: ry } },
        { c: 'C', c1: { x: 0, y: ry - ky }, c2: { x: rx - k, y: 0 }, p: { x: rx, y: 0 } },
        Z,
      ];
    },
    decorations: (w, h) => {
      const rx = Math.min(w * 0.14, h * 0.5);
      const k = rx * 0.5523;
      const ry = h / 2;
      const ky = ry * 0.5523;
      return [
        [
          M(w - rx, 0),
          { c: 'C', c1: { x: w - rx - k, y: 0 }, c2: { x: w - rx * 2, y: ry - ky }, p: { x: w - rx * 2, y: ry } },
          { c: 'C', c1: { x: w - rx * 2, y: ry + ky }, c2: { x: w - rx - k, y: h }, p: { x: w - rx, y: h } },
        ],
      ];
    },
    textBox: (w, h) => inset(w, h, w * 0.16, 8),
    ports: boxPorts,
  },
  {
    id: 'card',
    label: 'Card',
    category: 'Data',
    defaultSize: { w: 150, h: 80 },
    outline: (w, h) => {
      const k = Math.min(w * 0.16, h * 0.3);
      return polygon([
        { x: k, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
        { x: 0, y: k },
      ]);
    },
    textBox: (w, h) => inset(w, h, 10, 8),
    ports: boxPorts,
  },
  {
    id: 'loop-limit',
    label: 'Loop limit',
    category: 'Extended',
    defaultSize: { w: 150, h: 70 },
    outline: (w, h) => {
      const k = Math.min(w * 0.14, h * 0.3);
      return polygon([
        { x: k, y: 0 },
        { x: w - k, y: 0 },
        { x: w, y: k },
        { x: w, y: h },
        { x: 0, y: h },
        { x: 0, y: k },
      ]);
    },
    textBox: (w, h) => inset(w, h, 10, Math.min(h * 0.28, 22)),
    ports: boxPorts,
  },
  {
    id: 'rectangle',
    label: 'Rectangle',
    category: 'Basic',
    defaultSize: { w: 140, h: 90 },
    roundable: true,
    outline: (w, h, n) =>
      n && n.style.cornerRadius > 0
        ? roundedRect(0, 0, w, h, n.style.cornerRadius)
        : rect(0, 0, w, h),
    textBox: (w, h) => inset(w, h, 8, 6),
    ports: boxPorts,
    tikzNode: { shape: 'rectangle' },
  },
  {
    id: 'ellipse',
    label: 'Ellipse',
    category: 'Basic',
    defaultSize: { w: 150, h: 90 },
    outline: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2),
    textBox: (w, h) => inset(w, h, w * 0.16, h * 0.16),
    ports: ellipsePorts,
    tikzNode: { shape: 'ellipse', libraries: ['shapes.geometric'] },
  },
  {
    id: 'text',
    label: 'Text label',
    category: 'Annotation',
    defaultSize: { w: 140, h: 40 },
    noOutline: true,
    outline: (w, h) => rect(0, 0, w, h),
    textBox: (w, h) => ({ x: 0, y: 0, w, h }),
    ports: boxPorts,
    tikzNode: { shape: 'rectangle' },
    note: 'Renders as a bare TikZ node with no draw or fill.',
  },
  {
    id: 'note',
    label: 'Note',
    category: 'Annotation',
    defaultSize: { w: 150, h: 90 },
    outline: (w, h) => {
      const k = Math.min(w, h) * 0.22;
      return polygon([
        { x: 0, y: 0 },
        { x: w - k, y: 0 },
        { x: w, y: k },
        { x: w, y: h },
        { x: 0, y: h },
      ]);
    },
    decorations: (w, h) => {
      const k = Math.min(w, h) * 0.22;
      return [
        polyline([
          { x: w - k, y: 0 },
          { x: w - k, y: k },
          { x: w, y: k },
        ]),
      ];
    },
    textBox: (w, h) => inset(w, h, 10, 8),
    ports: boxPorts,
  },
  {
    id: 'annotation',
    label: 'Annotation bracket',
    category: 'Annotation',
    defaultSize: { w: 120, h: 90 },
    noOutline: true,
    outline: (w, h) => {
      const k = Math.min(w * 0.22, 22);
      return polyline([
        { x: k, y: 0 },
        { x: 0, y: 0 },
        { x: 0, y: h },
        { x: k, y: h },
      ]);
    },
    textBox: (w, h) => ({ x: Math.min(w * 0.24, 26), y: 4, w: w * 0.72, h: h - 8 }),
    ports: boxPorts,
    note: 'Open bracket: stroked only, never filled.',
  },
];

export const SHAPE_DEFS: Record<string, ShapeDef> = Object.fromEntries(
  defs.map((d) => [d.id, d]),
);

export const SHAPE_LIST = defs;

export const SHAPE_CATEGORIES = Array.from(
  new Set(defs.map((d) => d.category)),
) as ShapeDef['category'][];

export function getShapeDef(kind: string): ShapeDef {
  return SHAPE_DEFS[kind] ?? SHAPE_DEFS.process;
}

/** Local-space outline for a node instance. */
export function nodeOutline(n: Node): Seg[] {
  return getShapeDef(n.kind).outline(n.w, n.h, n);
}

export function nodeDecorations(n: Node): Seg[][] {
  const def = getShapeDef(n.kind);
  return def.decorations ? def.decorations(n.w, n.h, n) : [];
}

export function nodeTextBox(n: Node): Rect {
  const def = getShapeDef(n.kind);
  return def.textBox ? def.textBox(n.w, n.h) : { x: 0, y: 0, w: n.w, h: n.h };
}

export function nodePorts(n: Node): PortDef[] {
  const def = getShapeDef(n.kind);
  const list = def.ports ? def.ports(n.w, n.h) : boxPorts(n.w, n.h);
  return list;
}
