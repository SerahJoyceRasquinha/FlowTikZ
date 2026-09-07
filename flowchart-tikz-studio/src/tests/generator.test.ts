import { describe, expect, it } from 'vitest';
import { generateLatex } from '../latex/generator';
import { emptyDiagram, makeEdge, makeNode } from '../model/defaults';
import { SHAPE_LIST } from '../model/shapes';
import { sampleDiagram } from '../model/sample';
import { normalizeOrder, removeObjects } from '../model/diagram';
import { lintLatex } from './latexLint';
import type { Diagram, Node } from '../model/types';

function withNode(overrides: Partial<Node> = {}, kind = 'process'): Diagram {
  const d = emptyDiagram('Test');
  const n = makeNode(kind, 100, 100, { id: 'n1', ...overrides });
  d.nodes.n1 = n;
  d.order = ['n1'];
  normalizeOrder(d);
  return d;
}

const gen = (d: Diagram, mode: 'standalone' | 'snippet' = 'standalone') =>
  generateLatex(d, { mode, comments: true });

describe('document structure', () => {
  it('produces a compilable skeleton for an empty diagram', () => {
    const r = gen(emptyDiagram());
    expect(r.code).toContain('\\documentclass[border=8pt]{standalone}');
    expect(r.code).toContain('\\begin{tikzpicture}');
    expect(r.code).toContain('\\end{tikzpicture}');
    expect(r.code).toContain('\\end{document}');
    expect(lintLatex(r.code, { standalone: true }).problems).toEqual([]);
  });

  it('omits the document class in snippet mode but lists the packages', () => {
    const r = gen(sampleDiagram(), 'snippet');
    expect(r.code).not.toContain('\\documentclass');
    expect(r.code).toContain('%   \\usepackage{tikz}');
    expect(r.code).toContain('\\begin{tikzpicture}');
    expect(lintLatex(r.code, { standalone: false }).problems).toEqual([]);
  });

  it('separates nodes from connectors', () => {
    const r = gen(sampleDiagram());
    expect(r.code.indexOf('% ---- Nodes ----')).toBeGreaterThan(-1);
    expect(r.code.indexOf('% ---- Connectors ----')).toBeGreaterThan(
      r.code.indexOf('% ---- Nodes ----'),
    );
  });

  it('can suppress comments without breaking the output', () => {
    const r = generateLatex(sampleDiagram(), { mode: 'standalone', comments: false });
    expect(r.code).not.toContain('% ---- Nodes ----');
    expect(lintLatex(r.code, { standalone: true }).problems).toEqual([]);
  });

  it('indents the picture body rather than emitting one long line', () => {
    const r = gen(sampleDiagram());
    const body = r.code.split('\\begin{tikzpicture}')[1];
    expect(body.split('\n').length).toBeGreaterThan(20);
    expect(body).toMatch(/\n {2}\\/);
  });
});

describe('statement formatting', () => {
  it('wraps long option lists instead of emitting one enormous line', () => {
    const code = gen(sampleDiagram()).code;
    for (const line of code.split('\n')) {
      expect(line.length, line).toBeLessThanOrEqual(96);
    }
    expect(code).toMatch(/\n {8}\S/); // continuation lines are indented
  });

  it('closes every wrapped statement exactly once, with its tail intact', () => {
    // Regression: a statement whose options collapsed into a single wrapped
    // chunk used to lose its closing bracket and body.
    const d = emptyDiagram();
    d.nodes.n1 = makeNode('process', 100, 100, { id: 'n1' });
    d.nodes.n2 = makeNode('process', 100, 400, { id: 'n2' });
    d.edges.e1 = makeEdge({
      id: 'e1',
      source: { nodeId: 'n1', port: 's' },
      target: { nodeId: 'n2', port: 'n' },
      label: {
        text: '> 50%',
        pos: 0.5,
        offset: 0,
        fontSize: 12,
        color: '#000000',
        background: false,
      },
    });
    d.order = ['n1', 'n2', 'e1'];
    normalizeOrder(d);

    const code = gen(d).code;
    expect(code).toContain('\\textgreater{} 50\\%');
    expect(code).toContain('(e1label) at');
    expect(lintLatex(code, { standalone: true }).problems).toEqual([]);
  });

  it('keeps statements well formed at every option-list length', () => {
    // Sweep label lengths so the wrap boundary is crossed in both directions.
    for (let len = 1; len < 60; len++) {
      const d = emptyDiagram();
      d.nodes.n1 = makeNode('process', 0, 0, { id: 'n1', text: 'x'.repeat(len) });
      d.nodes.n2 = makeNode('decision', 0, 300, { id: 'n2' });
      d.edges.e1 = makeEdge({
        id: 'e1',
        source: { nodeId: 'n1', port: 's' },
        target: { nodeId: 'n2', port: 'n' },
        label: {
          text: 'y'.repeat(len),
          pos: 0.5,
          offset: 0,
          fontSize: 12,
          color: '#123456',
          background: true,
        },
      });
      d.order = ['n1', 'n2', 'e1'];
      normalizeOrder(d);
      const code = gen(d).code;
      expect(lintLatex(code, { standalone: true }).problems, `len=${len}`).toEqual([]);
      expect(code, `len=${len}`).toContain('x'.repeat(len));
      expect(code, `len=${len}`).toContain('y'.repeat(len));
    }
  });
});

describe('node emission', () => {
  it('emits every registered shape without lint problems', () => {
    for (const def of SHAPE_LIST) {
      const d = withNode({ text: 'Label' }, def.id);
      const r = gen(d);
      const lint = lintLatex(r.code, { standalone: true });
      expect(lint.problems, def.id).toEqual([]);
      expect(r.issues.filter((i) => i.severity === 'error'), def.id).toEqual([]);
    }
  });

  it('uses a built-in TikZ shape where one matches exactly', () => {
    expect(gen(withNode({}, 'decision')).code).toContain('shape=diamond');
    expect(gen(withNode({}, 'process')).code).toContain('shape=rectangle');
    expect(gen(withNode({ w: 60, h: 60 }, 'connector')).code).toContain('shape=circle');
    expect(gen(withNode({}, 'ellipse')).code).toContain('shape=ellipse');
  });

  it('falls back to an explicit path for symbols TikZ has no shape for', () => {
    const code = gen(withNode({}, 'document')).code;
    expect(code).toContain('\\draw[fcpath');
    expect(code).toContain('.. controls');
  });

  it('draws a circle node as an ellipse when it is not square', () => {
    const code = gen(withNode({ w: 90, h: 40 }, 'connector')).code;
    expect(code).not.toContain('shape=circle');
    expect(code).toContain('\\draw[fcpath');
  });

  it('converts position and size at the configured scale', () => {
    const d = withNode({ x: 100, y: 100, w: 100, h: 50 });
    d.settings.unitsPerCm = 50;
    const code = gen(d).code;
    expect(code).toContain('minimum width=2cm');
    expect(code).toContain('minimum height=1cm');
  });

  it('doubles the printed size when the scale is halved', () => {
    const d = withNode({ w: 100, h: 50 });
    d.settings.unitsPerCm = 25;
    expect(gen(d).code).toContain('minimum width=4cm');
  });

  it('negates rotation so the compiled figure turns the same way', () => {
    expect(gen(withNode({ rotation: 30 })).code).toContain('rotate=-30');
  });

  it('wraps rotated path shapes in a scope about their centre', () => {
    const code = gen(withNode({ rotation: 45 }, 'document')).code;
    expect(code).toContain('\\begin{scope}[rotate around={-45:');
    expect(code).toContain('\\end{scope}');
  });

  it('carries the shape text through, escaped', () => {
    const code = gen(withNode({ text: 'Cost > 50% & rising' })).code;
    expect(code).toContain('Cost \\textgreater{} 50\\% \\& rising');
  });

  it('emits multi-line text as TeX line breaks', () => {
    expect(gen(withNode({ text: 'line one\nline two' })).code).toContain(
      'line one \\\\ line two',
    );
  });

  it('omits the body for shapes with no text', () => {
    expect(gen(withNode({ text: '' })).code).toMatch(/\(n1\) at \([^)]*\) \{\};/);
  });

  it('emits fill, border and line width', () => {
    const d = withNode({
      style: {
        ...makeNode('process', 0, 0).style,
        fill: '#3366cc',
        stroke: '#112233',
        strokeWidth: 3,
      },
    });
    const code = gen(d).code;
    expect(code).toContain('\\definecolor{fc3366CC}{HTML}{3366CC}');
    expect(code).toContain('fill=fc3366CC');
    expect(code).toContain('draw=fc112233');
    expect(code).toContain('line width=1.707pt');
  });

  it('emits opacity only when it is not fully opaque', () => {
    expect(gen(withNode()).code).not.toContain('fill opacity');
    const faded = withNode({
      style: { ...makeNode('process', 0, 0).style, fillOpacity: 0.4, opacity: 0.8 },
    });
    const code = gen(faded).code;
    expect(code).toContain('fill opacity=0.4');
    expect(code).toContain('opacity=0.8');
  });

  it('translates each shading mode to the right TikZ spelling', () => {
    const base = makeNode('process', 0, 0).style;
    const cases = [
      ['axis-vertical', 'top color='],
      ['axis-horizontal', 'left color='],
      ['radial', 'inner color='],
    ] as const;
    for (const [shading, expected] of cases) {
      const d = withNode({ style: { ...base, shading, shadingColor: '#ff8800' } });
      expect(gen(d).code, shading).toContain(expected);
      expect(gen(d).code, shading).toContain('fc FF8800'.replace(' ', ''));
    }
  });

  it('loads the shadows library only when a shadow is used', () => {
    expect(gen(withNode()).code).not.toContain('shadows');
    const d = withNode({ style: { ...makeNode('process', 0, 0).style, shadow: true } });
    const code = gen(d).code;
    expect(code).toContain('drop shadow');
    expect(code).toContain('usetikzlibrary');
    expect(code).toMatch(/usetikzlibrary\{[^}]*shadows/);
  });

  it('emits a dash pattern for each border style', () => {
    const base = makeNode('process', 0, 0).style;
    expect(gen(withNode({ style: { ...base, strokeStyle: 'dashed' } })).code).toContain(
      'dash pattern=on',
    );
    expect(gen(withNode({ style: { ...base, strokeStyle: 'dotted' } })).code).toContain(
      'line cap=round',
    );
    expect(gen(withNode({ style: { ...base, strokeStyle: 'none' } })).code).toContain(
      'draw=none',
    );
  });

  it('emits a corner radius only for shapes that support it', () => {
    const base = makeNode('process', 0, 0).style;
    expect(
      gen(withNode({ style: { ...base, cornerRadius: 10 } })).code,
    ).toContain('rounded corners=0.2cm');
    expect(
      gen(withNode({ style: { ...base, cornerRadius: 10 } }, 'decision')).code,
    ).not.toContain('rounded corners');
  });

  it('converts font size proportionally and sets the family', () => {
    const d = withNode({
      text: 'x',
      textStyle: { ...makeNode('process', 0, 0).textStyle, fontSize: 25, fontFamily: 'mono' },
    });
    const code = gen(d).code;
    expect(code).toContain('\\fontsize{14.23pt}');
    expect(code).toContain('\\ttfamily');
  });

  it('applies bold, italic and underline as text commands', () => {
    const d = withNode({
      text: 'x',
      textStyle: {
        ...makeNode('process', 0, 0).textStyle,
        bold: true,
        italic: true,
        underline: true,
      },
    });
    expect(gen(d).code).toContain('\\underline{\\textit{\\textbf{x}}}');
  });

  it('splits the label into its own node when text is not vertically centred', () => {
    const d = withNode({
      text: 'Top',
      textStyle: { ...makeNode('process', 0, 0).textStyle, valign: 'top' },
    });
    const code = gen(d).code;
    expect(code).toContain('anchor=north');
    expect((code.match(/\\node\[/g) ?? []).length).toBe(2);
  });

  it('renders a text label with no draw or fill', () => {
    const code = gen(withNode({ text: 'Note' }, 'text')).code;
    expect(code).toContain('fclabel');
    expect(code).not.toContain('\\draw');
  });

  it('never fills an open bracket shape', () => {
    const code = gen(withNode({ text: 'aside' }, 'annotation')).code;
    const drawLine = code.split('\n').find((l) => l.includes('\\draw[fcpath'))!;
    expect(drawLine).not.toContain('fill=');
  });

  it('gives every path shape a named coordinate for later reference', () => {
    expect(gen(withNode({}, 'document')).code).toContain('\\coordinate (n1) at');
  });
});

describe('connector emission', () => {
  function twoNodes(edgeOverrides = {}): Diagram {
    const d = emptyDiagram('Edges');
    d.nodes.n1 = makeNode('process', 100, 100, { id: 'n1' });
    d.nodes.n2 = makeNode('process', 100, 400, { id: 'n2' });
    d.edges.e1 = makeEdge({
      id: 'e1',
      source: { nodeId: 'n1', port: 's' },
      target: { nodeId: 'n2', port: 'n' },
      ...edgeOverrides,
    });
    d.order = ['n1', 'n2', 'e1'];
    normalizeOrder(d);
    return d;
  }

  it('emits a path with an arrow tip and loads arrows.meta', () => {
    const code = gen(twoNodes({ routing: 'straight' })).code;
    expect(code).toMatch(/\\draw\[fcedge, -\{Stealth\[/);
    expect(code).toMatch(/usetikzlibrary\{[^}]*arrows\.meta/);
  });

  it('spells each routing style with the right TikZ syntax', () => {
    expect(gen(twoNodes({ routing: 'straight' })).code).toContain(' -- ');
    expect(gen(twoNodes({ routing: 'curved', bend: 60 })).code).toContain('.. controls');
    expect(gen(twoNodes({ routing: 'bezier', bend: 20 })).code).toContain('.. controls');
    const elbow = gen(twoNodes({ routing: 'orthogonal' })).code;
    expect((elbow.match(/ -- /g) ?? []).length).toBeGreaterThan(1);
    expect(gen(twoNodes({ routing: 'rounded-orthogonal' })).code).toContain('.. controls');
    const zig = gen(twoNodes({ routing: 'zigzag' })).code;
    expect((zig.match(/ -- /g) ?? []).length).toBeGreaterThan(4);
  });

  it('changes the emitted path when the routing changes', () => {
    const a = gen(twoNodes({ routing: 'straight' })).code;
    const b = gen(twoNodes({ routing: 'curved', bend: 60 })).code;
    expect(a).not.toBe(b);
  });

  it('supports arrows at either end, both ends or neither', () => {
    expect(gen(twoNodes({ arrowStart: 'none', arrowEnd: 'none' })).code).not.toContain(
      'Stealth',
    );
    const both = gen(twoNodes({ arrowStart: 'latex', arrowEnd: 'latex' })).code;
    expect(both).toMatch(/\{Latex\[[^\]]*\]\}-\{Latex\[/);
    const startOnly = gen(twoNodes({ arrowStart: 'triangle', arrowEnd: 'none' })).code;
    expect(startOnly).toMatch(/\{Triangle\[[^\]]*\]\}-,/);
  });

  it('emits an open arrow tip for the open variant', () => {
    expect(gen(twoNodes({ arrowEnd: 'open-triangle' })).code).toContain('Triangle[open');
  });

  it('emits connector colour, width, dash and opacity', () => {
    const code = gen(
      twoNodes({
        stroke: '#c0392b',
        strokeWidth: 2.5,
        strokeStyle: 'dashed',
        strokeOpacity: 0.5,
      }),
    ).code;
    expect(code).toContain('draw=fcC0392B');
    expect(code).toContain('line width=1.423pt');
    expect(code).toContain('dash pattern=on');
    expect(code).toContain('draw opacity=0.5');
  });

  it('emits the connector label as a positioned node', () => {
    const code = gen(
      twoNodes({
        label: {
          text: 'Yes',
          pos: 0.5,
          offset: -10,
          fontSize: 12,
          color: '#12161c',
          background: true,
        },
      }),
    ).code;
    expect(code).toContain('{Yes}');
    expect(code).toContain('(e1label)');
    expect(code).toContain('fill=white');
  });

  it('escapes connector labels', () => {
    const code = gen(
      twoNodes({
        label: {
          text: '> 50%',
          pos: 0.5,
          offset: 0,
          fontSize: 12,
          color: '#000000',
          background: false,
        },
      }),
    ).code;
    expect(code).toContain('\\textgreater{} 50\\%');
  });

  it('moves the emitted endpoint when the attached shape moves', () => {
    const d = twoNodes({ routing: 'straight' });
    const before = gen(d).code;
    d.nodes.n1.x += 100;
    const after = gen(d).code;
    expect(after).not.toBe(before);
  });

  it('keeps the connector when its shape is deleted, as a floating path', () => {
    const d = twoNodes({ routing: 'straight' });
    removeObjects(d, ['n2']);
    const r = gen(d);
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(r.code).toContain('\\draw[fcedge');
    expect(lintLatex(r.code, { standalone: true }).problems).toEqual([]);
  });

  it('reports a missing shape rather than emitting a broken path', () => {
    const d = twoNodes({});
    d.edges.e1.target = { nodeId: 'ghost' };
    const r = gen(d);
    expect(r.issues.some((i) => i.severity === 'error')).toBe(true);
    expect(lintLatex(r.code, { standalone: true }).problems).toEqual([]);
  });

  it('skips a zero-length connector with a warning', () => {
    const d = twoNodes({});
    d.edges.e1.source = { point: { x: 10, y: 10 } };
    d.edges.e1.target = { point: { x: 10, y: 10 } };
    const r = gen(d);
    expect(r.issues.some((i) => /zero-length/.test(i.message))).toBe(true);
  });
});

describe('colours and definitions', () => {
  it('defines a shared colour once across many shapes', () => {
    const d = emptyDiagram();
    for (let i = 0; i < 8; i++) {
      const n = makeNode('process', i * 40, 0, { id: `n${i + 1}` });
      n.style.fill = '#3366cc';
      d.nodes[n.id] = n;
      d.order.push(n.id);
    }
    const r = gen(d);
    expect((r.code.match(/\\definecolor\{fc3366CC\}/g) ?? []).length).toBe(1);
    // Three distinct colours in play: the shared fill, the default border and
    // the default text colour - one definition each, for eight shapes.
    expect(r.colorCount).toBe(3);
  });

  it('does not redefine colours xcolor already provides', () => {
    const d = withNode({ style: { ...makeNode('process', 0, 0).style, fill: '#ffffff' } });
    expect(gen(d).code).toContain('fill=white');
    expect(gen(d).code).not.toContain('\\definecolor{fcFFFFFF}');
  });

  it('always defines the reusable styles it references', () => {
    const code = gen(sampleDiagram()).code;
    expect(code).toContain('fcnode/.style=');
    expect(code).toContain('fcedge/.style=');
    expect(code).toContain('fclabel/.style=');
  });

  it('loads no libraries for a diagram that needs none', () => {
    const d = withNode({}, 'rectangle');
    d.edges = {};
    const r = gen(d);
    expect(r.libraries).toEqual([]);
    expect(r.code).not.toContain('usetikzlibrary');
  });

  it('adds amsmath only when a maths escape was emitted', () => {
    expect(gen(withNode({ text: 'plain' })).code).not.toContain('amsmath');
    expect(gen(withNode({ text: 'x ≤ y' })).code).toContain('amsmath');
  });
});

describe('traceability and stability', () => {
  it('maps every object to the lines it produced', () => {
    const d = sampleDiagram();
    const r = gen(d);
    const ids = r.blocks.map((b) => b.objectId);
    for (const id of d.order) expect(ids, id).toContain(id);
    const lines = r.code.split('\n');
    for (const b of r.blocks) {
      expect(b.startLine).toBeGreaterThan(0);
      expect(b.endLine).toBeLessThanOrEqual(lines.length);
      const block = lines.slice(b.startLine - 1, b.endLine).join('\n');
      expect(block, b.objectId).toContain(b.objectId);
    }
  });

  it('is byte-identical when regenerated from unchanged state', () => {
    const d = sampleDiagram();
    expect(gen(d).code).toBe(gen(d).code);
  });

  it('leaves untouched objects byte-identical when one shape moves', () => {
    const d = sampleDiagram();
    const first = gen(d);
    const blockText = (r: ReturnType<typeof gen>, id: string) =>
      r.code
        .split('\n')
        .slice(
          r.blocks.find((b) => b.objectId === id)!.startLine - 1,
          r.blocks.find((b) => b.objectId === id)!.endLine,
        )
        .join('\n');

    d.nodes.n5.x += 10;
    const second = gen(d);

    // n5 and the connectors attached to it are expected to change.
    const untouched = ['n1', 'n2', 'n3', 'n4', 'n6', 'n7', 'n8', 'e1', 'e2', 'e3', 'e7'];
    for (const id of untouched) {
      expect(blockText(second, id), id).toBe(blockText(first, id));
    }
    expect(blockText(second, 'n5')).not.toBe(blockText(first, 'n5'));
  });

  it('does not shift every coordinate when a shape moves within the origin grid', () => {
    const d = sampleDiagram();
    const before = gen(d).code;
    d.nodes.n3.y += 5;
    const after = gen(d).code;
    const beforeN1 = before.split('\n').find((l) => l.includes('(n1) at'));
    const afterN1 = after.split('\n').find((l) => l.includes('(n1) at'));
    expect(afterN1).toBe(beforeN1);
  });
});

describe('robustness', () => {
  it('lints clean for the full example diagram', () => {
    const r = gen(sampleDiagram());
    expect(lintLatex(r.code, { standalone: true }).problems).toEqual([]);
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('handles a large diagram without errors', () => {
    const d = emptyDiagram('Large');
    const kinds = SHAPE_LIST.map((s) => s.id);
    for (let i = 0; i < 200; i++) {
      const id = `n${i + 1}`;
      d.nodes[id] = makeNode(kinds[i % kinds.length], (i % 20) * 180, Math.floor(i / 20) * 140, {
        id,
        text: `Step ${i + 1}`,
      });
      d.order.push(id);
      if (i > 0) {
        const eid = `e${i}`;
        d.edges[eid] = makeEdge({
          id: eid,
          source: { nodeId: `n${i}`, port: 'auto' },
          target: { nodeId: id, port: 'auto' },
        });
        d.order.push(eid);
      }
    }
    normalizeOrder(d);
    const started = Date.now();
    const r = gen(d);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(lintLatex(r.code, { standalone: true }).problems).toEqual([]);
  });

  it('survives overlapping and identical shapes', () => {
    const d = emptyDiagram();
    for (let i = 0; i < 5; i++) {
      const id = `n${i + 1}`;
      d.nodes[id] = makeNode('process', 100, 100, { id, text: 'Same place' });
      d.order.push(id);
    }
    normalizeOrder(d);
    expect(lintLatex(gen(d).code, { standalone: true }).problems).toEqual([]);
  });

  it('handles very long single-line text', () => {
    const d = withNode({ text: 'word '.repeat(120).trim() });
    const r = gen(d);
    expect(lintLatex(r.code, { standalone: true }).problems).toEqual([]);
  });

  it('reports invalid dimensions instead of emitting them', () => {
    const d = withNode({ w: 0, h: -5 });
    const r = gen(d);
    expect(r.issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('reports an unreadable colour and falls back to black', () => {
    const d = withNode({ style: { ...makeNode('process', 0, 0).style, fill: 'chartreuse' } });
    const r = gen(d);
    expect(r.issues.some((i) => /colour/.test(i.message))).toBe(true);
    expect(r.code).toContain('fill=black');
  });

  it('warns about characters that need a Unicode engine', () => {
    const r = gen(withNode({ text: '流程' }));
    expect(r.issues.some((i) => /XeLaTeX|LuaLaTeX/.test(i.message))).toBe(true);
  });

  it('reports an unknown shape without throwing', () => {
    const d = withNode({}, 'no-such-shape');
    const r = gen(d);
    expect(r.issues.some((i) => /Unknown shape/.test(i.message))).toBe(true);
    expect(lintLatex(r.code, { standalone: true }).problems).toEqual([]);
  });

  it('isolates a failure to the object that caused it', () => {
    const d = sampleDiagram();
    // A node whose style object is missing entirely.
    (d.nodes.n2 as unknown as Record<string, unknown>).style = null;
    const r = gen(d);
    expect(r.issues.some((i) => i.objectId === 'n2' && i.severity === 'error')).toBe(true);
    // Every other node still made it into the output.
    expect(r.code).toContain('(n1)');
    expect(r.code).toContain('% n8');
  });
});
