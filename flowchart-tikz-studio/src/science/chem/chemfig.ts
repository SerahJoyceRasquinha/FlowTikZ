import type { MolAtom, MolBond, MoleculeSpec } from '../types';
import { adjacency, atomText, chargeText, findRingCentreForBond } from './molecule';
import { fmt } from '../../latex/units';

/**
 * Molecule graph -> chemfig source.
 *
 * chemfig describes a structure as a walk: bonds in sequence, parentheses for
 * branches, and named hooks (`?[a]`) to close rings. A depth-first walk of the
 * graph maps onto that directly. Every bond is written with an absolute angle
 * and a relative length taken from the model, so the compiled geometry follows
 * the canvas rather than chemfig's defaults.
 */

export interface ChemfigOptions {
  /** Resolves a `#rrggbb` to a defined LaTeX colour name. */
  colorName?: (hex: string) => string;
  /** Radius of aromatic circles relative to the ring, in cm. */
  atomSepCm: number;
  lineWidthPt: number;
  strokeName: string;
}

const LABEL_OK = /^[A-Za-z0-9_^{}+\-()]*$/;

export function validAtomLabel(label: string): boolean {
  return LABEL_OK.test(label);
}

function bondCode(b: MolBond, forward: boolean, inRingSide: '' | '^' | '_'): string {
  if (b.stereo === 'wedge') return forward ? '<' : '>';
  if (b.stereo === 'dash') return forward ? '<:' : '>:';
  if (b.order === 2) return `=${inRingSide}`;
  if (b.order === 3) return '~';
  return '-';
}

function angleDeg(from: MolAtom, to: MolAtom): number {
  // The model's y grows downward; chemfig's angles are counter-clockwise.
  const a = (Math.atan2(-(to.y - from.y), to.x - from.x) * 180) / Math.PI;
  return Math.round(((a + 360) % 360) * 100) / 100;
}

function atomSource(a: MolAtom, opts: ChemfigOptions): string {
  const text = atomText(a);
  let body = text;
  const marks: string[] = [];
  if (a.charge !== 0) {
    marks.push(`45:1.5pt=$\\scriptstyle ${chargeText(a.charge).replace('−', '-')}$`);
  }
  for (const d of a.lonePairs) marks.push(`${fmt(d)}=\\:`);
  for (const d of a.radicals) marks.push(`${fmt(d)}=\\.`);
  if (marks.length) body = `\\charge{${marks.join(',')}}{${text}}`;
  if (a.color && opts.colorName && body) body = `\\textcolor{${opts.colorName(a.color)}}{${body}}`;
  return body ? `{${body}}` : '';
}

/** Which side of a bond (seen from a to b) its ring lies on. */
function ringSide(m: MoleculeSpec, bond: MolBond, from: MolAtom, to: MolAtom): '' | '^' | '_' {
  if (bond.order !== 2) return '';
  const c = findRingCentreForBond(m, bond);
  if (!c) return '';
  const cross = (to.x - from.x) * (c.y - from.y) - (to.y - from.y) * (c.x - from.x);
  if (Math.abs(cross) < 1e-6) return '';
  // y grows downward: a positive cross means the ring is on the right of travel.
  return cross > 0 ? '_' : '^';
}

export function moleculeToChemfig(m: MoleculeSpec, opts: ChemfigOptions): string {
  if (m.atoms.length === 0) return '';
  const byId = new Map(m.atoms.map((a) => [a.id, a]));
  const adj = adjacency(m);
  const visited = new Set<string>();
  const usedBonds = new Set<string>();

  // Ring-closing bonds become a pair of hooks; find them with a first pass.
  const closures = new Map<string, { hook: string; bond: MolBond; other: string; closesHere: boolean }[]>();
  let hookIndex = 0;
  const hookName = () => String.fromCharCode(97 + (hookIndex++ % 26)) + (hookIndex > 26 ? hookIndex : '');

  const seen = new Set<string>();
  const treeBonds = new Set<string>();
  const scan = (id: string) => {
    seen.add(id);
    for (const { to, bond } of adj.get(id) ?? []) {
      if (treeBonds.has(bond.id) || closures.get(id)?.some((c) => c.bond.id === bond.id)) continue;
      if (seen.has(to)) {
        const hook = hookName();
        (closures.get(to) ?? closures.set(to, []).get(to)!).push({ hook, bond, other: id, closesHere: false });
        (closures.get(id) ?? closures.set(id, []).get(id)!).push({ hook, bond, other: to, closesHere: true });
      } else {
        treeBonds.add(bond.id);
        scan(to);
      }
    }
  };
  for (const a of m.atoms) if (!seen.has(a.id)) scan(a.id);

  const aromaticByAtom = new Map<string, string[]>();
  for (const ring of m.aromaticRings) if (ring.length) aromaticByAtom.set(ring[0], ring);

  const hookText = (id: string): string =>
    (closures.get(id) ?? [])
      .map(({ hook, bond, other, closesHere }) => {
        if (!closesHere) return `?[${hook}]`;
        const here = byId.get(id) as MolAtom;
        const there = byId.get(other) as MolAtom;
        const forward = bond.a === id;
        return `?[${hook},{${bondCode(bond, forward, ringSide(m, bond, here, there))}}]`;
      })
      .join('');

  const aromaticBranch = (a: MolAtom, ring: string[]): string => {
    const pts = ring.map((id) => byId.get(id) as MolAtom);
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const dist = Math.hypot(cx - a.x, cy - a.y);
    const angle = angleDeg(a, { ...a, x: cx, y: cy });
    const r = opts.atomSepCm * dist * 0.62;
    const pen = `draw=${opts.strokeName},line width=${fmt(opts.lineWidthPt)}pt`;
    return `(-[:${fmt(angle)},${fmt(dist)},,,draw=none]{\\tikz{\\draw[${pen}] (0,0) circle (${fmt(r)});}})`;
  };

  const walk = (id: string, branch = ''): string => {
    visited.add(id);
    const a = byId.get(id) as MolAtom;
    let out = atomSource(a, opts) + hookText(id) + branch;
    const ring = aromaticByAtom.get(id);
    if (ring) out += aromaticBranch(a, ring);

    const children = (adj.get(id) ?? []).filter(({ to, bond }) => treeBonds.has(bond.id) && !usedBonds.has(bond.id) && !visited.has(to));
    const pieces: string[] = [];
    for (const { to, bond } of children) {
      if (visited.has(to)) continue;
      usedBonds.add(bond.id);
      const next = byId.get(to) as MolAtom;
      const len = Math.hypot(next.x - a.x, next.y - a.y);
      const code = bondCode(bond, bond.a === id, ringSide(m, bond, a, next));
      const lenText = Math.abs(len - 1) < 0.005 ? '' : `,${fmt(Math.round(len * 1000) / 1000)}`;
      pieces.push(`${code}[:${fmt(angleDeg(a, next))}${lenText}]${walk(to)}`);
    }
    // All but the last continuation go in parentheses.
    pieces.forEach((p, i) => {
      out += i < pieces.length - 1 ? `(${p})` : p;
    });
    return out;
  };

  // Disconnected fragments hang off the first atom of the previous one by an
  // invisible bond, which keeps the whole structure in a single \\chemfig.
  const roots: MolAtom[] = [];
  const reached = new Set<string>();
  const mark = (id: string) => {
    reached.add(id);
    for (const { to } of adj.get(id) ?? []) if (!reached.has(to)) mark(to);
  };
  for (const a of m.atoms) {
    if (!reached.has(a.id)) {
      roots.push(a);
      mark(a.id);
    }
  }
  let source = '';
  for (let i = roots.length - 1; i >= 0; i--) {
    let link = '';
    if (i < roots.length - 1) {
      const from = roots[i];
      const to = roots[i + 1];
      const len = Math.round(Math.hypot(to.x - from.x, to.y - from.y) * 1000) / 1000;
      link = `(-[:${fmt(angleDeg(from, to))},${fmt(len)},,,draw=none]${source})`;
    }
    source = walk(roots[i].id, link);
  }
  return source;
}
