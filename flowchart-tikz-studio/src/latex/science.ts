import type { Node, Point } from '../model/types';
import { latexId } from '../model/ids';
import { portAnchor } from '../model/routing';
import { rotatePoint, round } from '../model/geometry';
import { nodeBodies, nodeDecorations, nodeSolids } from '../model/shapes';
import { ColorRegistry, normalizeHex } from './colors';
import { dashOption } from './styles';
import { UnitContext, cm, coord, fmt, toPt } from './units';
import { EmitResult, emitStatement, segsToTikz } from './nodes';
import { escapeComment } from './escape';
import { CIRCUIT_BY_ID, CircuitDef, bipoleUnit } from '../science/physics/circuits';
import { normalizeChemSource, validateTex } from '../science/math/validate';
import type { CircuitSpec, ChemSpec, MathSpec, MoleculeSpec } from '../science/types';
import { emptyCircuitSpec } from '../science/types';
import { moleculeToChemfig, validAtomLabel } from '../science/chem/chemfig';
import { BOND_DU, moleculeNaturalSize } from '../science/chem/molecule';

/**
 * Scientific objects -> LaTeX.
 *
 * These emitters follow the same contract as `emitNode` and `emitChart`: pure
 * functions of a node. Each one reports the packages it needs through
 * `PackageRegistry`, so the preamble lists exactly what is used, once.
 */

export class PackageRegistry {
  private set = new Set<string>();
  use(...names: string[]): void {
    for (const n of names) this.set.add(n);
  }
  has(name: string): boolean {
    return this.set.has(name);
  }
  list(): string[] {
    return PACKAGE_ORDER.filter((p) => this.set.has(p));
  }
  /** One `\usepackage` per package, in a load order that is known to work. */
  render(): string[] {
    return this.list().map((p) => PACKAGE_LINES[p]);
  }
}

const PACKAGE_LINES: Record<string, string> = {
  amsmath: '\\usepackage{amsmath}',
  amssymb: '\\usepackage{amssymb}',
  cancel: '\\usepackage{cancel}',
  circuitikz: '\\usepackage[american]{circuitikz}',
  mhchem: '\\usepackage[version=4]{mhchem}',
  chemfig: '\\usepackage{chemfig}',
};
const PACKAGE_ORDER = Object.keys(PACKAGE_LINES);

export function scienceStyleDefinitions(pkgs: PackageRegistry, usesFormulaStyle: boolean): string[] {
  const lines: string[] = [];
  if (usesFormulaStyle) {
    lines.push('\\tikzset{fcformula/.style={inner sep=0pt, outer sep=0pt}}');
  }
  if (pkgs.has('circuitikz')) {
    lines.push(
      '\\tikzset{fccircuit/.style={line join=round, line cap=butt,',
      '  /tikz/circuitikz/bipoles/thickness=1, /tikz/circuitikz/tripoles/thickness=1}}',
    );
  }
  return lines;
}

const header = (n: Node, label: string, detail: string): string =>
  `% ${n.id} - ${label}${detail ? ` "${escapeComment(detail.replace(/\s+/g, ' ').slice(0, 48))}"` : ''}`;

function centreOf(n: Node): Point {
  return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
}

function usePackagesFor(tex: string, pkgs: PackageRegistry): void {
  pkgs.use('amsmath', 'amssymb');
  if (/\\[bxc]?cancel(?:to)?\b/.test(tex)) pkgs.use('cancel');
}

/** Options common to a node holding typeset content. */
function boxOptions(n: Node, colors: ColorRegistry, ctx: UnitContext): string[] {
  const opts: string[] = [];
  const s = n.style;
  if (s.strokeStyle !== 'none' && s.strokeWidth > 0) {
    opts.push(`draw=${colors.use(s.stroke)}`, `line width=${fmt(toPt(s.strokeWidth, ctx))}pt`);
    opts.push(...dashOption(s.strokeStyle, s.strokeWidth, ctx));
  }
  if (s.fillOpacity > 0) {
    opts.push(`fill=${colors.use(s.fill)}`);
    if (s.fillOpacity < 1) opts.push(`fill opacity=${fmt(round(s.fillOpacity, 3))}`);
  }
  if (s.opacity < 1) opts.push(`opacity=${fmt(round(s.opacity, 3))}`);
  if (n.rotation) opts.push(`rotate=${fmt(-n.rotation)}`);
  return opts;
}

/** Font size in du implied by the box, given content measured in ems. */
export function effectiveFontSize(n: Node, natural: { w: number; h: number } | null): number {
  if (!natural) return n.textStyle.fontSize;
  return Math.min(n.w / natural.w, n.h / natural.h);
}

function brokenFormula(n: Node, ctx: UnitContext, colors: ColorRegistry, why: string): EmitResult {
  return {
    lines: [
      `% ${n.id}: not emitted - ${escapeComment(why)}`,
      `\\node[fcformula, draw=${colors.use('#dc2626')}, inner sep=3pt] (${latexId(n.id)}) at ${coord(centreOf(n), ctx)} {\\texttt{invalid formula}};`,
    ],
    warnings: [`${n.id}: ${why} A visible placeholder was written instead.`],
  };
}

export function emitMath(n: Node, spec: MathSpec, ctx: UnitContext, colors: ColorRegistry, pkgs: PackageRegistry): EmitResult {
  const latex = spec.latex.replace(/\s*\n\s*/g, ' ').trim();
  pkgs.use('amsmath');
  const problem = latex ? validateTex(latex) : 'The formula is empty.';
  if (problem) return brokenFormula(n, ctx, colors, problem);
  usePackagesFor(latex, pkgs);

  const fontDu = effectiveFontSize(n, spec.natural);
  const scale = round(toPt(fontDu, ctx) / 10, 3);
  const opts = ['fcformula', `scale=${fmt(scale)}`, `text=${colors.use(n.textStyle.color)}`, ...boxOptions(n, colors, ctx)];
  const inner = n.textStyle.bold ? `\\boldsymbol{${latex}}` : latex;
  const body = spec.display ? `$\\displaystyle ${inner}$` : `$${inner}$`;
  return {
    lines: [header(n, 'Formula', latex), ...emitStatement('\\node', opts, ` (${latexId(n.id)}) at ${coord(centreOf(n), ctx)} {${body}};`)],
    warnings: [],
  };
}

export function emitChem(n: Node, spec: ChemSpec, ctx: UnitContext, colors: ColorRegistry, pkgs: PackageRegistry): EmitResult {
  const source = normalizeChemSource(spec.source.replace(/\s*\n\s*/g, ' ').trim());
  pkgs.use('mhchem');
  const problem = source ? validateTex(source) : 'The chemical formula is empty.';
  if (problem) return brokenFormula(n, ctx, colors, problem);

  const fontDu = effectiveFontSize(n, spec.natural);
  const scale = round(toPt(fontDu, ctx) / 10, 3);
  const opts = ['fcformula', `scale=${fmt(scale)}`, `text=${colors.use(n.textStyle.color)}`, ...boxOptions(n, colors, ctx)];
  if (n.textStyle.bold) pkgs.use('amsmath');
  const body = n.textStyle.bold ? `$\\boldsymbol{\\ce{${source}}}$` : `\\ce{${source}}`;
  return {
    lines: [header(n, 'Chemical formula', source), ...emitStatement('\\node', opts, ` (${latexId(n.id)}) at ${coord(centreOf(n), ctx)} {${body}};`)],
    warnings: [],
  };
}

export function emitMolecule(n: Node, spec: MoleculeSpec, ctx: UnitContext, colors: ColorRegistry, pkgs: PackageRegistry): EmitResult {
  pkgs.use('chemfig');
  const warnings: string[] = [];
  const bad = spec.atoms.find((a) => !validAtomLabel(a.label));
  if (bad) {
    return brokenFormula(n, ctx, colors, `Atom label "${bad.label}" uses characters chemfig cannot accept.`);
  }
  if (spec.atoms.length === 0) {
    return { lines: [`% ${n.id}: empty molecule, nothing to draw`], warnings: [`${n.id}: the molecule has no atoms.`] };
  }

  const nat = moleculeNaturalSize(spec);
  const boxScale = Math.min(n.w / nat.w, n.h / nat.h);
  const bondDu = BOND_DU * boxScale;
  const fontDu = n.textStyle.fontSize * boxScale;
  // chemfig's atoms are 10pt; \scalebox matches them, and the bond length and
  // pen are divided by the same factor so they still land on the canvas value.
  const k = round(toPt(fontDu, ctx) / 10, 3) || 1;
  const atomSepCm = round(cm(bondDu, ctx) / k, 3);
  const lineWidthPt = round(toPt(Math.max(0.1, n.style.strokeWidth), ctx) / k, 3);
  const strokeName = colors.use(n.style.stroke);
  const textName = colors.use(n.textStyle.color);

  const chem = moleculeToChemfig(spec, {
    atomSepCm,
    lineWidthPt,
    strokeName,
    colorName: (hex) => colors.use(normalizeHex(hex) ? hex : n.textStyle.color),
  });
  const opts = ['fcformula', ...boxOptions({ ...n, style: { ...n.style, strokeStyle: 'none' } }, colors, ctx)];
  const set = `\\setchemfig{atom sep=${fmt(atomSepCm)}cm, bond style={draw=${strokeName}, line width=${fmt(lineWidthPt)}pt}}`;
  const body = `\\scalebox{${fmt(k)}}{\\color{${textName}}${set}\\chemfig{${chem}}}`;
  const lines = [
    header(n, 'Molecule', `${spec.atoms.length} atoms`),
    ...emitStatement('\\node', opts, ` (${latexId(n.id)}) at ${coord(centreOf(n), ctx)} {%`),
    `  ${body}};`,
  ];
  return { lines, warnings };
}

/* ---------------------------------------------------------------- circuits */

const mathBody = (s: string) => `{$${s}$}`;

/**
 * CircuiTikZ places `l=` on the left of the direction of travel; the canvas
 * keeps the name on the visually upper side. True when those two disagree.
 */
export function labelSideFlipped(n: Node): boolean {
  const a = ((n.rotation % 360) + 360) % 360;
  const local = a > 90 && a <= 270 ? 1 : -1;
  // Canvas-space normal on the name's side, and the direction of travel.
  const t = (a * Math.PI) / 180;
  const side = { x: -local * Math.sin(t), y: local * Math.cos(t) };
  const dir = n.flipH ? -1 : 1;
  const travel = { x: dir * Math.cos(t), y: dir * Math.sin(t) };
  const leftOfTravel = { x: travel.y, y: -travel.x };
  return side.x * leftOfTravel.x + side.y * leftOfTravel.y < 0;
}

function labelOptions(spec: CircuitSpec, n: Node, colors: ColorRegistry): { opts: string[]; problems: string[] } {
  const flipped = labelSideFlipped(n);
  const L = flipped ? 'l_' : 'l';
  const A = flipped ? 'a^' : 'a';
  const V = flipped ? 'v^' : 'v';
  const opts: string[] = [];
  const problems: string[] = [];
  const paint = (s: string) => {
    const c = n.textStyle.color;
    return c.toLowerCase() === '#12161c' ? s : `\\textcolor{${colors.use(c)}}{${s}}`;
  };
  const checked = (s: string) => {
    const p = validateTex(s);
    if (p) problems.push(p);
    return !p;
  };
  const label = spec.label.trim();
  const value = spec.value.trim();
  const voltage = spec.voltage.trim();
  const current = spec.current.trim();
  // `a=` and `v=` share a side, so with a voltage the value joins the main label.
  if (voltage && value) {
    const joined = label ? `${label}=${value}` : value;
    if (checked(joined)) opts.push(`${L}=${mathBody(paint(joined))}`);
  } else {
    if (label && checked(label)) opts.push(`${L}=${mathBody(paint(label))}`);
    if (value && checked(value)) opts.push(`${label ? A : L}=${mathBody(paint(value))}`);
  }
  if (voltage && checked(voltage)) opts.push(`${V}=${mathBody(paint(voltage))}`);
  if (current && checked(current)) {
    const key = spec.currentDir === 'backward' ? (flipped ? 'i<_' : 'i<') : flipped ? 'i_>' : 'i';
    opts.push(`${key}=${mathBody(paint(current))}`);
  }
  return { opts, problems };
}

function circuitPen(n: Node, colors: ColorRegistry, ctx: UnitContext): string[] {
  const opts = ['fccircuit', `color=${colors.use(n.style.stroke)}`, `line width=${fmt(toPt(Math.max(0.1, n.style.strokeWidth), ctx))}pt`];
  if (n.style.opacity < 1) opts.push(`opacity=${fmt(round(n.style.opacity, 3))}`);
  return opts;
}

/** Whether the fill should be passed on: a real colour on a symbol with a body. */
function fillOption(n: Node, colors: ColorRegistry): string[] {
  if (n.style.fill.toLowerCase() === '#ffffff' || n.style.fillOpacity <= 0) return [];
  return nodeBodies(n).length ? [`fill=${colors.use(n.style.fill)}`] : [];
}

function emitBipole(n: Node, def: CircuitDef, spec: CircuitSpec, ctx: UnitContext, colors: ColorRegistry): EmitResult {
  const warnings: string[] = [];
  const a = portAnchor(n, 'w').p;
  const b = portAnchor(n, 'e').p;
  const { opts: labels, problems } = labelOptions(spec, n, colors);
  for (const p of problems) warnings.push(`${n.id}: a label was left out. ${p}`);

  const u = bipoleUnit(n.h);
  if (n.w < (def.body ?? 0.8) * u - 0.5) {
    warnings.push(`${n.id}: ${def.label} is shorter than its symbol; widen it or reduce its height.`);
  }
  const pen = [...circuitPen(n, colors, ctx), `/tikz/circuitikz/bipoles/length=${fmt(cm(u, ctx))}cm`];
  const elementOpts = [def.tikz, ...labels, ...fillOption(n, colors)];
  if (n.flipV) elementOpts.push('invert');
  // A wiper needs a name so hand-written code can reach `name.wiper`.
  if (def.id === 'circuit.potentiometer') elementOpts.push(`name=${latexId(n.id)}`);
  const lines = [
    header(n, def.label, spec.label),
    ...emitStatement('\\draw', pen, ` ${coord(a, ctx)} to[${elementOpts.join(', ')}] ${coord(b, ctx)};`),
  ];
  return { lines, warnings };
}

function emitNodeComponent(n: Node, def: CircuitDef, spec: CircuitSpec, ctx: UnitContext, colors: ColorRegistry): EmitResult {
  const warnings: string[] = [];
  const opts = [def.tikz, ...circuitPen(n, colors, ctx), ...fillOption(n, colors)];
  const centre = centreOf(n);
  const baseScale = 50 / ctx.unitsPerCm;
  let at: Point;
  let sx = baseScale;
  let sy = baseScale;
  if (def.mode === 'oneport') {
    // The connection point is the anchor of a one-port element.
    at = portAnchor(n, 'n').p;
    if (def.size.w > 12) {
      const k = Math.min(n.w / def.size.w, n.h / def.size.h);
      sx *= k;
      sy *= k;
    } else {
      // Dots keep their CircuiTikZ size at any box size.
      sx = 1;
      sy = 1;
    }
  } else {
    // Local position of the element's centre inside the box.
    const origin = def.origin ?? { x: 0.5, y: 0.5 };
    const ox = n.flipH ? 1 - origin.x : origin.x;
    const oy = n.flipV ? 1 - origin.y : origin.y;
    at = rotatePoint({ x: n.x + n.w * ox, y: n.y + n.h * oy }, centre, n.rotation);
    sx *= n.w / def.size.w;
    sy *= n.h / def.size.h;
  }
  if (n.flipH) sx = -sx;
  if (n.flipV) sy = -sy;
  sx = round(sx, 3);
  sy = round(sy, 3);

  // A scope composes rotate-after-scale correctly; options on a CircuiTikZ node
  // shear when a rotation is combined with a scale.
  const plain = !n.rotation && sx === 1 && sy === 1;
  const lines = [header(n, def.label, spec.label)];
  if (plain) {
    lines.push(...emitStatement('\\node', opts, ` (${latexId(n.id)}) at ${coord(at, ctx)} {};`));
  } else {
    const transforms = [`shift={${coord(at, ctx)}}`];
    if (n.rotation) transforms.push(`rotate=${fmt(-n.rotation)}`);
    if (sx !== 1 || sy !== 1) transforms.push(`xscale=${fmt(sx)}`, `yscale=${fmt(sy)}`);
    transforms.push('transform shape');
    lines.push(`\\begin{scope}[${transforms.join(', ')}]`);
    lines.push(...emitStatement('\\node', opts, ` (${latexId(n.id)}) at (0,0) {};`, '  '));
    lines.push('\\end{scope}');
  }

  // Node elements have no `l=`, so their label is a neighbouring node.
  const text = [spec.label.trim(), spec.value.trim()].filter(Boolean).join('=');
  if (text) {
    const problem = validateTex(text);
    if (problem) {
      warnings.push(`${n.id}: the label was left out. ${problem}`);
    } else {
      const p = rotatePoint({ x: n.x + n.w + 6, y: n.y + n.h / 2 }, centre, n.rotation);
      lines.push(`\\node[anchor=west, text=${colors.use(n.textStyle.color)}] at ${coord(p, ctx)} {$${text}$};`);
    }
  }
  return { lines, warnings };
}

export function emitCircuit(n: Node, ctx: UnitContext, colors: ColorRegistry, pkgs: PackageRegistry): EmitResult {
  pkgs.use('circuitikz', 'amsmath');
  const def = CIRCUIT_BY_ID[n.kind];
  const spec = n.science?.type === 'circuit' ? n.science : emptyCircuitSpec();
  if (!def) throw new Error(`unknown circuit component ${n.kind}`);
  return def.mode === 'bipole' ? emitBipole(n, def, spec, ctx, colors) : emitNodeComponent(n, def, spec, ctx, colors);
}

/* ---------------------------------------------------------------- physics */

/** Extra paths of a shape with `bodies` or `solids`, inside its rotation scope. */
export function emitExtraPaths(
  n: Node,
  ctx: UnitContext,
  colors: ColorRegistry,
  strokeOnly: string[],
  indent: string,
): string[] {
  const toWorld = (segs: ReturnType<typeof nodeDecorations>[number]) =>
    segs.map((s) => {
      const t = (p: Point) => ({ x: n.x + p.x, y: n.y + p.y });
      if (s.c === 'Z') return s;
      if (s.c === 'C') return { c: 'C' as const, c1: t(s.c1), c2: t(s.c2), p: t(s.p) };
      return { c: s.c, p: t(s.p) };
    });
  const out: string[] = [];
  const close = (l: string, i: number, arr: string[]) => (i === arr.length - 1 ? `${l};` : l);
  for (const body of nodeBodies(n)) {
    const opts = ['fcpath', ...strokeOnly];
    if (n.style.fillOpacity > 0) opts.push(`fill=${colors.use(n.style.fill)}`);
    out.push(...emitStatement('\\draw', opts, '', indent));
    out.push(...segsToTikz(toWorld(body), ctx, `${indent}  `).map(close));
  }
  for (const solid of nodeSolids(n)) {
    out.push(...emitStatement('\\fill', [`fill=${colors.use(n.style.stroke)}`], '', indent));
    out.push(...segsToTikz(toWorld(solid), ctx, `${indent}  `).map(close));
  }
  return out;
}

