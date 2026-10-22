import { describe, expect, it, beforeEach } from 'vitest';
/*
 * The shipped files are imported through the bundler rather than read with
 * `fs`, so the suite needs no Node type definitions and the project keeps its
 * three-dependency footprint.
 */
import exampleJson from '../../examples/submission-review.json';
import exampleStandaloneTex from '../../examples/submission-review-standalone.tex?raw';
import exampleSnippetTex from '../../examples/submission-review-snippet.tex?raw';
import { deserialize, serialize } from '../persistence/schema';
import { generateLatex } from '../latex/generator';
import { useEditor } from '../state/store';
import { emptyDiagram, makeNode } from '../model/defaults';
import { resetIdCounters } from '../model/ids';
import { lintLatex } from './latexLint';
import { SHAPE_LIST } from '../model/shapes';
import { nodeHitTest } from '../model/hittest';

/**
 * Backward compatibility.
 *
 * The editor changes; the save format must not. These read the files that ship
 * with the project - written before any of the interaction work - and prove
 * they still open, still describe the same diagram, and still generate the
 * same LaTeX, byte for byte.
 */

/** The example save file, exactly as it ships, as the reader would receive it. */
const exampleSource = JSON.stringify(exampleJson);

beforeEach(() => {
  resetIdCounters();
});

describe('files written by earlier versions', () => {
  it('opens the shipped example without warnings', () => {
    const { diagram, warnings } = deserialize(exampleSource);
    expect(warnings).toEqual([]);
    expect(diagram.name).toBe('Submission review');
    expect(Object.keys(diagram.nodes).length).toBeGreaterThan(0);
    expect(Object.keys(diagram.edges).length).toBeGreaterThan(0);
  });

  it('still generates exactly the LaTeX committed alongside it', () => {
    const { diagram } = deserialize(exampleSource);
    const standalone = generateLatex(diagram, {
      mode: 'standalone',
      comments: true,
    }).code;
    const snippet = generateLatex(diagram, {
      mode: 'snippet',
      comments: true,
    }).code;
    // The committed .tex files are the reference output. If the editor ever
    // perturbs the model, this is where it shows up.
    expect(standalone.trimEnd()).toBe(
      exampleStandaloneTex.trimEnd(),
    );
    expect(snippet.trimEnd()).toBe(
      exampleSnippetTex.trimEnd(),
    );
  });

  it('keeps every shape type, position, size, style and connection', () => {
    const { diagram } = deserialize(exampleSource);
    const raw = JSON.parse(exampleSource).diagram;
    for (const [id, node] of Object.entries(diagram.nodes)) {
      const before = raw.nodes[id];
      expect(node.kind).toBe(before.kind);
      expect(node.x).toBe(before.x);
      expect(node.y).toBe(before.y);
      expect(node.w).toBe(before.w);
      expect(node.h).toBe(before.h);
      expect(node.text).toBe(before.text);
      expect(node.style.fill).toBe(before.style.fill);
      expect(node.rotation).toBe(before.rotation ?? 0);
    }
    for (const [id, edge] of Object.entries(diagram.edges)) {
      const before = raw.edges[id];
      expect(edge.source).toEqual(before.source);
      expect(edge.target).toEqual(before.target);
      expect(edge.routing).toBe(before.routing);
    }
    expect(diagram.order).toEqual(raw.order);
  });

  it('round-trips through save and load unchanged', () => {
    const { diagram } = deserialize(exampleSource);
    const again = deserialize(serialize(diagram)).diagram;
    const opts = { mode: 'standalone' as const, comments: true };
    expect(generateLatex(again, opts).code).toBe(generateLatex(diagram, opts).code);
  });

  it('adds no new fields to the saved document', () => {
    // Transient editor state - focus, hover, the armed shape - must never be
    // written to a file. A reader on an older build has to see a document it
    // fully understands.
    const { diagram } = deserialize(exampleSource);
    useEditor.getState().loadDocument(diagram, { markSaved: true });
    useEditor.getState().setBoardFocused(true);
    const saved = JSON.parse(serialize(useEditor.getState().doc));
    expect(Object.keys(saved).sort()).toEqual(
      ['diagram', 'format', 'savedAt', 'version'].sort(),
    );
    expect(Object.keys(saved.diagram).sort()).toEqual(
      ['edges', 'groups', 'id', 'name', 'nodes', 'order', 'settings', 'version'].sort(),
    );
    const anyNode = Object.values(saved.diagram.nodes)[0] as Record<string, unknown>;
    expect(Object.keys(anyNode).sort()).toEqual(
      ['h', 'id', 'kind', 'locked', 'rotation', 'style', 'text', 'textStyle', 'w', 'x', 'y', 'z'].sort(),
    );
  });

  it('loads a sparse hand-written file and repairs the gaps', () => {
    const { diagram, warnings } = deserialize(
      JSON.stringify({
        diagram: {
          nodes: { a1: { kind: 'process', x: 10, y: 10, w: 100, h: 50 } },
          edges: { b1: { source: { nodeId: 'a1' }, target: { nodeId: 'missing' } } },
        },
      }),
    );
    expect(Object.keys(diagram.nodes)).toEqual(['a1']);
    // The connector pointed at a shape that is not there; it is dropped, and
    // the user is told rather than left with a diagram that cannot generate.
    expect(Object.keys(diagram.edges)).toEqual([]);
    expect(warnings.join(' ')).toMatch(/missing shape/);
    const res = generateLatex(diagram, { mode: 'standalone', comments: true });
    expect(lintLatex(res.code, { standalone: true }).problems).toEqual([]);
  });

  it('is unfazed by a file from a newer version', () => {
    const { diagram, warnings } = deserialize(
      JSON.stringify({
        format: 'flowchart-tikz-studio',
        version: 99,
        diagram: {
          name: 'From the future',
          nodes: { n1: { kind: 'process', x: 0, y: 0, w: 80, h: 40, sparkles: true } },
          edges: {},
          order: ['n1'],
          somethingNew: { a: 1 },
        },
      }),
    );
    expect(warnings.join(' ')).toMatch(/newer version/);
    expect(diagram.nodes.n1.kind).toBe('process');
    expect((diagram.nodes.n1 as unknown as Record<string, unknown>).sparkles).toBeUndefined();
  });
});

describe('generation is unmoved by the editor', () => {
  it('produces identical output before and after a hover-style enquiry', () => {
    const d = emptyDiagram();
    for (const [i, def] of SHAPE_LIST.entries()) {
      const id = `n${i + 1}`;
      d.nodes[id] = makeNode(def.id, (i % 6) * 220, Math.floor(i / 6) * 160, {
        id,
        text: `${def.label} 50% & <x>`,
      });
      d.order.push(id);
    }
    const opts = { mode: 'standalone' as const, comments: true };
    const before = generateLatex(d, opts).code;

    // Hit testing reads the model; it must never touch it.
    for (const node of Object.values(d.nodes)) {
      nodeHitTest(node, { x: node.x + node.w / 2, y: node.y + node.h / 2 }, 4);
      nodeHitTest(node, { x: node.x - 500, y: node.y - 500 }, 4);
    }

    const after = generateLatex(d, opts).code;
    expect(after).toBe(before);
    expect(lintLatex(after, { standalone: true }).problems).toEqual([]);
  });

  it('emits a compilable document for an empty diagram', () => {
    const res = generateLatex(emptyDiagram(), { mode: 'standalone', comments: true });
    expect(lintLatex(res.code, { standalone: true }).problems).toEqual([]);
    expect(res.code).toContain('\\begin{tikzpicture}');
  });
});
