import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TEMPLATES,
  TEMPLATE_BY_ID,
  TEMPLATE_CATEGORIES,
  buildTemplate,
  estimateNatural,
  groupedTemplates,
  searchTemplates,
  type Measure,
} from '../templates/library';
import { templateGallery } from '../templates/gallery';
import { chemTex, loadEngine, renderTex } from '../science/math/engine';
import { validateTex } from '../science/math/validate';
import { generateLatex } from '../latex/generator';
import { lintLatex } from './latexLint';
import { useEditor } from '../state/store';
import { emptyDiagram } from '../model/defaults';
import { resetIdCounters } from '../model/ids';
import { getShapeDef } from '../model/shapes';
import { routeEdge } from '../model/routing';

/**
 * White-box tests for the template library: every template must build, use
 * only known shapes and ports, typeset, and produce LaTeX that lints clean -
 * the same checks the pdfLaTeX fixtures then prove by compiling.
 */

const measure: Measure = (tex, display) => {
  const r = renderTex(tex, display);
  return r?.ok ? r.natural : null;
};

beforeAll(async () => {
  await loadEngine();
});

describe('template catalogue', () => {
  it('has a healthy number of templates in every category', () => {
    const per = Object.fromEntries(TEMPLATE_CATEGORIES.map((c) => [c.id, TEMPLATES.filter((t) => t.category === c.id).length]));
    expect(per.flow).toBeGreaterThanOrEqual(15);
    expect(per.math).toBeGreaterThanOrEqual(60);
    expect(per.physics).toBeGreaterThanOrEqual(50);
    expect(per.chem).toBeGreaterThanOrEqual(40);
  });

  it('gives every template a unique id, a name and a description', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TEMPLATES) {
      expect(t.name.trim(), t.id).not.toBe('');
      expect(t.description.trim().length, t.id).toBeGreaterThan(8);
      expect(TEMPLATE_BY_ID[t.id]).toBe(t);
    }
  });

  it('covers diagrams, formulas, reactions and molecules', () => {
    const kinds = new Set(TEMPLATES.map((t) => `${t.category}:${t.kind}`));
    for (const k of ['flow:diagram', 'math:math', 'physics:math', 'physics:diagram', 'chem:chem', 'chem:math', 'chem:molecule']) {
      expect(kinds, k).toContain(k);
    }
  });
});

describe('every template builds correctly', () => {
  for (const t of TEMPLATES) {
    it(`${t.id}`, () => {
      const frag = buildTemplate(t, measure, chemTex);
      expect(frag.nodes.length).toBeGreaterThan(0);
      const ids = new Set(frag.nodes.map((n) => n.id));
      expect(ids.size).toBe(frag.nodes.length);
      for (const n of frag.nodes) {
        expect(Number.isFinite(n.x) && Number.isFinite(n.y), `${n.id} position`).toBe(true);
        expect(n.w > 0 && n.h > 0, `${n.id} size`).toBe(true);
        // A known shape kind (getShapeDef falls back for unknown ones).
        expect(getShapeDef(n.kind).id, `${n.id} kind ${n.kind}`).toBe(n.kind);
      }
      const doc = emptyDiagram();
      for (const n of frag.nodes) {
        doc.nodes[n.id] = n;
        doc.order.push(n.id);
      }
      for (const e of frag.edges) {
        expect(ids.has(e.source.nodeId!), `${e.id} source`).toBe(true);
        expect(ids.has(e.target.nodeId!), `${e.id} target`).toBe(true);
        doc.edges[e.id] = e;
        doc.order.push(e.id);
        expect(routeEdge(doc, e), `${e.id} routes`).toBeTruthy();
      }
    });
  }
});

describe('typeset content', () => {
  it('every formula template is allowed and typesets', () => {
    for (const t of TEMPLATES) {
      if (t.kind !== 'math') continue;
      expect(validateTex(t.latex), t.id).toBeNull();
      const r = renderTex(t.latex, true);
      expect(r?.ok, `${t.id}: ${r?.error}`).toBe(true);
    }
  });

  it('every formula inside a diagram template is allowed and typesets', () => {
    for (const t of TEMPLATES) {
      if (t.kind !== 'diagram') continue;
      for (const n of buildTemplate(t, measure).nodes) {
        if (n.science?.type !== 'math') continue;
        expect(validateTex(n.science.latex), t.id).toBeNull();
        expect(renderTex(n.science.latex, true)?.ok, `${t.id}: ${n.science.latex}`).toBe(true);
      }
    }
  });

  it('every reaction template is read by mhchem', () => {
    for (const t of TEMPLATES) {
      if (t.kind !== 'chem') continue;
      const r = renderTex(chemTex(t.source), true);
      expect(r?.ok, `${t.id}: ${r?.error}`).toBe(true);
    }
  });

  it('sizes formulas from the typesetter, and estimates sensibly without it', () => {
    const t = TEMPLATE_BY_ID['math-quadratic'];
    const real = buildTemplate(t, measure).nodes[0];
    const rough = buildTemplate(t).nodes[0];
    expect(real.w).toBeGreaterThan(40);
    expect(rough.w).toBeGreaterThan(40);
    expect(Math.abs(real.w - rough.w) / real.w).toBeLessThan(1.5);
    const est = estimateNatural('\\frac{a}{b}');
    expect(est.h).toBeGreaterThan(1.5);
  });
});

describe('generated LaTeX', () => {
  for (const c of TEMPLATE_CATEGORIES) {
    it(`${c.label} templates lint clean, standalone and snippet`, () => {
      const d = templateGallery(c.id, measure);
      for (const mode of ['standalone', 'snippet'] as const) {
        const out = generateLatex(d, { mode, comments: true });
        expect(out.issues.map((i) => `${i.severity}: ${i.message}`), `${c.id} ${mode}`).toEqual([]);
        const lint = lintLatex(out.code, { standalone: mode === 'standalone' });
        expect(lint.problems, `${c.id} ${mode}`).toEqual([]);
      }
    });
  }

  it('emits a real CircuiTikZ, mhchem and chemfig preamble where needed', () => {
    const phys = generateLatex(templateGallery('physics', measure), { mode: 'standalone', comments: false }).code;
    expect(phys).toContain('circuitikz');
    const chem = generateLatex(templateGallery('chem', measure), { mode: 'standalone', comments: false }).code;
    expect(chem).toContain('mhchem');
    expect(chem).toContain('chemfig');
  });
});

describe('search', () => {
  it('finds templates by name, keyword, group or formula text', () => {
    expect(searchTemplates('quadratic').map((t) => t.id)).toContain('math-quadratic');
    expect(searchTemplates('ohm').map((t) => t.id)).toContain('phys-ohm');
    expect(searchTemplates('photosynthesis').map((t) => t.id)).toContain('chem-photosynthesis');
    expect(searchTemplates('loop').some((t) => t.category === 'flow')).toBe(true);
    expect(searchTemplates('Calculus').length).toBeGreaterThan(5);
    expect(searchTemplates('\\sqrt').length).toBeGreaterThan(3);
  });

  it('matches all words, in any order and case', () => {
    expect(searchTemplates('LAW snell').map((t) => t.id)).toEqual(['phys-snell']);
    expect(searchTemplates('zzzz-not-a-template')).toEqual([]);
  });

  it('groups results under their sub-headings', () => {
    const groups = groupedTemplates('math');
    expect(groups.map((g) => g.group)).toEqual(
      expect.arrayContaining(['Algebra', 'Calculus', 'Trigonometry', 'Geometry', 'Statistics & probability', 'Linear algebra']),
    );
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });
});

describe('inserting a template', () => {
  beforeEach(() => {
    resetIdCounters();
    useEditor.setState({ doc: emptyDiagram(), selection: [], past: [], future: [], snapshot: null, dirty: false });
  });

  it('adds the objects with fresh ids, centred, selected, as one undo step', () => {
    const s = useEditor.getState();
    const frag = buildTemplate(TEMPLATE_BY_ID['flow-if-else'], measure);
    const ids = s.insertFragment(frag, { x: 500, y: 400 });
    const st = useEditor.getState();
    expect(ids.length).toBe(frag.nodes.length + frag.edges.length);
    expect(st.selection).toEqual(ids);
    expect(st.past.length).toBe(1);
    const nodes = Object.values(st.doc.nodes);
    const minX = Math.min(...nodes.map((n) => n.x));
    const maxX = Math.max(...nodes.map((n) => n.x + n.w));
    const minY = Math.min(...nodes.map((n) => n.y));
    const maxY = Math.max(...nodes.map((n) => n.y + n.h));
    expect(Math.abs((minX + maxX) / 2 - 500)).toBeLessThanOrEqual(1);
    expect(Math.abs((minY + maxY) / 2 - 400)).toBeLessThanOrEqual(1);
    // Connectors are re-pointed at the new shapes.
    for (const e of Object.values(st.doc.edges)) {
      expect(st.doc.nodes[e.source.nodeId!]).toBeTruthy();
      expect(st.doc.nodes[e.target.nodeId!]).toBeTruthy();
    }
    st.undo();
    expect(Object.keys(useEditor.getState().doc.nodes)).toEqual([]);
    useEditor.getState().redo();
    expect(Object.keys(useEditor.getState().doc.nodes).length).toBe(frag.nodes.length);
  });

  it('can insert the same template twice without id clashes', () => {
    const frag = buildTemplate(TEMPLATE_BY_ID['phys-rc'], measure);
    const a = useEditor.getState().insertFragment(frag, { x: 0, y: 0 });
    const b = useEditor.getState().insertFragment(frag, { x: 600, y: 0 });
    expect(new Set([...a, ...b]).size).toBe(a.length + b.length);
    const st = useEditor.getState();
    expect(Object.keys(st.doc.nodes).length).toBe(frag.nodes.length * 2);
    expect(st.past.length).toBe(2);
  });

  it('leaves the source template untouched', () => {
    const frag = buildTemplate(TEMPLATE_BY_ID['flow-linear'], measure);
    const before = JSON.stringify(frag);
    useEditor.getState().insertFragment(frag, { x: 100, y: 100 });
    expect(JSON.stringify(frag)).toBe(before);
  });

  it('ignores an empty fragment', () => {
    expect(useEditor.getState().insertFragment({ nodes: [], edges: [] }, { x: 0, y: 0 })).toEqual([]);
    expect(useEditor.getState().past.length).toBe(0);
  });
});

describe('placing a template', () => {
  it('uses the middle of the view on an empty canvas', async () => {
    const { freeSpot } = await import('../templates/placement');
    const frag = buildTemplate(TEMPLATE_BY_ID['flow-if-else']);
    expect(freeSpot(frag, { x: 300, y: 200 }, emptyDiagram())).toEqual({ x: 300, y: 200 });
  });

  it('never lands on top of existing objects (shapes, rotated parts or wires)', async () => {
    const { freeSpot, coveredBoxes } = await import('../templates/placement');
    resetIdCounters();
    useEditor.setState({ doc: emptyDiagram(), selection: [], past: [], future: [] });
    const centre = { x: 400, y: 300 };
    const ids = ['flow-binary-search', 'phys-series-circuit', 'math-quadratic', 'chem-photosynthesis', 'flow-if-else', 'chem-mol-benzene', 'phys-free-body', 'flow-while'];
    const placed: string[][] = [];
    for (const id of ids) {
      const frag = buildTemplate(TEMPLATE_BY_ID[id], measure, chemTex);
      placed.push(useEditor.getState().insertFragment(frag, freeSpot(frag, centre, useEditor.getState().doc)));
    }
    const doc = useEditor.getState().doc;
    const boxes = placed.map((group) => {
      const bs = coveredBoxes(doc, group);
      const x = Math.min(...bs.map((b) => b.x));
      const y = Math.min(...bs.map((b) => b.y));
      return { x, y, r: Math.max(...bs.map((b) => b.x + b.w)), b: Math.max(...bs.map((b) => b.y + b.h)) };
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const hit = a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
        expect(hit, `${ids[i]} overlaps ${ids[j]}`).toBe(false);
      }
    }
  });
});

