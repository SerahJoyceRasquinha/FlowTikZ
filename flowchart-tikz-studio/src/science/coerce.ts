import type {
  BondStereo,
  MolAtom,
  MolBond,
  NaturalSize,
  ReactionArrow,
  ReactionSpec,
  ReactionTerm,
  ScienceSpec,
} from './types';

/**
 * Defensive reader for `node.science` in save files. Like the rest of the
 * persistence layer it degrades instead of throwing: an unreadable payload is
 * reported as an unreadable shape, never as a crashed editor.
 */

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const angles = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x) => Number.isFinite(x)).map(Number) : []);

function natural(raw: unknown): NaturalSize | null {
  const r = raw as NaturalSize | null;
  return r && typeof r === 'object' && r.w > 0 && r.h > 0 ? { w: Number(r.w), h: Number(r.h) } : null;
}

const STATES = new Set(['', 's', 'l', 'g', 'aq']);
const ARROWS = new Set<ReactionArrow>(['->', '<-', '<->', '<=>', '<=>>', '<<=>']);

function term(raw: any): ReactionTerm {
  return {
    coefficient: str(raw?.coefficient),
    formula: str(raw?.formula),
    state: (STATES.has(raw?.state) ? raw.state : '') as ReactionTerm['state'],
  };
}

function reaction(raw: any): ReactionSpec | undefined {
  if (!raw || !Array.isArray(raw.reactants) || !Array.isArray(raw.stages)) return undefined;
  return {
    reactants: raw.reactants.map(term),
    stages: raw.stages.map((s: any) => ({
      arrow: ARROWS.has(s?.arrow) ? s.arrow : '->',
      above: str(s?.above),
      below: str(s?.below),
      products: Array.isArray(s?.products) ? s.products.map(term) : [],
    })),
  };
}

function atom(raw: any): MolAtom | null {
  if (!raw || typeof raw.id !== 'string') return null;
  const a: MolAtom = {
    id: raw.id,
    x: num(raw.x),
    y: num(raw.y),
    label: str(raw.label),
    charge: Math.round(num(raw.charge)),
    lonePairs: angles(raw.lonePairs),
    radicals: angles(raw.radicals),
  };
  if (typeof raw.color === 'string') a.color = raw.color;
  return a;
}

function bond(raw: any, known: Set<string>): MolBond | null {
  if (!raw || typeof raw.id !== 'string' || !known.has(raw.a) || !known.has(raw.b) || raw.a === raw.b) return null;
  return {
    id: raw.id,
    a: raw.a,
    b: raw.b,
    order: raw.order === 2 || raw.order === 3 ? raw.order : 1,
    stereo: (raw.stereo === 'wedge' || raw.stereo === 'dash' ? raw.stereo : 'none') as BondStereo,
  };
}

export function coerceScience(raw: any): ScienceSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  switch (raw.type) {
    case 'math':
      if (typeof raw.latex !== 'string') return null;
      return { type: 'math', latex: raw.latex, display: raw.display !== false, natural: natural(raw.natural) };
    case 'chem': {
      if (typeof raw.source !== 'string') return null;
      const r = reaction(raw.reaction);
      return { type: 'chem', source: raw.source, natural: natural(raw.natural), ...(r ? { reaction: r } : {}) };
    }
    case 'molecule': {
      if (!Array.isArray(raw.atoms)) return null;
      const atoms = raw.atoms.map(atom).filter(Boolean) as MolAtom[];
      const known = new Set(atoms.map((a) => a.id));
      const bonds = (Array.isArray(raw.bonds) ? raw.bonds : []).map((b: any) => bond(b, known)).filter(Boolean) as MolBond[];
      const aromaticRings = (Array.isArray(raw.aromaticRings) ? raw.aromaticRings : [])
        .filter((r: unknown) => Array.isArray(r) && r.length >= 3 && r.every((id) => known.has(id as string)))
        .map((r: string[]) => [...r]);
      return { type: 'molecule', atoms, bonds, aromaticRings };
    }
    case 'circuit':
      return {
        type: 'circuit',
        label: str(raw.label),
        value: str(raw.value),
        voltage: str(raw.voltage),
        current: str(raw.current),
        currentDir: raw.currentDir === 'backward' ? 'backward' : 'forward',
      };
    default:
      return null;
  }
}
