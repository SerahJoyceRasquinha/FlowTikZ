import { describe, expect, it } from 'vitest';
import { parseXml, XmlError, serializeXml } from '../import/xml/parser';
import { sanitizeSvg } from '../import/svg/sanitize';
import { svgToIR } from '../import/svg/parser';
import { irToSvg } from '../import/svg/generator';
import { parsePathData } from '../import/svg/pathData';
import { parseTransform, decompose } from '../import/svg/transform';
import { irToDiagram } from '../import/conversion/diagramMapper';
import { ReportBuilder } from '../import/report';
import { validateIR } from '../import/ir/validate';
import { generateLatex } from '../latex/generator';
import { routeEdge } from '../model/routing';
import { lintLatex } from './latexLint';
import { TEXT } from './helpers/importFixtures';
import type { Diagram } from '../model/types';

/**
 * 4. SVG import   6. SVG sanitisation   8-14 mapping   17. invalid SVG   19. unsupported
 */

function importSvg(markup: string) {
  const report = new ReportBuilder();
  const ir = svgToIR(markup, { report });
  const mapped = irToDiagram(ir, { report, format: 'svg', name: 'test' });
  return { ir, d: mapped.diagram, report };
}

function byText(d: Diagram, text: string) {
  return Object.values(d.nodes).find((n) => n.text === text);
}

const svg = (body: string, attrs = 'width="400" height="300"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

describe('XML parsing is safe', () => {
  it('rejects entity declarations (billion laughs / XXE)', () => {
    const bomb = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><svg>&lol2;</svg>';
    expect(() => parseXml(bomb)).toThrow(XmlError);
    const xxe = '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>';
    expect(() => parseXml(xxe)).toThrow(/Entity declarations/);
  });

  it('rejects malformed markup with a line number, not a crash', () => {
    expect(() => parseXml('<svg><g></svg>')).toThrow(/Mismatched closing tag/);
    expect(() => parseXml('<svg')).toThrow(XmlError);
    expect(() => parseXml('<svg a=1/>')).toThrow(/quoted/);
    expect(() => parseXml('')).toThrow(/No root/);
  });

  it('limits nesting depth', () => {
    const deep = '<svg>' + '<g>'.repeat(400) + '</g>'.repeat(400) + '</svg>';
    expect(() => parseXml(deep)).toThrow(/nested too deeply/);
  });

  it('cannot be used for prototype pollution through attribute names', () => {
    const el = parseXml('<svg __proto__="x" constructor="y"/>');
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(el.attrs.__proto__).toBe('x');
  });

  it('decodes character references used by draw.io for line breaks', () => {
    const el = parseXml('<a v="one&#xa;two &amp; &lt;three&gt;"/>');
    expect(el.attrs.v).toBe('one\ntwo & <three>');
  });
});

describe('SVG sanitisation', () => {
  const hostile = svg(`
    <script>alert(1)</script>
    <rect width="10" height="10" onclick="evil()" onmouseover="x()"/>
    <a href="javascript:alert(2)"><rect x="20" width="10" height="10"/></a>
    <image href="https://tracker.example/p.gif" width="5" height="5"/>
    <image href="data:image/png;base64,iVBORw0KGgo=" width="5" height="5"/>
    <use href="https://evil.example/sprite.svg#a"/>
    <rect style="fill:url(https://evil.example/x.svg#g); behavior:url(x.htc)" width="5" height="5"/>
    <foreignObject width="100" height="40"><div xmlns="http://www.w3.org/1999/xhtml"><b>Hello</b><br/>world<script>bad()</script></div></foreignObject>
    <animate attributeName="x" to="100"/>
    <iframe src="https://x"/>`);

  it('removes scripts, handlers, javascript: URLs, active and external content', () => {
    const { root, stats } = sanitizeSvg(parseXml(hostile));
    const out = serializeXml(root);
    expect(out).not.toMatch(/<script|onclick|onmouseover|javascript:|tracker\.example|evil\.example|<iframe|<animate|behavior/i);
    expect(out).toContain('data:image/png;base64');
    expect(stats.scripts).toBeGreaterThanOrEqual(2);
    expect(stats.eventHandlers).toBe(2);
    expect(stats.externalRefs).toBeGreaterThanOrEqual(3);
    expect(stats.activeElements).toBe(2);
  });

  it('reduces foreignObject HTML to its plain text', () => {
    const { root } = sanitizeSvg(parseXml(hostile));
    const out = serializeXml(root);
    expect(out).toContain('Hello\nworld');
    expect(out).not.toContain('<div');
    expect(out).not.toContain('<b>');
  });

  it('reports what it removed and still imports the rest', () => {
    const { d, report } = importSvg(hostile);
    expect(Object.keys(d.nodes).length).toBeGreaterThan(0);
    expect(report.entries.some((e) => /script/.test(e.message))).toBe(true);
    expect(report.entries.some((e) => /external reference/.test(e.message))).toBe(true);
  });

  it('refuses a document whose root is not <svg>', () => {
    expect(() => sanitizeSvg(parseXml('<html/>'))).toThrow(/not <svg>/);
  });
});

describe('path data and transforms', () => {
  it('parses every path command, relative and absolute, arcs included', () => {
    const segs = parsePathData('M10 10 h20 v20 H10 V15 l5 5 c1 1 2 2 3 3 s4 4 5 5 q1 1 2 2 t3 3 a5 5 0 0 1 10 0 A5 5 0 1 0 60 60 z');
    expect(segs[0]).toEqual({ c: 'M', p: { x: 10, y: 10 } });
    expect(segs.filter((s) => s.c === 'C').length).toBeGreaterThanOrEqual(5);
    expect(segs[segs.length - 1]).toEqual({ c: 'Z' });
    for (const s of segs) if (s.c !== 'Z') expect(Number.isFinite(s.p.x) && Number.isFinite(s.p.y)).toBe(true);
    // Compact arc flags ("0 01") are understood.
    expect(() => parsePathData('M0 0a5 5 0 015 5')).not.toThrow();
  });

  it('throws on malformed data instead of producing NaN', () => {
    expect(() => parsePathData('L 10 10')).toThrow();
    expect(() => parsePathData('M 10')).toThrow();
  });

  it('composes and decomposes transforms', () => {
    const m = parseTransform('translate(10 20) rotate(30) scale(2)');
    const d = decompose(m);
    expect(d.tx).toBeCloseTo(10);
    expect(d.ty).toBeCloseTo(20);
    expect(d.rotation).toBeCloseTo(30);
    expect(d.sx).toBeCloseTo(2);
    expect(d.skewed).toBe(false);
    expect(decompose(parseTransform('skewX(20)')).skewed).toBe(true);
    expect(decompose(parseTransform('scale(-1 1)')).skewed).toBe(true);
  });
});

describe('SVG to native diagram: the fixture flowchart', () => {
  const { d, report, ir } = importSvg(TEXT.flowchartSvg);

  it('maps shapes to native kinds (8)', () => {
    expect(byText(d, 'Start')?.kind).toBe('ellipse');
    expect(byText(d, 'Receive\norder')?.kind).toBe('process');
    expect(byText(d, 'In stock?')?.kind).toBe('decision');
    expect(byText(d, 'Backorder')?.kind).toBe('process');
  });

  it('keeps text as editable text, with line breaks and styling (9)', () => {
    const recv = byText(d, 'Receive\norder')!;
    expect(recv.textStyle.fontSize).toBe(14);
    expect(recv.textStyle.fontFamily).toBe('sans');
    expect(byText(d, 'In stock?')!.textStyle.bold).toBe(true);
    const free = byText(d, 'v1.2 – internal')!;
    expect(free.kind).toBe('text');
    expect(free.textStyle.italic).toBe(true);
    expect(free.textStyle.align).toBe('left');
  });

  it('maps styles: CSS classes, ids, gradient, dash, shadow, corner radius (11)', () => {
    const recv = byText(d, 'Receive\norder')!;
    expect(recv.style.stroke).toBe('#1f2933');
    expect(recv.style.strokeWidth).toBe(2);
    expect(byText(d, 'In stock?')!.style.fill).toBe('#fff2cc');
    const start = byText(d, 'Start')!;
    expect(start.style.shading).toBe('axis-vertical');
    expect(start.style.fill).toBe('#dbe8ff');
    expect(start.style.shadingColor).toBe('#2f6feb');
    expect(byText(d, 'Backorder')!.style.strokeStyle).toBe('dashed');
    const ship = byText(d, 'Ship')!;
    expect(ship.style.shadow).toBe(true);
    expect(ship.style.cornerRadius).toBe(10);
  });

  it('keeps rotation (12)', () => {
    expect(byText(d, 'Backorder')!.rotation).toBeCloseTo(-8, 3);
  });

  it('removes the full-canvas background rectangle and exports transparent (39)', () => {
    expect(Object.values(d.nodes).some((n) => n.w >= 500 && n.h >= 500)).toBe(false);
    expect(ir.background.removed).toBe(true);
    expect(ir.background.color).toBe('#eef2f7');
    expect(d.settings.background).toBe('none');
  });

  it('keeps white-filled shapes even though the page was a flat colour (40)', () => {
    expect(byText(d, 'Receive\norder')!.style.fill).toBe('#ffffff');
    expect(byText(d, 'Receive\norder')!.style.fillOpacity).toBe(1);
    expect(byText(d, 'Invoice')!.style.fill).toBe('#ffffff');
  });

  it('turns lines with markers into semantic, shape-bound connectors (10)', () => {
    const edges = Object.values(d.edges);
    expect(edges).toHaveLength(4);
    for (const e of edges) {
      expect(e.source.nodeId).toBeTruthy();
      expect(e.target.nodeId).toBeTruthy();
      expect(e.arrowEnd).toBe('triangle');
    }
    const yes = edges.find((e) => e.label?.text === 'Yes')!;
    expect(d.nodes[yes.target.nodeId!].text).toBe('Ship');
    expect(yes.routing).toBe('orthogonal');
    const no = edges.find((e) => e.label?.text === 'No')!;
    expect(no.strokeStyle).toBe('dashed');
    expect(d.nodes[no.target.nodeId!].text).toBe('Backorder');
  });

  it('keeps paint order (13): later elements are in front', () => {
    const idx = (t: string) => d.order.indexOf(byText(d, t)!.id);
    expect(idx('Start')).toBeLessThan(idx('Receive\norder'));
    expect(idx('Receive\norder')).toBeLessThan(idx('In stock?'));
    Object.values(d.nodes).forEach((n) => expect(n.z).toBe(d.order.indexOf(n.id)));
  });

  it('turns a <g> of shapes into a native group (14)', () => {
    const groups = Object.values(d.groups);
    expect(groups).toHaveLength(1);
    const names = groups[0].memberIds.map((id) => d.nodes[id].text).sort();
    expect(names).toEqual(['Invoice', 'Ship']);
    expect(groups[0].name).toBe('fulfil');
  });

  it('records unsupported things instead of dropping them silently (19)', () => {
    expect(report.entries.some((e) => e.category === 'unsupported' && /image/i.test(e.message))).toBe(true);
    expect(report.entries.some((e) => e.category === 'converted')).toBe(true);
  });

  it('generates lint-clean LaTeX through the existing generator', () => {
    const out = generateLatex(d);
    expect(out.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(lintLatex(out.code, { standalone: true }).problems).toEqual([]);
    expect(out.code).toContain('shape=diamond');
    expect(out.code).toContain('In stock?');
  });
});

describe('SVG to native diagram: draw.io-style export without embedded source', () => {
  const { d, report } = importSvg(TEXT.drawioPlainSvg);

  it('recognises separately drawn arrowheads and extends the line to the tip', () => {
    const edges = Object.values(d.edges);
    expect(edges).toHaveLength(4);
    expect(edges.every((e) => e.arrowEnd === 'stealth')).toBe(true);
    expect(edges.every((e) => e.source.nodeId && e.target.nodeId)).toBe(true);
    expect(report.entries.some((e) => /arrowheads drawn as separate shapes/.test(e.message))).toBe(true);
  });

  it('recognises compound symbols from body + inner strokes', () => {
    expect(byText(d, 'DB')!.kind).toBe('database');
    expect(byText(d, 'Subroutine')!.kind).toBe('predefined');
    expect(byText(d, 'Start')!.kind).toBe('terminator');
    expect(byText(d, 'Valid?')!.kind).toBe('decision');
  });

  it('uses the <switch> text fallback for HTML labels and attaches edge labels', () => {
    expect(byText(d, 'Process')).toBeTruthy();
    const labels = Object.values(d.edges).map((e) => e.label?.text).filter(Boolean).sort();
    expect(labels).toEqual(['No', 'Yes']);
  });
});

describe('SVG edge cases', () => {
  it('fails cleanly on invalid SVG (17)', () => {
    expect(() => importSvg('<svg><rect></svg>')).toThrow();
    expect(() => importSvg('<svg width="10" height="10"></svg>')).toThrow(/valid diagram/);
  });

  it('turns a skewed rectangle and an unknown polygon into exact outlines', () => {
    const { d } = importSvg(
      svg(
        '<rect x="10" y="10" width="80" height="40" transform="skewX(20)" fill="#ffcc00" stroke="#000"/>' +
          '<polygon points="200,20 260,30 280,90 230,120 190,70" fill="#aaddff" stroke="#000"/>',
      ),
    );
    const kinds = Object.values(d.nodes).map((n) => n.kind);
    expect(kinds).toEqual(['freeform', 'freeform']);
    for (const n of Object.values(d.nodes)) {
      expect(n.path!.length).toBeGreaterThan(3);
      for (const s of n.path!) if (s.c !== 'Z') expect(s.p.x).toBeGreaterThanOrEqual(-0.01);
    }
    // And the TikZ receives the exact path.
    const code = generateLatex(d).code;
    expect(code).toMatch(/\\draw\[fcpath/);
    expect(lintLatex(code, { standalone: true }).problems).toEqual([]);
  });

  it('matches polygons that are native symbols', () => {
    const { d } = importSvg(
      svg('<polygon points="60,10 110,40 60,70 10,40" fill="#fff" stroke="#000"/><polygon points="150,20 260,20 240,60 130,60" fill="#fff" stroke="#000"/>'),
    );
    expect(Object.values(d.nodes).map((n) => n.kind).sort()).toEqual(['decision', 'io']);
  });

  it('resolves <use>, nested viewBox scaling and unit lengths', () => {
    const { d } = importSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200mm" height="100mm" viewBox="0 0 200 100">
        <defs><rect id="box" width="40" height="20" fill="#fff" stroke="#000"/></defs>
        <use xlink:href="#box" x="10" y="10"/><use href="#box" x="100" y="50"/>
      </svg>`,
    );
    const nodes = Object.values(d.nodes);
    expect(nodes).toHaveLength(2);
    // 1 user unit = 1 mm = 3.7795 px.
    expect(nodes[0].w).toBeCloseTo(40 * 3.7795, 0);
  });

  it('skips hidden elements and counts them', () => {
    const { d, report } = importSvg(svg('<rect width="10" height="10" fill="#000"/><rect x="20" width="10" height="10" style="display:none"/><rect x="40" width="10" height="10" visibility="hidden"/>'));
    expect(Object.keys(d.nodes)).toHaveLength(1);
    expect(report.entries.some((e) => /hidden elements/.test(e.message))).toBe(true);
  });

  it('turns a curved open path into a curved connector', () => {
    const { d } = importSvg(
      svg('<rect x="10" y="100" width="60" height="40" fill="#fff" stroke="#000"/><rect x="300" y="100" width="60" height="40" fill="#fff" stroke="#000"/><path d="M 70 120 Q 185 20 300 120" fill="none" stroke="#000" marker-end="url(#m)"/><marker id="m"><path d="M0 0 L10 5 L0 10 Z"/></marker>'),
    );
    const e = Object.values(d.edges)[0];
    expect(e.routing).toBe('curved');
    // The quadratic's control point is 100 px above the chord's midpoint; the
    // model measures bend along the left-of-travel normal, so upward is negative.
    expect(e.bend).toBeCloseTo(-100, 0);
    expect(e.source.nodeId && e.target.nodeId).toBeTruthy();
  });
});

describe('IR -> SVG -> IR round trip (the image pipeline\'s SVG stage)', () => {
  it('is lossless for semantics, styles, text and connectors', () => {
    const report = new ReportBuilder();
    const ir = validateIR(
      {
        canvas: { width: 500, height: 400 },
        objects: [
          { id: 'a', shape: 'terminator', x: 10, y: 10, w: 120, h: 40, z: 0, text: { content: 'Start', bold: true, fontSize: 13, confidence: 0.9 }, style: { fill: '#d5e8d4', stroke: '#82b366', strokeWidth: 2, shadow: true } },
          { id: 'b', shape: 'diamond', x: 20, y: 100, w: 100, h: 80, z: 1, rotation: 10, text: { content: 'Ok?\nreally' }, style: { fill: '#fff2cc', stroke: '#d6b656', dash: 'dashed', gradient: { type: 'linear', from: '#ffffff', to: '#ffcc00', angle: 90 } } },
          { id: 'c', shape: 'polygon', x: 0, y: 0, w: 1, h: 1, z: 2, path: [{ c: 'M', p: { x: 300, y: 50 } }, { c: 'L', p: { x: 380, y: 60 } }, { c: 'L', p: { x: 350, y: 120 } }, { c: 'Z' }], style: { fill: 'none', stroke: '#c0392b' } },
          { id: 't', shape: 'text', x: 200, y: 300, w: 80, h: 20, z: 3, text: { content: 'Note & <tag>', align: 'left', italic: true } },
        ],
        connectors: [
          { id: 'k', source: { objectId: 'a', port: 's' }, target: { objectId: 'b' }, points: [{ x: 70, y: 50 }, { x: 70, y: 100 }], arrowEnd: 'stealth', z: 4, label: { text: 'go', position: 0.3 } },
          { id: 'k2', source: { objectId: 'b' }, target: { objectId: 'c' }, points: [{ x: 120, y: 140 }, { x: 330, y: 140 }, { x: 330, y: 95 }], routing: 'orthogonal', rounded: true, arrowStart: 'circle', arrowEnd: 'open-diamond', z: 5, style: { stroke: '#123456', strokeWidth: 3, dash: 'dotted' } },
        ],
        groups: [{ id: 'g', memberIds: ['a', 'b'] }],
      },
      { report },
    );
    const back = svgToIR(irToSvg(ir), { report: new ReportBuilder() });
    const strip = (x: unknown) => JSON.parse(JSON.stringify(x));
    expect(strip(back.objects)).toEqual(strip(ir.objects));
    expect(strip(back.connectors)).toEqual(strip(ir.connectors));
    expect(back.groups).toEqual(ir.groups);
  });

  it('produces the same bytes for the same input', () => {
    const report = new ReportBuilder();
    const ir = svgToIR(TEXT.flowchartSvg, { report });
    expect(irToSvg(ir)).toBe(irToSvg(ir));
    expect(irToSvg(ir)).not.toMatch(/<script|on\w+=/);
  });

  it('draws what the connector router draws (sanity: routes resolve)', () => {
    const { d } = importSvg(TEXT.flowchartSvg);
    for (const e of Object.values(d.edges)) expect(routeEdge(d, e)).not.toBeNull();
  });
});
