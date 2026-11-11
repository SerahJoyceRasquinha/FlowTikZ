/**
 * Payloads of the scientific object types.
 *
 * Every one of them lives on an ordinary `Node` (`node.science`), exactly the
 * way a data chart lives on `node.chart`. The node still owns position, size,
 * rotation, style, z-order and grouping, so selection, dragging, snapping,
 * undo, copy/paste, alignment and saving need no special cases. The field is
 * optional: files saved before it existed load unchanged.
 *
 * To add a new kind of object: add a member to `ScienceSpec`, a reader in
 * `coerce.ts`, a canvas view in `canvas/ScienceView.tsx` and an emitter in
 * `latex/science.ts`.
 */

/** Natural (scale 1) size of typeset content, in ems. */
export interface NaturalSize {
  w: number;
  h: number;
}

export interface MathSpec {
  type: 'math';
  /** LaTeX math-mode source, without surrounding `$`. */
  latex: string;
  /** True for display style (big limits), false for inline style. */
  display: boolean;
  natural: NaturalSize | null;
}

export type ReactionArrow = '->' | '<-' | '<->' | '<=>' | '<=>>' | '<<=>';

export interface ReactionTerm {
  coefficient: string;
  formula: string;
  state: '' | 's' | 'l' | 'g' | 'aq';
}

export interface ReactionStage {
  arrow: ReactionArrow;
  /** Above the arrow, e.g. a catalyst. */
  above: string;
  /** Below the arrow, e.g. a temperature. */
  below: string;
  /** Species formed by this step. */
  products: ReactionTerm[];
}

export interface ReactionSpec {
  reactants: ReactionTerm[];
  stages: ReactionStage[];
}

export interface ChemSpec {
  type: 'chem';
  /** mhchem source: the argument of `\ce{...}`. */
  source: string;
  natural: NaturalSize | null;
  /** Present when built in the reaction editor, so it re-opens there. */
  reaction?: ReactionSpec;
}

export type BondOrder = 1 | 2 | 3;
export type BondStereo = 'none' | 'wedge' | 'dash';

export interface MolAtom {
  id: string;
  /** Position in bond lengths; +y is down, as on the canvas. */
  x: number;
  y: number;
  /** Label such as `O`, `CH_3`, `NH_2`. Empty is an implicit skeletal carbon. */
  label: string;
  /** Formal charge. */
  charge: number;
  /** Direction of each lone pair, degrees counter-clockwise from east. */
  lonePairs: number[];
  /** Direction of each unpaired electron, degrees. */
  radicals: number[];
  /** Per-atom colour override; absent means the node's text colour. */
  color?: string;
}

export interface MolBond {
  id: string;
  /** For stereo bonds `a` is the narrow end. */
  a: string;
  b: string;
  order: BondOrder;
  stereo: BondStereo;
}

export interface MoleculeSpec {
  type: 'molecule';
  atoms: MolAtom[];
  bonds: MolBond[];
  /** Rings drawn with an inscribed circle, as lists of atom ids. */
  aromaticRings: string[][];
}

export interface CircuitSpec {
  type: 'circuit';
  /** All four are LaTeX math-mode strings; empty means not shown. */
  label: string;
  value: string;
  voltage: string;
  current: string;
  /** Current arrow relative to the left-to-right direction of the component. */
  currentDir: 'forward' | 'backward';
}

export type ScienceSpec = MathSpec | ChemSpec | MoleculeSpec | CircuitSpec;

export function emptyCircuitSpec(label = ''): CircuitSpec {
  return { type: 'circuit', label, value: '', voltage: '', current: '', currentDir: 'forward' };
}
