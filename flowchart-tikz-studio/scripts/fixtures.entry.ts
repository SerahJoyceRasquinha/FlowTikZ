/**
 * The set of diagrams whose generated LaTeX must survive a real pdflatex run.
 * Each one is chosen to exercise a different corner of the emitter.
 */
import { generateLatex } from '../src/latex/generator';
import { emptyDiagram, makeEdge, makeNode } from '../src/model/defaults';
import { normalizeOrder } from '../src/model/diagram';
import { sampleDiagram } from '../src/model/sample';
import { SHAPE_LIST } from '../src/model/shapes';
import type { Diagram } from '../src/model/types';

const std = (d: Diagram) =>
  generateLatex(d, { mode: 'standalone', comments: true }).code;

/* 1. The worked example. */
const example = sampleDiagram();

/* 2. Every registered symbol, laid out in a grid, each with text. */
function allShapes(): Diagram {
  const d = emptyDiagram('All symbols');
  SHAPE_LIST.forEach((def, i) => {
    const id = `n${i + 1}`;
    d.nodes[id] = makeNode(def.id, (i % 5) * 220, Math.floor(i / 5) * 150, {
      id,
      text: def.label,
    });
    d.order.push(id);
  });
  normalizeOrder(d);
  return d;
}

/* 3. Every styling combination that has its own TikZ spelling. */
function allStyles(): Diagram {
  const d = emptyDiagram('All styles');
  const variants: Partial<ReturnType<typeof makeNode>>['style'][] = [
    { fill: '#3366cc', stroke: '#112233', strokeWidth: 3, strokeStyle: 'solid' },
    { fill: '#ff8800', strokeStyle: 'dashed', strokeWidth: 2 },
    { fill: '#c0ffee', strokeStyle: 'dotted' },
    { fill: '#eeddaa', strokeStyle: 'dashdotted' },
    { fill: '#ffffff', strokeStyle: 'none' },
    { fill: '#dbe8ff', fillOpacity: 0.4 },
    { fill: '#dbe8ff', opacity: 0.55 },
    { fill: '#ffffff', shadow: true },
    { fill: '#35c4a8', shading: 'axis-vertical', shadingColor: '#12161c' },
    { fill: '#35c4a8', shading: 'axis-horizontal', shadingColor: '#ffffff' },
    { fill: '#35c4a8', shading: 'radial', shadingColor: '#12161c' },
    { fill: '#ffffff', cornerRadius: 14 },
  ] as never[];

  variants.forEach((style, i) => {
    const id = `n${i + 1}`;
    const n = makeNode('process', (i % 4) * 220, Math.floor(i / 4) * 140, {
      id,
      text: `style ${i + 1}`,
    });
    Object.assign(n.style, style);
    d.nodes[id] = n;
    d.order.push(id);
  });

  // Rotation, text alignment and typography.
  const extras = [
    { rotation: 30, text: 'rotated' },
    { rotation: -45, text: 'rotated\ntwo lines' },
    { text: 'top left', textStyle: { align: 'left', valign: 'top' } },
    { text: 'bottom right', textStyle: { align: 'right', valign: 'bottom' } },
    { text: 'serif bold', textStyle: { fontFamily: 'serif', bold: true } },
    { text: 'mono italic', textStyle: { fontFamily: 'mono', italic: true } },
    { text: 'underlined', textStyle: { underline: true } },
    { text: 'big', textStyle: { fontSize: 24 } },
    { text: 'wrapped text that must break across several lines', textStyle: { wrapWidth: 120 } },
    { text: 'specials #$%&_{}~^\\ <>|' },
    { text: 'accents: Café Ürün Ångström' },
    { text: 'symbols: 50% ≤ 100° × Δt' },
  ];
  extras.forEach((extra, i) => {
    const id = `x${i + 1}`;
    const n = makeNode('rectangle', (i % 4) * 220, 500 + Math.floor(i / 4) * 150, {
      id,
      text: extra.text,
      rotation: extra.rotation ?? 0,
    });
    if (extra.textStyle) Object.assign(n.textStyle, extra.textStyle);
    d.nodes[id] = n;
    d.order.push(id);
  });

  normalizeOrder(d);
  return d;
}

/* 4. Every routing style, arrowhead and label option. */
function allConnectors(): Diagram {
  const d = emptyDiagram('All connectors');
  const routings = [
    'straight',
    'orthogonal',
    'rounded-orthogonal',
    'curved',
    'bezier',
    'zigzag',
    'polyline',
  ] as const;
  const arrows = [
    'none',
    'stealth',
    'latex',
    'triangle',
    'open-triangle',
    'bar',
    'circle',
    'diamond',
  ] as const;

  routings.forEach((routing, i) => {
    const a = `a${i}`;
    const b = `b${i}`;
    d.nodes[a] = makeNode('process', 0, i * 130, { id: a, w: 120, h: 60, text: routing });
    d.nodes[b] = makeNode('process', 380, i * 130 + 40, { id: b, w: 120, h: 60, text: 'to' });
    d.order.push(a, b);
    d.edges[`e${i}`] = makeEdge({
      id: `e${i}`,
      source: { nodeId: a, port: 'e' },
      target: { nodeId: b, port: 'w' },
      routing,
      bend: 50,
      arrowStart: i % 2 ? 'stealth' : 'none',
      arrowEnd: 'stealth',
      label: {
        text: routing,
        pos: 0.5,
        offset: -12,
        fontSize: 11,
        color: '#12161c',
        background: i % 2 === 0,
      },
    });
    d.order.push(`e${i}`);
  });

  arrows.forEach((arrow, i) => {
    const a = `c${i}`;
    const b = `d${i}`;
    d.nodes[a] = makeNode('connector', 700, i * 100, { id: a, w: 50, h: 50 });
    d.nodes[b] = makeNode('connector', 950, i * 100, { id: b, w: 50, h: 50 });
    d.order.push(a, b);
    d.edges[`f${i}`] = makeEdge({
      id: `f${i}`,
      source: { nodeId: a, port: 'e' },
      target: { nodeId: b, port: 'w' },
      routing: 'straight',
      arrowStart: arrow,
      arrowEnd: arrow,
      arrowSize: 12,
      strokeStyle: i % 3 === 0 ? 'dashed' : 'solid',
      label: {
        text: arrow,
        pos: 0.5,
        offset: -14,
        fontSize: 10,
        color: '#7c8a9b',
        background: false,
      },
    });
    d.order.push(`f${i}`);
  });

  // A connector detached from its shape, and one at an extreme scale.
  d.nodes.z1 = makeNode('process', 0, 1000, { id: 'z1' });
  d.order.push('z1');
  d.edges.z2 = makeEdge({
    id: 'z2',
    source: { nodeId: 'z1', port: 's' },
    target: { point: { x: 300, y: 1200 } },
    routing: 'straight',
  });
  d.order.push('z2');

  normalizeOrder(d);
  return d;
}

/* 5. Empty diagram: must still compile. */
const empty = emptyDiagram('Empty');

/* 6. Small scale: verifies the dimension conversion at an extreme. */
function tiny(): Diagram {
  const d = sampleDiagram();
  d.settings.unitsPerCm = 200;
  return d;
}

/*
 * 7. A dimensional control.
 *
 * One rectangle of a known size, alone on the page. Because the standalone
 * class crops to the picture plus an 8pt border, the compiled page size is a
 * direct measurement of whether du -> cm conversion is correct. The expected
 * value is written into the file as a machine-readable comment that
 * scripts/verify-latex.sh checks against pdfinfo.
 */
function geometryControl(): { diagram: Diagram; expected: [number, number] } {
  const d = emptyDiagram('Geometry control');
  const n = makeNode('rectangle', 0, 0, { id: 'n1', w: 200, h: 100, text: '' });
  d.nodes.n1 = n;
  d.order.push('n1');
  normalizeOrder(d);

  const PT_PER_CM = 28.4527559;
  const border = 8 * 2;
  const stroke = (n.style.strokeWidth / d.settings.unitsPerCm) * PT_PER_CM;
  const w = (n.w / d.settings.unitsPerCm) * PT_PER_CM + border + stroke;
  const h = (n.h / d.settings.unitsPerCm) * PT_PER_CM + border + stroke;
  return { diagram: d, expected: [w, h] };
}

const control = geometryControl();
const controlCode = [
  `% VERIFY page ${control.expected[0].toFixed(2)} ${control.expected[1].toFixed(2)}`,
  '% A 200x100 du rectangle at 50 du/cm must print 4cm x 2cm.',
  std(control.diagram),
].join('\n');

export const fixtures = [
  { name: '01-example', code: std(example) },
  { name: '02-all-shapes', code: std(allShapes()) },
  { name: '03-all-styles', code: std(allStyles()) },
  { name: '04-all-connectors', code: std(allConnectors()) },
  { name: '05-empty', code: std(empty) },
  { name: '06-scaled', code: std(tiny()) },
  { name: '07-geometry-control', code: controlCode },
];
