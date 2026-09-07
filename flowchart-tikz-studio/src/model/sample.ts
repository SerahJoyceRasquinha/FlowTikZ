import type { Diagram } from './types';
import { emptyDiagram, makeEdge, makeNode } from './defaults';
import { normalizeOrder } from './diagram';

/**
 * A worked example that exercises most of the pipeline: several symbol types,
 * a custom palette, a gradient, both label branches of a decision, and three
 * routing styles. Also used as the fixture for the LaTeX generation tests.
 */
export function sampleDiagram(): Diagram {
  const d = emptyDiagram('Submission review');

  const add = (
    id: string,
    kind: string,
    x: number,
    y: number,
    text: string,
    overrides: Partial<ReturnType<typeof makeNode>> = {},
  ) => {
    const n = makeNode(kind, x, y, { id, text, ...overrides });
    n.x = x;
    n.y = y;
    d.nodes[id] = n;
    d.order.push(id);
    return n;
  };

  add('n1', 'terminator', 260, 40, 'Start', {
    style: {
      ...makeNode('terminator', 0, 0).style,
      fill: '#d4f0ea',
      stroke: '#0f9b8e',
    },
  });
  add('n2', 'io', 250, 140, 'Receive manuscript');
  add('n3', 'process', 255, 250, 'Run plagiarism check', {
    style: {
      ...makeNode('process', 0, 0).style,
      fill: '#f7f9fb',
      shading: 'axis-vertical',
      shadingColor: '#dbe8ff',
      shadow: true,
    },
  });
  add('n4', 'decision', 260, 370, 'Score below\nthreshold?');
  add('n5', 'process', 60, 520, 'Send to reviewers', {
    style: { ...makeNode('process', 0, 0).style, fill: '#dbe8ff', stroke: '#2f6feb' },
  });
  add('n6', 'document', 470, 515, 'Rejection letter', {
    style: { ...makeNode('document', 0, 0).style, fill: '#fadfd8', stroke: '#c65b3c' },
  });
  add('n7', 'database', 90, 640, 'Archive', {
    style: { ...makeNode('database', 0, 0).style, fill: '#e6edf4' },
  });
  add('n8', 'terminator', 440, 640, 'End', {
    style: { ...makeNode('terminator', 0, 0).style, fill: '#e6edf4' },
  });

  const edge = (
    id: string,
    source: string,
    sPort: string,
    target: string,
    tPort: string,
    extra: Partial<ReturnType<typeof makeEdge>> = {},
  ) => {
    d.edges[id] = makeEdge({
      id,
      source: { nodeId: source, port: sPort as never },
      target: { nodeId: target, port: tPort as never },
      ...extra,
    });
    d.order.push(id);
  };

  edge('e1', 'n1', 's', 'n2', 'n', { routing: 'straight' });
  edge('e2', 'n2', 's', 'n3', 'n', { routing: 'straight' });
  edge('e3', 'n3', 's', 'n4', 'n', { routing: 'straight' });
  edge('e4', 'n4', 'w', 'n5', 'n', {
    routing: 'rounded-orthogonal',
    label: {
      text: 'Yes',
      pos: 0.45,
      offset: -10,
      fontSize: 12,
      color: '#12161c',
      background: true,
    },
  });
  edge('e5', 'n4', 'e', 'n6', 'n', {
    routing: 'rounded-orthogonal',
    label: {
      text: 'No',
      pos: 0.45,
      offset: 10,
      fontSize: 12,
      color: '#12161c',
      background: true,
    },
  });
  edge('e6', 'n5', 's', 'n7', 'n', { routing: 'straight' });
  edge('e7', 'n6', 's', 'n8', 'n', { routing: 'straight' });
  edge('e8', 'n7', 'e', 'n8', 'w', {
    routing: 'curved',
    bend: 40,
    strokeStyle: 'dashed',
    arrowEnd: 'open-triangle',
    label: {
      text: 'notify',
      pos: 0.5,
      offset: -14,
      fontSize: 11,
      color: '#7c8a9b',
      background: false,
    },
  });

  normalizeOrder(d);
  return d;
}
