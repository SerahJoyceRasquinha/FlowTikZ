import type { ReactionSpec, ReactionTerm, ReactionStage } from '../types';

/** Reaction model -> mhchem source, plus an atom-balance check. */

export function blankTerm(formula = ''): ReactionTerm {
  return { coefficient: '', formula, state: '' };
}

export function blankStage(): ReactionStage {
  return { arrow: '->', above: '', below: '', products: [blankTerm()] };
}

export function blankReaction(): ReactionSpec {
  return { reactants: [blankTerm()], stages: [blankStage()] };
}

function termSource(t: ReactionTerm): string {
  const f = t.formula.trim();
  if (!f) return '';
  const c = t.coefficient.trim();
  return `${c ? `${c} ` : ''}${f}${t.state ? `(${t.state})` : ''}`;
}

const side = (terms: ReactionTerm[]) => terms.map(termSource).filter(Boolean).join(' + ');

/** Text in an arrow condition; square brackets would end the mhchem group. */
const condition = (s: string) => s.trim().replace(/\[/g, '(').replace(/\]/g, ')');

export function reactionToSource(r: ReactionSpec): string {
  let out = side(r.reactants);
  for (const st of r.stages) {
    const above = condition(st.above);
    const below = condition(st.below);
    const arms = below ? `[${above}][${below}]` : above ? `[${above}]` : '';
    out += ` ${st.arrow}${arms} ${side(st.products)}`;
  }
  return out.trim();
}

export type ElementCounts = Record<string, number>;

/** Count atoms in a formula such as `Ca(OH)2` or `CuSO4.5H2O`. Null if unreadable. */
export function countAtoms(formula: string): ElementCounts | null {
  const clean = formula.replace(/\^\{?[0-9]*[+-]\}?/g, '').replace(/[+-]$/g, '').trim();
  const totals: ElementCounts = {};
  for (const part of clean.split(/[.*·]/)) {
    const lead = part.match(/^\s*(\d+)/);
    const mult = lead ? Number(lead[1]) : 1;
    const stack: ElementCounts[] = [{}];
    const body = part.replace(/^\s*\d+/, '').replace(/[_{}]/g, '');
    let i = 0;
    while (i < body.length) {
      const c = body[i];
      if (c === '(' || c === '[') {
        stack.push({});
        i++;
      } else if (c === ')' || c === ']') {
        i++;
        let digits = '';
        while (i < body.length && /\d/.test(body[i])) digits += body[i++];
        const n = digits ? Number(digits) : 1;
        const top = stack.pop();
        if (!top || stack.length === 0) return null;
        for (const [k, v] of Object.entries(top)) stack[stack.length - 1][k] = (stack[stack.length - 1][k] ?? 0) + v * n;
      } else if (/[A-Z]/.test(c)) {
        let sym = c;
        i++;
        while (i < body.length && /[a-z]/.test(body[i])) sym += body[i++];
        let digits = '';
        while (i < body.length && /\d/.test(body[i])) digits += body[i++];
        const n = digits ? Number(digits) : 1;
        const cur = stack[stack.length - 1];
        cur[sym] = (cur[sym] ?? 0) + n;
      } else if (/\s/.test(c)) {
        i++;
      } else {
        return null;
      }
    }
    if (stack.length !== 1) return null;
    for (const [k, v] of Object.entries(stack[0])) totals[k] = (totals[k] ?? 0) + v * mult;
  }
  return Object.keys(totals).length ? totals : null;
}

function sideCounts(terms: ReactionTerm[]): ElementCounts | null {
  const total: ElementCounts = {};
  for (const t of terms) {
    if (!t.formula.trim()) continue;
    const c = countAtoms(t.formula);
    if (!c) return null;
    const coeff = t.coefficient.trim() ? Number(t.coefficient) : 1;
    if (!Number.isFinite(coeff)) return null;
    for (const [k, v] of Object.entries(c)) total[k] = (total[k] ?? 0) + v * coeff;
  }
  return total;
}

export interface BalanceReport {
  /** null when a formula could not be read, so no verdict is offered. */
  balanced: boolean | null;
  problems: string[];
}

/** Check each step of a reaction for conservation of atoms. */
export function checkBalance(r: ReactionSpec): BalanceReport {
  const problems: string[] = [];
  let left = r.reactants;
  for (const [i, st] of r.stages.entries()) {
    const a = sideCounts(left);
    const b = sideCounts(st.products);
    if (!a || !b || Object.keys(a).length === 0 || Object.keys(b).length === 0) return { balanced: null, problems: [] };
    for (const el of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const x = a[el] ?? 0;
      const y = b[el] ?? 0;
      if (Math.abs(x - y) > 1e-9) problems.push(`Step ${i + 1}: ${el} is ${x} on the left and ${y} on the right.`);
    }
    left = st.products;
  }
  return { balanced: problems.length === 0, problems };
}

export const ELEMENTS =
  'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(' ');
