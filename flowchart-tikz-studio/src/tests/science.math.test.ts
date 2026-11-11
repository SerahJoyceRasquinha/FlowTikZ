import { beforeAll, describe, expect, it } from 'vitest';
import { loadEngine, renderTex, chemTex, isEngineReady } from '../science/math/engine';
import { unicodeToTex, validateTex, normalizeChemSource } from '../science/math/validate';
import {
  MStruct,
  MRow,
  STRUCT_TEMPLATES,
  colorTemplate,
  countEmptySlots,
  deleteBefore,
  editable,
  insertStructure,
  insertSymbol,
  makeMatrix,
  parseTex,
  resizeTable,
  rowAt,
  rowToTex,
  setText,
  slotLabels,
} from '../science/math/ast';
import { CHEMISTRY_TOKENS, MATH_CATEGORIES, PHYSICS_CATEGORIES, searchSymbols } from '../science/math/symbols';
import { CHEM_SAMPLES, MATH_SAMPLES } from '../science/gallery';

beforeAll(async () => {
  await loadEngine();
});

/** Two TeX strings typeset to exactly the same picture. */
function sameRender(a: string, b: string) {
  const ra = renderTex(a);
  const rb = renderTex(b);
  expect(ra?.ok, `${a}: ${ra?.error}`).toBe(true);
  expect(rb?.ok, `${b}: ${rb?.error}`).toBe(true);
  expect(rb?.markup).toBe(ra?.markup);
}

describe('typesetting engine', () => {
  it('is loaded on demand and reports readiness', () => {
    expect(isEngineReady()).toBe(true);
  });
  it.each(MATH_SAMPLES)('typesets %s', (tex) => {
    const r = renderTex(tex);
    expect(r?.ok, r?.error).toBe(true);
    expect(r?.markup).toContain('<path');
    expect(r!.natural.w).toBeGreaterThan(0);
  });
  it.each(CHEM_SAMPLES)('typesets chemistry %s', (s) => {
    const r = renderTex(chemTex(s));
    expect(r?.ok, r?.error).toBe(true);
  });
  it('keeps a whole inline formula in one picture', () => {
    const r = renderTex('1\\,\\mathrm{k\\Omega}', false)!;
    expect(r.natural.w).toBeGreaterThan(1.4);
  });
  it('wide formulas are not wrapped', () => {
    const long = Array.from({ length: 80 }, (_, i) => `x_{${i}}`).join('+');
    expect(renderTex(long)!.natural.h).toBeLessThan(3);
  });
  it('reports TeX errors instead of drawing them', () => {
    for (const bad of ['\\frac{a', '\\notamacro', 'x^^', '\\begin{pmatrix}a']) {
      expect(renderTex(bad)?.ok, bad).toBe(false);
      expect(renderTex(bad)?.error).toBeTruthy();
    }
  });
  it('emits no links and no assistive-only attributes', () => {
    const r = renderTex('x+y')!;
    expect(r.markup).not.toMatch(/data-|aria-|<a[\s>]/);
  });
  it('caches identical requests', () => {
    expect(renderTex('q+r')).toBe(renderTex('q+r'));
  });
  it('distinguishes inline from display', () => {
    expect(renderTex('\\sum_{i}i', true)!.natural.h).toBeGreaterThan(renderTex('\\sum_{i}i', false)!.natural.h);
  });
  it('colours through currentColor so one formula can take any node colour', () => {
    expect(renderTex('x')!.markup).toContain('currentColor');
  });
});

describe('TeX validation', () => {
  it('accepts well-formed input', () => {
    expect(validateTex('\\frac{a}{b}\\left( x \\right)\\begin{matrix}a\\end{matrix}')).toBeNull();
    expect(validateTex('a\\%b')).toBeNull();
    expect(validateTex('\\{ x \\}')).toBeNull();
  });
  it.each([
    ['{', /never closed/],
    ['}', /no matching/],
    ['a%b', /comment/],
    ['\\left( x', /pair up/],
    ['\\begin{a}x\\end{b}', /does not match/],
    ['\\begin{a}x', /never closed/],
    ['\\input{x}', /not allowed/],
    ['\\write18{rm}', /not allowed/],
    ['\\immediate', /not allowed/],
    ['\\def\\a{b}', /not allowed/],
    ['\\href{http://x}{y}', /not allowed/],
    ['\\usepackage{x}', /not allowed/],
    ['\\catcode', /not allowed/],
    ['α', /not available/],
  ])('rejects %s', (tex, why) => {
    expect(validateTex(tex)).toMatch(why);
  });
  it('allows accented Latin letters', () => {
    expect(validateTex('\\text{é}')).toBeNull();
  });
  it('maps typed Unicode to macros', () => {
    expect(unicodeToTex('α+β≤∞')).toBe('\\alpha +\\beta \\leq \\infty ');
    expect(unicodeToTex('5Ω')).toBe('5\\Omega ');
    expect(unicodeToTex('5\u2126')).toBe('5\\Omega ');
    expect(validateTex(unicodeToTex('×÷±∫∑∇∂'))).toBeNull();
  });
  it('turns a typed degree into mhchem-safe text', () => {
    expect(normalizeChemSource('450 °C')).toBe('450 $^\\circ$C');
  });
});

describe('parsing and generating LaTeX', () => {
  it.each(MATH_SAMPLES)('round-trips %s to the same picture', (tex) => {
    sameRender(tex, rowToTex(parseTex(tex)));
  });
  it('recognises the modelled structures', () => {
    const types = (tex: string) => parseTex(tex).filter((n) => n.t === 'struct').map((n) => (n as MStruct).type);
    expect(types('\\frac{a}{b}')).toEqual(['frac']);
    expect(types('x^{2}')).toEqual(['sup']);
    expect(types('x_{1}')).toEqual(['sub']);
    expect(types('x_{1}^{2}')).toEqual(['subsup']);
    expect(types('x^{2}_{1}')).toEqual(['subsup']);
    expect(types('\\sqrt{x}')).toEqual(['sqrt']);
    expect(types('\\sqrt[3]{x}')).toEqual(['nroot']);
    expect(types('\\left( x \\right)')).toEqual(['group']);
    expect(types('\\int_{a}^{b}')).toEqual(['bigop']);
    expect(types('\\lim_{x\\to 0}')).toEqual(['lim']);
    expect(types('\\vec{v}')).toEqual(['accent']);
    expect(types('\\mathbf{v}')).toEqual(['font']);
    expect(types('\\begin{bmatrix}1\\end{bmatrix}')).toEqual(['matrix']);
    expect(types('\\begin{cases}a&b\\end{cases}')).toEqual(['cases']);
    expect(types('\\begin{aligned}a&=b\\end{aligned}')).toEqual(['aligned']);
    expect(types('\\text{hi}')).toEqual(['text']);
    expect(types('\\textcolor{red}{x}')).toEqual(['color']);
    expect(types('\\overset{a}{b}')).toEqual(['overset']);
  });
  it('nests', () => {
    const frac = parseTex('\\frac{\\frac{1}{x}}{\\sqrt{\\frac{a}{b}}}').find((n) => n.t === 'struct') as MStruct;
    const inner = frac.slots[1].find((n) => n.t === 'struct') as MStruct;
    expect(inner.type).toBe('sqrt');
    expect((inner.slots[0].find((n) => n.t === 'struct') as MStruct).type).toBe('frac');
  });
  it('binds a script to the last token only, as TeX does', () => {
    // `2` and `{2}` differ only in an invisible wrapper, so compare the box.
    for (const tex of ['12^3', '\\alpha^2', '(x)^2', '{xy}^2', '{}^{14}C']) {
      expect(renderTex(rowToTex(parseTex(tex)))?.viewBox, tex).toEqual(renderTex(tex)?.viewBox);
    }
  });
  it('keeps macros it does not model, verbatim', () => {
    expect(rowToTex(parseTex('\\Longrightarrow x'))).toBe('\\Longrightarrow x');
    expect(rowToTex(parseTex('\\begin{array}{c}a\\end{array}'))).toContain('\\begin');
  });
  it('tolerates broken input without throwing', () => {
    for (const bad of ['\\frac{', '}', '\\left(', '\\begin{pmatrix}', '^', '_', '\\', '\\sqrt[']) {
      expect(() => rowToTex(parseTex(bad))).not.toThrow();
    }
  });
  it('separates a macro from a following letter', () => {
    const row = editable([{ t: 'sym', tex: '\\alpha', glyph: 'α' }, { t: 'text', v: 'x' }]);
    expect(rowToTex(row)).toBe('\\alpha x');
    sameRender('\\alpha x', rowToTex(row));
  });
});

describe('every button in the libraries', () => {
  const all = [...MATH_CATEGORIES, ...PHYSICS_CATEGORIES].flatMap((c) => c.symbols);
  it('has a healthy number of symbols', () => {
    expect(all.length).toBeGreaterThan(200);
  });
  it.each(all.map((s) => [s.name, s.tex === '^\\circ' ? '90^\\circ' : s.tex]))('%s typesets', (_n, tex) => {
    const r = renderTex(tex as string);
    expect(r?.ok, `${tex}: ${r?.error}`).toBe(true);
  });
  it.each(STRUCT_TEMPLATES.map((t) => [t.id, t]))('structure %s produces valid LaTeX', (_id, t) => {
    const st = (t as (typeof STRUCT_TEMPLATES)[number]).make();
    const filled: MRow = editable([JSON.parse(JSON.stringify(st))]);
    (filled.find((n) => n.t === 'struct') as MStruct).slots.forEach((s) => {
      (s[0] as { v: string }).v = 'x';
    });
    const tex = rowToTex(filled);
    const r = renderTex(tex);
    expect(r?.ok, `${tex}: ${r?.error}`).toBe(true);
    expect(countEmptySlots(filled)).toBe(0);
    // A placeholder preview of the untouched template must also typeset.
    const preview = rowToTex(editable([st]), { placeholders: true });
    expect(renderTex(preview)?.ok, preview).toBe(true);
  });
  it('labels every slot', () => {
    for (const t of STRUCT_TEMPLATES) {
      const st = t.make();
      expect(slotLabels(st).length, t.id).toBe(st.slots.length);
    }
  });
  it.each(CHEMISTRY_TOKENS.flatMap((c) => c.symbols.map((s) => [c.id, s.tex])))('%s token %s works in mhchem', (cat, tex) => {
    const src = cat === 'compounds' || cat === 'states' ? (tex as string) : cat === 'notation' ? `Fe${tex}` : `A${tex}B`;
    expect(renderTex(chemTex(src))?.ok, src).toBe(true);
  });
  it('finds symbols by name, keyword, macro and glyph', () => {
    expect(searchSymbols(MATH_CATEGORIES, 'integral').map((s) => s.tex)).toContain('\\int');
    expect(searchSymbols(MATH_CATEGORIES, 'union').map((s) => s.tex)).toContain('\\cup');
    expect(searchSymbols(MATH_CATEGORIES, '\\alpha').map((s) => s.tex)).toContain('\\alpha');
    expect(searchSymbols(MATH_CATEGORIES, 'α').map((s) => s.tex)).toContain('\\alpha');
    expect(searchSymbols(PHYSICS_CATEGORIES, 'planck').length).toBeGreaterThan(0);
    expect(searchSymbols(MATH_CATEGORIES, '')).toEqual([]);
    expect(searchSymbols(MATH_CATEGORIES, 'zzzzz')).toEqual([]);
  });
  it('covers the requested notation', () => {
    const texes = new Set(all.map((s) => s.tex));
    for (const need of ['+', '-', '\\times', '\\div', '=', '\\neq', '\\alpha', '\\beta', '\\gamma', '\\theta', '\\lambda', '\\pi', '\\Omega', '\\int', '\\oint', '\\partial', '\\nabla', '\\sum', '\\prod', '\\in', '\\notin', '\\subset', '\\subseteq', '\\cup', '\\cap', '\\emptyset', '\\forall', '\\exists', '\\land', '\\lor', '\\neg', '\\Rightarrow', '\\Leftrightarrow', '\\leq', '\\geq', '\\approx', '\\equiv', '\\propto', '\\angle', '\\perp', '\\parallel', '^\\circ']) {
      expect(texes.has(need), need).toBe(true);
    }
  });
});

describe('editing operations', () => {
  const caret = (node = 0, offset = 0) => ({ path: [] as number[], node, offset });
  const tpl = (id: string) => STRUCT_TEMPLATES.find((t) => t.id === id)!.make();

  it('builds separate numerator and denominator', () => {
    const r = insertStructure([{ t: 'text', v: '' }], caret(), tpl('frac'));
    let root = editable(r.root);
    expect(r.caret.path).toEqual([1, 0]);
    root = setText(root, [1, 0], 0, 'a');
    root = setText(root, [1, 1], 0, 'b');
    expect(rowToTex(root)).toBe('\\frac{a}{b}');
  });
  it('takes the base for a superscript from before the caret', () => {
    const r = insertStructure([{ t: 'text', v: 'ax' }], caret(0, 2), tpl('sup'));
    const root = setText(editable(r.root), r.caret.path, r.caret.node, '2');
    expect(rowToTex(root)).toBe('ax^{2}');
  });
  it('takes a whole structure as the base', () => {
    const start = editable(parseTex('\\left( x \\right)'));
    const r = insertStructure(start, { path: [], node: start.length - 1, offset: 0 }, tpl('sup'));
    const root = setText(editable(r.root), r.caret.path, r.caret.node, '2');
    expect(rowToTex(root)).toBe('\\left( x \\right)^{2}');
  });
  it('asks for a base when there is none', () => {
    const r = insertStructure([{ t: 'text', v: '' }], caret(), tpl('sup'));
    expect(r.caret.path).toEqual([1, 0]);
  });
  it('wraps a selection', () => {
    const r = insertStructure([{ t: 'text', v: 'abc' }], { ...caret(0, 1), end: 2 }, tpl('sqrt'));
    expect(rowToTex(editable(r.root))).toBe('a\\sqrt{b}c');
  });
  it('wraps a selection into the radicand of an n-th root', () => {
    const r = insertStructure([{ t: 'text', v: 'b' }], { ...caret(0, 0), end: 1 }, tpl('nroot'));
    const st = r.root.find((n) => n.t === 'struct') as MStruct;
    expect(rowToTex(st.slots[1])).toBe('b');
  });
  it('inserts nested structures into the focused box', () => {
    const a = insertStructure([{ t: 'text', v: '' }], caret(), tpl('frac'));
    const b = insertStructure(editable(a.root), a.caret, tpl('sqrt'));
    expect(rowAt(b.root, [1, 0]).some((n) => n.t === 'struct')).toBe(true);
    expect(b.caret.path).toEqual([1, 0, 1, 0]);
  });
  it('inserts symbols at the caret', () => {
    const r = insertSymbol([{ t: 'text', v: 'ab' }], caret(0, 1), '\\pi', 'π');
    expect(rowToTex(r.root)).toBe('a\\pi b');
    expect(r.caret.node).toBe(2);
  });
  it('removes the item before the caret and joins the text', () => {
    const r = deleteBefore(editable(parseTex('a\\alpha b')), { path: [], node: 2, offset: 0 });
    expect(rowToTex(r!.root)).toBe('ab');
    expect(r!.caret.offset).toBe(1);
  });
  it('has nothing to delete at the start of a row', () => {
    expect(deleteBefore([{ t: 'text', v: 'a' }], caret())).toBeNull();
  });
  it('counts required empty boxes, ignoring optional limits', () => {
    expect(countEmptySlots(editable([tpl('frac')]))).toBe(2);
    expect(countEmptySlots(editable([tpl('op-sum')]))).toBe(0);
    const nested = insertStructure(editable([tpl('frac')]), { path: [0 + 1, 0], node: 0, offset: 0 }, tpl('sqrt'));
    expect(countEmptySlots(nested.root)).toBe(2);
  });
  it('grows and shrinks tables, preserving cells', () => {
    let root: MRow = editable([makeMatrix('pmatrix', 2, 2)]);
    root = setText(root, [1, 0], 0, 'a');
    root = setText(root, [1, 3], 0, 'd');
    root = resizeTable(root, [], 1, 1, 1);
    let st = root[1] as MStruct;
    expect([st.rows, st.cols, st.slots.length]).toEqual([3, 3, 9]);
    expect(rowToTex(st.slots[4])).toBe('d');
    root = resizeTable(root, [], 1, -2, -2);
    st = root[1] as MStruct;
    expect([st.rows, st.cols]).toEqual([1, 1]);
    root = resizeTable(root, [], 1, -5, -5);
    expect((root[1] as MStruct).rows).toBe(1);
  });
  it('colours through an RGB model both engines accept', () => {
    const st = colorTemplate('#dc2626');
    (st.slots[0][0] as { v: string }).v = 'x';
    const tex = rowToTex([st]);
    expect(tex).toBe('\\textcolor[RGB]{220,38,38}{x}');
    expect(renderTex(tex)?.ok).toBe(true);
  });
  it('does not mutate its input', () => {
    const before: MRow = [{ t: 'text', v: 'x' }];
    const snapshot = JSON.stringify(before);
    insertStructure(before, caret(0, 1), tpl('frac'));
    insertSymbol(before, caret(0, 1), '\\pi', 'π');
    setText(before, [], 0, 'y');
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
