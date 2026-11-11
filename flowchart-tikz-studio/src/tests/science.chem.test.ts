import { describe, expect, it } from 'vitest';
import { checkBalance, countAtoms, ELEMENTS, reactionToSource, blankReaction, blankStage } from '../science/chem/reaction';
import {
  FUNCTIONAL_GROUPS,
  MOLECULE_TEMPLATES,
  adjacency,
  atomText,
  chargeText,
  findRingCentreForBond,
  freeDirection,
  fromBlueprint,
  mirrorMolecule,
  moleculeBounds,
  moleculeNaturalSize,
  parseAtomLabel,
  placeMolecule,
  rotateMolecule,
} from '../science/chem/molecule';
import { moleculeToChemfig, validAtomLabel } from '../science/chem/chemfig';
import type { MoleculeSpec, ReactionSpec } from '../science/types';
import { SAMPLE_REACTION } from '../science/gallery';

const opts = { atomSepCm: 1, lineWidthPt: 0.6, strokeName: 'black', colorName: () => 'red' };
const tpl = (id: string): MoleculeSpec => fromBlueprint(MOLECULE_TEMPLATES.find((t) => t.id === id)!.blueprint);
const chem = (m: MoleculeSpec) => moleculeToChemfig(m, opts);

function balanced(s: string) {
  let d = 0;
  for (const c of s) {
    if (c === '{' || c === '(' || c === '[') d++;
    if (c === '}' || c === ')' || c === ']') d--;
    if (d < 0) return false;
  }
  return d === 0;
}

describe('reactions', () => {
  it('writes mhchem with arrows and conditions', () => {
    expect(reactionToSource(SAMPLE_REACTION)).toBe('2 H2(g) + O2(g) ->[Pt][$\\Delta$] 2 H2O(l)');
  });
  it('writes multi-step sequences', () => {
    const r: ReactionSpec = {
      reactants: [{ coefficient: '', formula: 'A', state: '' }],
      stages: [
        { arrow: '->', above: 'k1', below: '', products: [{ coefficient: '', formula: 'B', state: '' }] },
        { arrow: '<=>', above: '', below: '', products: [{ coefficient: '', formula: 'C', state: '' }] },
      ],
    };
    expect(reactionToSource(r)).toBe('A ->[k1] B <=> C');
  });
  it('a below-only condition keeps the above slot empty', () => {
    const r = blankReaction();
    r.reactants[0].formula = 'A';
    r.stages[0].below = 'x';
    r.stages[0].products[0].formula = 'B';
    expect(reactionToSource(r)).toBe('A ->[][x] B');
  });
  it('square brackets in a condition cannot close the mhchem group', () => {
    const r = blankReaction();
    r.reactants[0].formula = 'A';
    r.stages[0].above = '[Pt]';
    r.stages[0].products[0].formula = 'B';
    expect(reactionToSource(r)).toBe('A ->[(Pt)] B');
  });
  it('skips blank terms', () => {
    const r = blankReaction();
    r.reactants = [{ coefficient: '', formula: 'A', state: '' }, { coefficient: '2', formula: ' ', state: 's' }];
    r.stages = [blankStage()];
    r.stages[0].products[0].formula = 'B';
    expect(reactionToSource(r)).toBe('A -> B');
  });
  it.each([
    ['H2O', { H: 2, O: 1 }],
    ['Ca(OH)2', { Ca: 1, O: 2, H: 2 }],
    ['Al2(SO4)3', { Al: 2, S: 3, O: 12 }],
    ['CuSO4.5H2O', { Cu: 1, S: 1, O: 9, H: 10 }],
    ['NH4+', { N: 1, H: 4 }],
    ['SO4^2-', { S: 1, O: 4 }],
    ['[Fe(CN)6]', { Fe: 1, C: 6, N: 6 }],
  ])('counts atoms in %s', (f, want) => {
    expect(countAtoms(f)).toEqual(want);
  });
  it('declines formulas it cannot read', () => {
    expect(countAtoms('h2o')).toBeNull();
    expect(countAtoms('(H2')).toBeNull();
    expect(countAtoms('')).toBeNull();
  });
  it('confirms a balanced equation', () => {
    expect(checkBalance(SAMPLE_REACTION)).toEqual({ balanced: true, problems: [] });
  });
  it('points out an unbalanced one', () => {
    const r = JSON.parse(JSON.stringify(SAMPLE_REACTION)) as ReactionSpec;
    r.reactants[0].coefficient = '';
    const out = checkBalance(r);
    expect(out.balanced).toBe(false);
    expect(out.problems[0]).toContain('H is 2 on the left and 4 on the right');
  });
  it('checks each step of a sequence', () => {
    const r: ReactionSpec = {
      reactants: [{ coefficient: '', formula: 'CH4', state: '' }, { coefficient: '2', formula: 'O2', state: '' }],
      stages: [
        { arrow: '->', above: '', below: '', products: [{ coefficient: '', formula: 'CO2', state: '' }, { coefficient: '2', formula: 'H2O', state: '' }] },
        { arrow: '->', above: '', below: '', products: [{ coefficient: '', formula: 'CO2', state: '' }] },
      ],
    };
    expect(checkBalance(r).problems[0]).toMatch(/^Step 2/);
  });
  it('gives no verdict on a blank reaction', () => {
    expect(checkBalance(blankReaction()).balanced).toBeNull();
  });
  it('offers the whole periodic table', () => {
    expect(ELEMENTS).toHaveLength(118);
    expect(new Set(ELEMENTS).size).toBe(118);
  });
});

describe('molecule geometry', () => {
  it.each(MOLECULE_TEMPLATES.map((t) => [t.id]))('template %s is a connected, well-formed graph', (id) => {
    const m = tpl(id as string);
    const ids = new Set(m.atoms.map((a) => a.id));
    for (const b of m.bonds) {
      expect(ids.has(b.a) && ids.has(b.b)).toBe(true);
      const a = m.atoms.find((x) => x.id === b.a)!;
      const c = m.atoms.find((x) => x.id === b.b)!;
      expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeGreaterThan(0.9);
      expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeLessThan(1.1);
    }
    const adj = adjacency(m);
    const seen = new Set<string>();
    const go = (x: string) => {
      seen.add(x);
      for (const { to } of adj.get(x)!) if (!seen.has(to)) go(to);
    };
    go(m.atoms[0].id);
    expect(seen.size).toBe(m.atoms.length);
  });
  it('fits the box and centres the drawing', () => {
    const m = tpl('benzene');
    const nat = moleculeNaturalSize(m);
    const p = placeMolecule(m, nat.w * 2, nat.h * 2);
    expect(p.scale).toBeCloseTo(68, 5);
    const b = moleculeBounds(m);
    expect(p.tx((b.minX + b.maxX) / 2)).toBeCloseTo(nat.w, 5);
    expect(p.ty((b.minY + b.maxY) / 2)).toBeCloseTo(nat.h, 5);
  });
  it('finds the ring of a ring bond and none for a chain', () => {
    const benz = tpl('benzene');
    const c = findRingCentreForBond(benz, benz.bonds[0])!;
    expect(Math.hypot(c.x, c.y)).toBeLessThan(0.01);
    expect(findRingCentreForBond(tpl('ethene'), tpl('ethene').bonds[0])).toBeNull();
  });
  it('mirrors atoms and lone pairs', () => {
    const m = tpl('ethanol');
    m.atoms[2].lonePairs = [0];
    const h = mirrorMolecule(m, 'h');
    expect(h.atoms[0].x).toBeCloseTo(m.atoms[2].x, 5);
    expect(h.atoms[2].lonePairs).toEqual([180]);
    const v = mirrorMolecule(m, 'v');
    expect(v.atoms[1].y).toBeGreaterThan(v.atoms[0].y);
    expect(JSON.stringify(mirrorMolecule(mirrorMolecule(m, 'h'), 'h').atoms.map((a) => a.x.toFixed(3)))).toBe(JSON.stringify(m.atoms.map((a) => a.x.toFixed(3))));
  });
  it('rotates about its centre, preserving bond lengths', () => {
    const m = rotateMolecule(tpl('ethene'), 37);
    const a = m.atoms.find((x) => x.id === m.bonds[0].a)!;
    const b = m.atoms.find((x) => x.id === m.bonds[0].b)!;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(1, 3);
  });
  it('picks open space for a substituent', () => {
    const m = fromBlueprint({ atoms: [[0, 0, 'C'], [1, 0, 'C']], bonds: [[0, 1]] });
    expect(freeDirection(m, 'a2')).toBe(300);
    expect(freeDirection(fromBlueprint({ atoms: [[0, 0, 'C']], bonds: [] }), 'a1')).toBe(30);
  });
  it('parses subscripts and superscripts in labels', () => {
    expect(parseAtomLabel('CH_3')).toEqual([{ text: 'CH', shift: 'none' }, { text: '3', shift: 'sub' }]);
    expect(parseAtomLabel('SO_4^{2-}')).toEqual([{ text: 'SO', shift: 'none' }, { text: '4', shift: 'sub' }, { text: '2-', shift: 'sup' }]);
  });
  it('prints a C for an annotated implicit carbon', () => {
    const m = tpl('cyclohexane');
    expect(atomText(m.atoms[0])).toBe('');
    m.atoms[0].charge = 1;
    expect(atomText(m.atoms[0])).toBe('C');
  });
  it('formats charges', () => {
    expect(chargeText(1)).toBe('+');
    expect(chargeText(-2)).toBe('2\u2212');
    expect(chargeText(0)).toBe('');
  });
  it('has the requested functional groups', () => {
    expect(FUNCTIONAL_GROUPS.map((g) => g.label)).toEqual(expect.arrayContaining(['OH', 'NH_2', 'CH_3', 'COOH', 'CHO', 'NO_2']));
  });
});

describe('chemfig output', () => {
  it.each(MOLECULE_TEMPLATES.map((t) => [t.id]))('%s is balanced and names every labelled atom', (id) => {
    const m = tpl(id as string);
    const s = chem(m);
    expect(balanced(s)).toBe(true);
    for (const a of m.atoms) if (a.label) expect(s).toContain(`{${a.label}}`);
  });
  it('writes single, double and triple bonds with absolute angles', () => {
    expect(chem(fromBlueprint({ atoms: [[0, 0, 'A'], [1, 0, 'B']], bonds: [[0, 1]] }))).toBe('{A}-[:0]{B}');
    expect(chem(fromBlueprint({ atoms: [[0, 0, 'A'], [0, -1, 'B']], bonds: [[0, 1, 2]] }))).toBe('{A}=[:90]{B}');
    expect(chem(fromBlueprint({ atoms: [[0, 0, 'A'], [-1, 0, 'B']], bonds: [[0, 1, 3]] }))).toBe('{A}~[:180]{B}');
  });
  it('writes bond lengths when they differ from one', () => {
    expect(chem(fromBlueprint({ atoms: [[0, 0, 'A'], [2, 0, 'B']], bonds: [[0, 1]] }))).toBe('{A}-[:0,2]{B}');
  });
  it('orients stereo bonds whichever way they are walked', () => {
    const fwd = fromBlueprint({ atoms: [[0, 0, 'A'], [1, 0, 'B']], bonds: [[0, 1, 1, 'wedge']] });
    expect(chem(fwd)).toBe('{A}<[:0]{B}');
    const rev = fromBlueprint({ atoms: [[0, 0, 'A'], [1, 0, 'B']], bonds: [[1, 0, 1, 'dash']] });
    expect(chem(rev)).toBe('{A}>:[:0]{B}');
  });
  it('closes rings with one hook pair per ring', () => {
    const s = chem(tpl('cyclohexane'));
    expect(s.match(/\?\[a/g)).toHaveLength(2);
    expect(s.match(/-\[:/g)).toHaveLength(5);
    const fused = fromBlueprint({
      atoms: [[0, 0, ''], [1, 0, ''], [1, 1, ''], [0, 1, ''], [2, 0, ''], [2, 1, '']],
      bonds: [[0, 1], [1, 2], [2, 3], [3, 0], [1, 4], [4, 5], [5, 2]],
    });
    expect(chem(fused).match(/\?\[/g)).toHaveLength(4);
  });
  it('keeps a double-bond ring closure', () => {
    const ring = fromBlueprint({ atoms: [[0, 0, ''], [1, 0, ''], [0.5, 0.87, '']], bonds: [[0, 1], [1, 2], [2, 0, 2]] });
    expect(chem(ring)).toMatch(/\?\[a,\{=[_^]?\}\]/);
  });
  it('puts branches in parentheses', () => {
    const s = chem(tpl('methane'));
    expect(s.match(/\(/g)!.length).toBeGreaterThanOrEqual(3);
  });
  it('writes charges, lone pairs, radicals and colours', () => {
    const m = fromBlueprint({ atoms: [[0, 0, 'O']], bonds: [] });
    Object.assign(m.atoms[0], { charge: -2, lonePairs: [90], radicals: [180], color: '#ff0000' });
    const s = chem(m);
    expect(s).toContain('\\charge{45:1.5pt=$\\scriptstyle 2-$,90=\\:,180=\\.}{O}');
    expect(s).toContain('\\textcolor{red}');
  });
  it('joins separate fragments with an invisible bond', () => {
    const s = chem(fromBlueprint({ atoms: [[0, 0, 'Na'], [3, 0, 'Cl']], bonds: [] }));
    expect(s).toBe('{Na}(-[:0,3,,,draw=none]{Cl})');
  });
  it('draws an aromatic circle inside its ring', () => {
    const s = chem(tpl('benzene-circle'));
    expect(s).toContain('draw=none]{\\tikz{\\draw[draw=black,line width=0.6pt] (0,0) circle');
    expect(balanced(s)).toBe(true);
  });
  it('emits nothing for an empty molecule', () => {
    expect(chem({ type: 'molecule', atoms: [], bonds: [], aromaticRings: [] })).toBe('');
  });
  it('validates atom labels', () => {
    for (const ok of ['', 'C', 'CH_3', 'SO_4^{2-}', 'R', 'NH_2']) expect(validAtomLabel(ok)).toBe(true);
    for (const bad of ['a%b', '\\input', 'x y', 'a;b']) expect(validAtomLabel(bad)).toBe(false);
  });
});
