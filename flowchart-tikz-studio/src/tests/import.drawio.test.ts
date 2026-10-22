import { describe, expect, it } from 'vitest';
import { drawioToIR, htmlLabelToText, readDrawioPages } from '../import/drawio/parser';
import { irToDiagram } from '../import/conversion/diagramMapper';
import { ReportBuilder } from '../import/report';
import { ImportError } from '../import/types';
import { excalidrawToIR } from '../import/excalidraw/parser';
import { generateLatex } from '../latex/generator';
import { routeEdge } from '../model/routing';
import { lintLatex } from './latexLint';
import { TEXT } from './helpers/importFixtures';
import type { Diagram } from '../model/types';

/** 5. draw.io import   18. draw.io style preservation   (+ compressed, multi-page, Excalidraw) */

async function importDrawio(xml: string, pageIndex?: number) {
  const report = new ReportBuilder();
  const ir = await drawioToIR(xml, { report, pageIndex });
  const mapped = irToDiagram(ir, { report, format: 'drawio', name: 'test', inferAttachments: false });
  return { d: mapped.diagram, report, ir, idMap: mapped.idMap };
}

const bySource = (d: Diagram, id: string) => Object.values(d.nodes).find((n) => n.meta?.import?.sourceId === id)!;
const edgeBySource = (d: Diagram, id: string) => Object.values(d.edges).find((e) => e.meta?.import?.sourceId === id)!;

const model = (cells: string, attrs = '') =>
  `<mxGraphModel ${attrs}><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;

describe('draw.io: the fixture file', async () => {
  const { d, report } = await importDrawio(TEXT.flowchartDrawio);

  it('reads every vertex and edge, straight from the XML', () => {
    expect(Object.keys(d.nodes)).toHaveLength(13);
    expect(Object.keys(d.edges)).toHaveLength(8);
    expect(report.entries.some((e) => /rasteri[sz]/i.test(e.message))).toBe(false);
  });

  it('maps draw.io shapes to native symbols', () => {
    expect(bySource(d, 'start').kind).toBe('terminator'); // rounded, arcSize=50
    expect(bySource(d, 'recv').kind).toBe('process');
    expect(bySource(d, 'check').kind).toBe('decision'); // rhombus
    expect(bySource(d, 'io').kind).toBe('io'); // shape=parallelogram
    expect(bySource(d, 'db').kind).toBe('database'); // shape=cylinder3
    expect(bySource(d, 'doc').kind).toBe('document');
    expect(bySource(d, 'lockme').kind).toBe('note');
    expect(bySource(d, 'title').kind).toBe('text');
    expect(bySource(d, 'lane').kind).toBe('freeform'); // swimlane frame + header rule
  });

  it('keeps geometry, including children positioned inside containers and groups', () => {
    const recv = bySource(d, 'recv');
    const start = bySource(d, 'start');
    expect(recv.x - start.x).toBe(-10);
    expect(recv.y - start.y).toBe(100);
    expect([recv.w, recv.h]).toEqual([160, 70]);
    const invoice = bySource(d, 'invoice');
    const ship = bySource(d, 'ship');
    expect(invoice.y - ship.y).toBe(90); // relative to the group cell
    const pack = bySource(d, 'pack');
    const lane = bySource(d, 'lane');
    expect(pack.x - lane.x).toBe(40); // relative to the swimlane
    expect(pack.y - lane.y).toBe(70);
  });

  it('preserves draw.io styles (18)', () => {
    const start = bySource(d, 'start');
    expect(start.style.fill).toBe('#d5e8d4');
    expect(start.style.stroke).toBe('#82b366');
    expect(start.textStyle.bold).toBe(true); // fontStyle=1
    const recv = bySource(d, 'recv');
    expect(recv.style.strokeWidth).toBe(2);
    expect(recv.style.shadow).toBe(true);
    expect(recv.textStyle.fontSize).toBe(14);
    expect(recv.text).toBe('Receive\norder'); // html <br>
    const check = bySource(d, 'check');
    expect(check.style.shading).toBe('axis-vertical'); // gradientColor, default direction south
    expect(check.style.shadingColor).toBe('#ffd966');
    const doc = bySource(d, 'doc');
    expect(doc.style.strokeStyle).toBe('dashed');
    expect(doc.meta!.import!.preserved!.dashArray).toBe('8 4');
    const title = bySource(d, 'title');
    expect(title.textStyle.bold && title.textStyle.italic).toBe(true); // fontStyle=3
    expect(title.textStyle.fontFamily).toBe('serif'); // Georgia
    expect(title.textStyle.align).toBe('left');
    expect(title.textStyle.color).toBe('#333333');
    expect(bySource(d, 'pack').rotation).toBe(15);
    expect(bySource(d, 'lockme').locked).toBe(true);
  });

  it('resolves UserObject placeholders and keeps custom data as metadata', () => {
    const doc = bySource(d, 'doc');
    expect(doc.text).toBe('Pick list (PL-7)');
    expect(doc.meta!.import!.preserved!['data:owner']).toBe('warehouse');
  });

  it('keeps style keys it cannot show verbatim, never silently dropping them', () => {
    const db = bySource(d, 'db');
    expect(db.meta!.import!.preserved!.size).toBe('15');
    const lane = bySource(d, 'lane');
    expect(lane.meta!.import!.preserved!.headerFill).toBe('#f8cecc');
    const lambda = bySource(d, 'lambda');
    expect(lambda.kind).toBe('process');
    expect(lambda.meta!.import!.preserved!.shape).toBe('mxgraph.aws4.lambda_function');
    expect(report.entries.some((e) => e.category === 'partial' && /mxgraph\.aws4/.test(e.message))).toBe(true);
  });

  it('maps edges: terminals, exit/entry constraints, routing, arrows, labels', () => {
    const e2 = edgeBySource(d, 'e2');
    expect(e2.source.port).toBe('s'); // exitX=0.5 exitY=1
    expect(e2.target.port).toBe('n');
    expect(e2.routing).toBe('orthogonal');
    const e3 = edgeBySource(d, 'e3');
    expect(e3.routing).toBe('rounded-orthogonal');
    expect(e3.arrowEnd).toBe('triangle'); // block
    expect(e3.stroke).toBe('#b85450');
    expect(e3.strokeWidth).toBe(2);
    expect(e3.label?.text).toBe('No');
    const e4 = edgeBySource(d, 'e4');
    expect(e4.routing).toBe('polyline');
    expect(e4.waypoints).toHaveLength(1);
    expect(e4.strokeStyle).toBe('dashed');
    expect(e4.arrowEnd).toBe('open-triangle'); // open, approximated and reported
    const e5 = edgeBySource(d, 'e5');
    expect(e5.label?.text).toBe('Yes'); // child edgeLabel cell
    expect(e5.label?.pos).toBeCloseTo(0.4); // x = -0.2
    expect(e5.label?.background).toBe(true);
    const e6 = edgeBySource(d, 'e6');
    expect(e6.routing).toBe('curved');
    expect(e6.arrowStart).toBe('circle');
    const e1 = edgeBySource(d, 'e1');
    // Floating terminals stay floating: the router picks the side, live.
    expect(e1.source.port).toBe('auto');
    expect(e1.target.port).toBe('auto');
  });

  it('keeps a dangling edge dangling, as in the source', () => {
    const e8 = edgeBySource(d, 'e8');
    expect(e8.source.nodeId).toBeTruthy();
    expect(e8.target.point).toBeTruthy();
    expect(e8.label?.text).toBe('loose end');
  });

  it('maps groups and containers to native groups', () => {
    const groups = Object.values(d.groups);
    expect(groups).toHaveLength(2);
    const ship = bySource(d, 'ship');
    const invoice = bySource(d, 'invoice');
    expect(ship.groupId).toBeTruthy();
    expect(ship.groupId).toBe(invoice.groupId);
    expect(bySource(d, 'pack').groupId).toBe(bySource(d, 'lane').groupId);
  });

  it('merges layers in order and reports the hidden one', () => {
    expect(report.entries.some((e) => /2 layers/.test(e.message))).toBe(true);
    expect(report.entries.some((e) => /Annotations.*hidden/.test(e.message))).toBe(true);
    expect(bySource(d, 'lockme').meta!.import!.preserved!.layer).toBe('Annotations');
  });

  it('drops the page background (transparent export) and says so', () => {
    expect(d.settings.background).toBe('none');
    expect(report.entries.some((e) => /page background \(#f5f5f5\)/.test(e.message))).toBe(true);
  });

  it('keeps z-order: document order is paint order', () => {
    const i = (id: string) => d.order.indexOf(bySource(d, id).id);
    expect(i('start')).toBeLessThan(i('recv'));
    expect(i('lane')).toBeLessThan(i('pack'));
  });

  it('routes every connector and generates lint-clean LaTeX', () => {
    for (const e of Object.values(d.edges)) expect(routeEdge(d, e)).not.toBeNull();
    const out = generateLatex(d);
    expect(out.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(lintLatex(out.code, { standalone: true }).problems).toEqual([]);
    expect(out.code).toContain('Pick list (PL-7)');
  });
});

describe('draw.io: file variants', () => {
  it('decompresses compressed pages and imports the first of several', async () => {
    const pages = await readDrawioPages(TEXT.compressedDrawio);
    expect(pages.map((p) => p.name)).toEqual(['Order flow', 'Appendix']);
    const { d, report } = await importDrawio(TEXT.compressedDrawio);
    expect(Object.keys(d.nodes)).toHaveLength(13);
    expect(report.entries.some((e) => /2 pages.*Appendix/.test(e.message))).toBe(true);
    const second = await importDrawio(TEXT.compressedDrawio, 1);
    expect(Object.values(second.d.nodes).map((n) => n.text)).toEqual(['Second page']);
  });

  it('accepts a bare mxGraphModel', async () => {
    const { d } = await importDrawio(model('<mxCell id="a" value="A" style="ellipse;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="80" as="geometry"/></mxCell>'));
    expect(Object.values(d.nodes)[0].kind).toBe('ellipse');
  });

  it('rejects damaged files with a clear error', async () => {
    await expect(importDrawio('<mxfile><diagram>not base64 !!!</diagram></mxfile>')).rejects.toBeInstanceOf(ImportError);
    await expect(importDrawio('<mxfile><diagram')).rejects.toThrow(/not well-formed/);
    await expect(importDrawio('<mxfile></mxfile>')).rejects.toThrow(/no diagram pages/);
    await expect(importDrawio(model(''))).rejects.toThrow(ImportError);
  });

  it('handles triangles by direction, and edge-to-edge links as free ends', async () => {
    const { d, report } = await importDrawio(
      model(`
        <mxCell id="t1" style="triangle;direction=south;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="60" height="40" as="geometry"/></mxCell>
        <mxCell id="t2" style="triangle;" vertex="1" parent="1"><mxGeometry x="100" y="0" width="60" height="40" as="geometry"/></mxCell>
        <mxCell id="b" style="rounded=0;" vertex="1" parent="1"><mxGeometry x="0" y="200" width="60" height="40" as="geometry"/></mxCell>
        <mxCell id="e1" edge="1" parent="1" source="t1" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>
        <mxCell id="e2" edge="1" parent="1" source="e1" target="b"><mxGeometry relative="1" as="geometry"><mxPoint x="200" y="100" as="sourcePoint"/></mxGeometry></mxCell>`),
    );
    expect(bySource(d, 't1').kind).toBe('merge');
    expect(bySource(d, 't2').kind).toBe('freeform'); // pointing east: exact outline
    expect(report.entries.some((e) => /attached to another connector/.test(e.message))).toBe(true);
    expect(edgeBySource(d, 'e2').source.point).toBeTruthy();
  });

  it('converts HTML labels to text, keeping line breaks and whole-label bold', () => {
    expect(htmlLabelToText('<div>One</div><div>Two&nbsp;three</div>').text).toBe('One\nTwo three');
    expect(htmlLabelToText('<b>Bold</b>').bold).toBe(true);
    const mixed = htmlLabelToText('Some <b>bold</b> and <i>italic</i>');
    expect(mixed.text).toBe('Some bold and italic');
    expect(mixed.richLost).toBe(true);
  });
});

describe('Excalidraw', () => {
  const file = JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: [
      { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 120, height: 60, angle: 0, strokeColor: '#1e1e1e', backgroundColor: '#a5d8ff', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, roundness: { type: 3 }, groupIds: ['g1'], boundElements: [{ id: 't1', type: 'text' }] },
      { id: 't1', type: 'text', x: 20, y: 20, width: 80, height: 25, text: 'Hello', fontSize: 20, fontFamily: 1, textAlign: 'center', verticalAlign: 'middle', containerId: 'r1', strokeColor: '#1e1e1e' },
      { id: 'd1', type: 'diamond', x: 250, y: 0, width: 100, height: 80, angle: 0.5, strokeColor: '#1e1e1e', backgroundColor: 'transparent', strokeWidth: 1, strokeStyle: 'dashed', roughness: 0, opacity: 100, groupIds: ['g1'] },
      { id: 'a1', type: 'arrow', x: 120, y: 30, width: 130, height: 10, points: [[0, 0], [130, 10]], strokeColor: '#1e1e1e', strokeWidth: 2, strokeStyle: 'solid', startBinding: { elementId: 'r1' }, endBinding: { elementId: 'd1' }, startArrowhead: null, endArrowhead: 'triangle', roughness: 1, opacity: 100 },
      { id: 'x', type: 'rectangle', isDeleted: true, x: 0, y: 0, width: 1, height: 1 },
    ],
    appState: { viewBackgroundColor: '#ffffff' },
  });

  it('maps shapes, bound text, bound arrows, groups and rotation', () => {
    const report = new ReportBuilder();
    const ir = excalidrawToIR(file, { report });
    const d = irToDiagram(ir, { report, format: 'excalidraw' }).diagram;
    const nodes = Object.values(d.nodes);
    expect(nodes).toHaveLength(2);
    const rect = nodes.find((n) => n.text === 'Hello')!;
    expect(rect.kind).toBe('process');
    expect(rect.style.fill).toBe('#a5d8ff');
    expect(rect.style.cornerRadius).toBeGreaterThan(0);
    const diamond = nodes.find((n) => n.kind === 'decision')!;
    expect(diamond.rotation).toBeCloseTo(28.648, 2);
    expect(diamond.style.strokeStyle).toBe('dashed');
    expect(diamond.style.fillOpacity).toBe(0);
    const edge = Object.values(d.edges)[0];
    expect(edge.source.nodeId).toBe(rect.id);
    expect(edge.target.nodeId).toBe(diamond.id);
    expect(edge.arrowEnd).toBe('triangle');
    expect(Object.values(d.groups)).toHaveLength(1);
    expect(report.entries.some((e) => /hand-drawn/.test(e.message))).toBe(true);
  });
});
