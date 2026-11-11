import type { MolAtom, MolBond, MoleculeSpec, NaturalSize, BondOrder, BondStereo } from '../types';

/**
 * Molecule graph helpers, templates and geometry. Pure: the canvas, the
 * structure editor and the chemfig writer all read the layout from here.
 *
 * Positions are in bond lengths, +y down. On the canvas one bond length is
 * `BOND_DU` diagram units at natural scale.
 */

export const BOND_DU = 34;
const LABEL_PAD = 0.45;

export function emptyMolecule(): MoleculeSpec {
  return { type: 'molecule', atoms: [], bonds: [], aromaticRings: [] };
}

let counter = 0;
export function molId(prefix: string, taken: Set<string>): string {
  let id: string;
  do {
    counter += 1;
    id = `${prefix}${counter}`;
  } while (taken.has(id));
  taken.add(id);
  return id;
}

export function makeAtom(id: string, x: number, y: number, label = ''): MolAtom {
  return { id, x, y, label, charge: 0, lonePairs: [], radicals: [] };
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/* ---------------------------------------------------------------- builders */

export interface Blueprint {
  atoms: [number, number, string][];
  bonds: [number, number, BondOrder?, BondStereo?][];
  aromatic?: number[][];
}

export function fromBlueprint(b: Blueprint): MoleculeSpec {
  const atoms = b.atoms.map(([x, y, label], i) => makeAtom(`a${i + 1}`, x, y, label));
  const bonds: MolBond[] = b.bonds.map(([p, q, order, stereo], i) => ({
    id: `b${i + 1}`,
    a: `a${p + 1}`,
    b: `a${q + 1}`,
    order: order ?? 1,
    stereo: stereo ?? 'none',
  }));
  return {
    type: 'molecule',
    atoms,
    bonds,
    aromaticRings: (b.aromatic ?? []).map((r) => r.map((i) => `a${i + 1}`)),
  };
}

/** Regular n-gon of unit side, flat top for even n, point up for odd. */
function polygonAtoms(n: number): [number, number, string][] {
  const r = 1 / (2 * Math.sin(Math.PI / n));
  const start = n % 2 === 0 ? 90 + 180 / n - 180 / n : 90;
  return Array.from({ length: n }, (_, i): [number, number, string] => {
    const a = rad(start + (360 * i) / n);
    return [r * Math.cos(a), -r * Math.sin(a), ''];
  });
}

const ringBonds = (n: number, doubles: number[] = []): [number, number, BondOrder?][] =>
  Array.from({ length: n }, (_, i) => [i, (i + 1) % n, doubles.includes(i) ? 2 : 1]);

const c30 = Math.cos(rad(30));
const s30 = 0.5;

export interface MoleculeTemplate {
  id: string;
  name: string;
  keywords: string;
  blueprint: Blueprint;
}

export const MOLECULE_TEMPLATES: MoleculeTemplate[] = [
  {
    id: 'water', name: 'Water', keywords: 'h2o',
    blueprint: { atoms: [[0, 0, 'O'], [-c30, s30, 'H'], [c30, s30, 'H']], bonds: [[0, 1], [0, 2]] },
  },
  {
    id: 'methane', name: 'Methane', keywords: 'ch4 alkane',
    blueprint: { atoms: [[0, 0, 'C'], [0, -1, 'H'], [1, 0, 'H'], [0, 1, 'H'], [-1, 0, 'H']], bonds: [[0, 1], [0, 2], [0, 3], [0, 4]] },
  },
  {
    id: 'ethane', name: 'Ethane', keywords: 'c2h6 alkane',
    blueprint: {
      atoms: [[0, 0, 'C'], [1, 0, 'C'], [0, -1, 'H'], [-1, 0, 'H'], [0, 1, 'H'], [1, -1, 'H'], [2, 0, 'H'], [1, 1, 'H']],
      bonds: [[0, 1], [0, 2], [0, 3], [0, 4], [1, 5], [1, 6], [1, 7]],
    },
  },
  {
    id: 'ethene', name: 'Ethene', keywords: 'c2h4 alkene ethylene double',
    blueprint: {
      atoms: [[0, 0, 'C'], [1, 0, 'C'], [-s30, -c30, 'H'], [-s30, c30, 'H'], [1.5, -c30, 'H'], [1.5, c30, 'H']],
      bonds: [[0, 1, 2], [0, 2], [0, 3], [1, 4], [1, 5]],
    },
  },
  {
    id: 'ethyne', name: 'Ethyne', keywords: 'c2h2 acetylene alkyne triple',
    blueprint: { atoms: [[0, 0, 'H'], [1, 0, 'C'], [2, 0, 'C'], [3, 0, 'H']], bonds: [[0, 1], [1, 2, 3], [2, 3]] },
  },
  {
    id: 'ethanol', name: 'Ethanol', keywords: 'c2h5oh alcohol',
    blueprint: { atoms: [[0, 0, 'CH_3'], [c30, -s30, ''], [2 * c30, 0, 'OH']], bonds: [[0, 1], [1, 2]] },
  },
  {
    id: 'acetic-acid', name: 'Acetic acid', keywords: 'ethanoic ch3cooh carboxylic',
    blueprint: { atoms: [[0, 0, 'CH_3'], [c30, -s30, ''], [c30, -1.5, 'O'], [2 * c30, 0, 'OH']], bonds: [[0, 1], [1, 2, 2], [1, 3]] },
  },
  {
    id: 'carbon-dioxide', name: 'Carbon dioxide', keywords: 'co2',
    blueprint: { atoms: [[0, 0, 'O'], [1, 0, 'C'], [2, 0, 'O']], bonds: [[0, 1, 2], [1, 2, 2]] },
  },
  {
    id: 'ammonia', name: 'Ammonia', keywords: 'nh3',
    blueprint: { atoms: [[0, 0, 'N'], [-c30, s30, 'H'], [c30, s30, 'H'], [0, -1, 'H']], bonds: [[0, 1], [0, 2], [0, 3]] },
  },
  {
    id: 'benzene', name: 'Benzene', keywords: 'c6h6 aromatic kekule ring',
    blueprint: { atoms: polygonAtoms(6), bonds: ringBonds(6, [0, 2, 4]) },
  },
  {
    id: 'benzene-circle', name: 'Benzene (circle)', keywords: 'c6h6 aromatic delocalised ring',
    blueprint: { atoms: polygonAtoms(6), bonds: ringBonds(6), aromatic: [[0, 1, 2, 3, 4, 5]] },
  },
  {
    id: 'cyclohexane', name: 'Cyclohexane', keywords: 'c6h12 ring',
    blueprint: { atoms: polygonAtoms(6), bonds: ringBonds(6) },
  },
  {
    id: 'cyclopentane', name: 'Cyclopentane', keywords: 'c5h10 ring',
    blueprint: { atoms: polygonAtoms(5), bonds: ringBonds(5) },
  },
  {
    id: 'cyclopropane', name: 'Cyclopropane', keywords: 'c3h6 ring',
    blueprint: { atoms: polygonAtoms(3), bonds: ringBonds(3) },
  },
];

export interface FunctionalGroup {
  id: string;
  name: string;
  label: string;
  keywords: string;
  /** Extra double-bonded O, for carbonyl-type groups. */
  extraO?: boolean;
}

export const FUNCTIONAL_GROUPS: FunctionalGroup[] = [
  { id: 'oh', name: 'Hydroxyl', label: 'OH', keywords: 'alcohol' },
  { id: 'nh2', name: 'Amine', label: 'NH_2', keywords: 'amino' },
  { id: 'ch3', name: 'Methyl', label: 'CH_3', keywords: 'alkyl' },
  { id: 'cooh', name: 'Carboxyl', label: 'COOH', keywords: 'acid' },
  { id: 'cho', name: 'Aldehyde', label: 'CHO', keywords: 'formyl' },
  { id: 'no2', name: 'Nitro', label: 'NO_2', keywords: '' },
  { id: 'cn', name: 'Nitrile', label: 'CN', keywords: 'cyano' },
  { id: 'so3h', name: 'Sulfonic acid', label: 'SO_3H', keywords: '' },
  { id: 'cl', name: 'Chloro', label: 'Cl', keywords: 'halide' },
  { id: 'br', name: 'Bromo', label: 'Br', keywords: 'halide' },
  { id: 'f', name: 'Fluoro', label: 'F', keywords: 'halide' },
];

/* ---------------------------------------------------------------- geometry */

export interface MolBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function moleculeBounds(m: MoleculeSpec): MolBounds {
  if (m.atoms.length === 0) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const xs = m.atoms.map((a) => a.x);
  const ys = m.atoms.map((a) => a.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** Natural size in diagram units, leaving room for labels at the edges. */
export function moleculeNaturalSize(m: MoleculeSpec): NaturalSize {
  const b = moleculeBounds(m);
  return {
    w: (b.maxX - b.minX + 2 * LABEL_PAD) * BOND_DU,
    h: (b.maxY - b.minY + 2 * LABEL_PAD) * BOND_DU,
  };
}

/** Maps molecule space into a w x h box, preserving aspect and centring. */
export interface MolPlacement {
  scale: number;
  tx: (x: number) => number;
  ty: (y: number) => number;
}

export function placeMolecule(m: MoleculeSpec, w: number, h: number): MolPlacement {
  const nat = moleculeNaturalSize(m);
  const s = Math.min(w / nat.w, h / nat.h) * BOND_DU;
  const b = moleculeBounds(m);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return { scale: s, tx: (x) => w / 2 + (x - cx) * s, ty: (y) => h / 2 + (y - cy) * s };
}

/** Centre of the smallest ring containing a bond, used to tuck double lines in. */
export function findRingCentreForBond(m: MoleculeSpec, bond: MolBond): { x: number; y: number } | null {
  const adj = adjacency(m);
  // Breadth-first search for the shortest path from b to a avoiding the bond.
  const prev = new Map<string, string>([[bond.b, '']]);
  const queue = [bond.b];
  while (queue.length) {
    const cur = queue.shift() as string;
    if (cur === bond.a) break;
    for (const { to, bond: e } of adj.get(cur) ?? []) {
      if (e.id === bond.id || prev.has(to)) continue;
      prev.set(to, cur);
      queue.push(to);
    }
  }
  if (!prev.has(bond.a)) return null;
  const byId = new Map(m.atoms.map((a) => [a.id, a]));
  const pts: MolAtom[] = [];
  for (let c = bond.a; c; c = prev.get(c) as string) pts.push(byId.get(c) as MolAtom);
  return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
}

export function adjacency(m: MoleculeSpec): Map<string, { to: string; bond: MolBond }[]> {
  const adj = new Map<string, { to: string; bond: MolBond }[]>();
  for (const a of m.atoms) adj.set(a.id, []);
  for (const bond of m.bonds) {
    adj.get(bond.a)?.push({ to: bond.b, bond });
    adj.get(bond.b)?.push({ to: bond.a, bond });
  }
  return adj;
}

/** Split `CH_3` / `SO_4^{2-}` into runs for superscript and subscript layout. */
export interface LabelRun {
  text: string;
  shift: 'none' | 'sub' | 'sup';
}

export function parseAtomLabel(label: string): LabelRun[] {
  const out: LabelRun[] = [];
  let i = 0;
  const push = (text: string, shift: LabelRun['shift']) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.shift === shift) last.text += text;
    else out.push({ text, shift });
  };
  while (i < label.length) {
    const c = label[i];
    if ((c === '_' || c === '^') && i + 1 < label.length) {
      const shift = c === '_' ? 'sub' : 'sup';
      if (label[i + 1] === '{') {
        const end = label.indexOf('}', i + 2);
        const stop = end < 0 ? label.length : end;
        push(label.slice(i + 2, stop), shift);
        i = stop + 1;
      } else {
        push(label[i + 1], shift);
        i += 2;
      }
    } else {
      push(c, 'none');
      i += 1;
    }
  }
  return out;
}

/** Atoms that get a printed symbol: explicit labels, or a charged/annotated C. */
export function atomText(a: MolAtom): string {
  if (a.label) return a.label;
  return a.charge !== 0 || a.lonePairs.length || a.radicals.length ? 'C' : '';
}

export const chargeText = (c: number): string => {
  if (c === 0) return '';
  const n = Math.abs(c);
  return `${n > 1 ? n : ''}${c > 0 ? '+' : '−'}`;
};

/** Mirror a molecule in place about its own centre. */
export function mirrorMolecule(m: MoleculeSpec, axis: 'h' | 'v'): MoleculeSpec {
  const b = moleculeBounds(m);
  const flip = (deg: number) => ((axis === 'h' ? 180 - deg : -deg) + 360) % 360;
  return {
    ...m,
    atoms: m.atoms.map((a) => ({
      ...a,
      x: axis === 'h' ? b.minX + b.maxX - a.x : a.x,
      y: axis === 'v' ? b.minY + b.maxY - a.y : a.y,
      lonePairs: a.lonePairs.map(flip),
      radicals: a.radicals.map(flip),
    })),
  };
}

export function rotateMolecule(m: MoleculeSpec, deg: number): MoleculeSpec {
  const b = moleculeBounds(m);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const t = rad(deg);
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  return {
    ...m,
    atoms: m.atoms.map((a) => ({
      ...a,
      x: round(cx + (a.x - cx) * Math.cos(t) - (a.y - cy) * Math.sin(t)),
      y: round(cy + (a.x - cx) * Math.sin(t) + (a.y - cy) * Math.cos(t)),
      lonePairs: a.lonePairs.map((d) => (d - deg + 360) % 360),
      radicals: a.radicals.map((d) => (d - deg + 360) % 360),
    })),
  };
}

/**
 * Where to add a new substituent on an atom: the widest open direction, in
 * degrees counter-clockwise from east.
 */
export function freeDirection(m: MoleculeSpec, atomId: string): number {
  const self = m.atoms.find((a) => a.id === atomId);
  if (!self) return 0;
  const adj = adjacency(m).get(atomId) ?? [];
  if (adj.length === 0) return 30;
  const byId = new Map(m.atoms.map((a) => [a.id, a]));
  const used = adj
    .map(({ to }) => {
      const o = byId.get(to) as MolAtom;
      return (((Math.atan2(-(o.y - self.y), o.x - self.x) * 180) / Math.PI) + 360) % 360;
    })
    .sort((a, b) => a - b);
  if (used.length === 1) return (used[0] + 120) % 360;
  let bestGap = -1;
  let best = 0;
  for (let i = 0; i < used.length; i++) {
    const a = used[i];
    const b = i + 1 < used.length ? used[i + 1] : used[0] + 360;
    if (b - a > bestGap) {
      bestGap = b - a;
      best = (a + (b - a) / 2) % 360;
    }
  }
  return Math.round(best / 30) * 30;
}
