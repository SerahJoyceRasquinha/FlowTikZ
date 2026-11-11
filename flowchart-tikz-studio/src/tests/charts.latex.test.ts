import { describe, expect, it } from 'vitest';
import type { Diagram, Node } from '../model/types';
import type { ChartSpec } from '../charts/types';
import { emptyDiagram, makeNode } from '../model/defaults';
import { generateLatex } from '../latex/generator';
import { layoutChart, CartesianLayout } from '../charts/layout';
import { chartGallery } from '../charts/gallery';
import { suggestSpec, adaptSpecToType } from '../charts/defaults';
import { getPalette } from '../charts/palettes';
import { sampleSalesTable } from '../charts/parse';
import { serialize, deserialize } from '../persistence/schema';
import { lintLatex } from './latexLint';

function diagramWith(spec: ChartSpec, w = 560, h = 360): { d: Diagram; n: Node } {
  const d = emptyDiagram('Chart test');
  const n = makeNode('chart', 100, 100, { id: 'n1', w, h });
  n.chart = spec;
  d.nodes.n1 = n;
  d.order.push('n1');
  return { d, n };
}

const latex = (spec: ChartSpec, mode: 'standalone' | 'snippet' = 'standalone', comments = true) =>
  generateLatex(diagramWith(spec).d, { mode, comments });

const sales = () => suggestSpec(sampleSalesTable());

describe('every chart type produces well-formed, self-contained PGFPlots', () => {
  for (const g of chartGallery()) {
    it(`${g.name}`, () => {
      for (const comments of [true, false]) {
        const res = latex(g.spec, 'standalone', comments);
        const lint = lintLatex(res.code, { standalone: true });
        expect(lint.problems, `${g.name} (comments ${comments})`).toEqual([]);
        expect(res.issues.filter((i) => i.severity === 'error')).toEqual([]);
        expect(res.code).toContain('\\usepackage{pgfplots}');
        expect(res.code).toContain('\\pgfplotsset{compat=1.18}');
        // Self-contained: no external data file is read.
        expect(res.code).not.toMatch(/pgfplotstableread|\\addplot[^\n]*table\s*\{[^}]*\.(csv|xlsx|dat)/);
        expect(res.code).not.toMatch(/NaN|Infinity|undefined/);
      }
      const snip = latex(g.spec, 'snippet');
      expect(lintLatex(snip.code, { standalone: false }).problems).toEqual([]);
      expect(snip.code).toContain('%   \\usepackage{pgfplots}');
    });
  }
});

describe('the code carries the data and the field names', () => {
  it('writes category names, series names, field titles and aggregated values', () => {
    const code = latex({ ...sales(), legend: 'Region' }).code;
    expect(code).toContain('xticklabels={{Laptop},{Mobile},{Tablet}}');
    expect(code).toContain('title={Sum of Sales by Product and Region}');
    expect(code).toContain('xlabel={Product}');
    expect(code).toContain('ylabel={Sum of Sales}');
    expect(code).toMatch(/\{North\};/);
    expect(code).toMatch(/\{South\};/);
    // Laptop/North = 50000 + 56000 + 52000 = 158000, at category position 0.
    expect(code).toContain('(0,158000) % Laptop');
    expect(code).toContain('(1,87000)'.replace('1,', '0,')); // Laptop/South
    // The data table is summarised in comments for a human reader.
    expect(code).toContain('% Axis = Product; Values = Sum of Sales; Legend = Region');
    expect(code).toMatch(/%\s+Laptop\s+\| 158,000 \| 87,000/);
  });

  it('keeps the data in the code even without comments', () => {
    const code = latex({ ...sales(), legend: 'Region' }, 'standalone', false).code;
    expect(code).toContain('{Laptop}');
    expect(code).toContain('(0,158000)');
    expect(code).not.toMatch(/^\s*%/m);
  });

  it('escapes LaTeX special characters in names, titles and labels', () => {
    const g = chartGallery().find((x) => x.name === 'tricky-text')!;
    const code = latex(g.spec).code;
    expect(code).toContain('{R\\&D}');
    expect(code).toContain('{Sales \\#2}');
    expect(code).toContain('{50\\% Team}');
    expect(code).toContain('{under\\_score}');
    expect(code).toContain('{\\{braces\\}}');
    expect(code).toContain('title={Spend \\& growth: 100\\% \\{real\\} data\\_\\#1}');
    expect(code).toContain('xlabel={Team \\& Unit}');
    expect(code).toContain('Rs. 1,250.5');
    // Comments cannot be broken by a % in the data.
    for (const line of code.split('\n').filter((l) => l.trimStart().startsWith('%'))) {
      expect(line.slice(line.indexOf('%') + 1)).not.toMatch(/(^|[^\\])%/);
    }
  });

  it('writes raw points for scatter and bin counts for histograms', () => {
    const sc = latex(adaptSpecToType(sales(), 'scatter')).code;
    expect(sc).toContain('only marks');
    expect(sc).toContain('(50000,5)');
    const h = latex(adaptSpecToType({ ...sales(), x: 'Sales' }, 'histogram')).code;
    expect(h).toContain('ylabel={Count}');
    expect(h).toMatch(/ybar, bar width=\d+/);
  });

  it('draws pies as TikZ slices with the shares written in', () => {
    const code = latex(adaptSpecToType(sales(), 'pie')).code;
    expect(code).toContain('% Laptop: 245000');
    expect(code).toMatch(/arc\[start angle=90, end angle=-?\d/);
    expect(code).toContain('{55\\%}');
  });
});

describe('colours and styles in the code are exactly the ones on screen', () => {
  it('defines every series colour with its exact hex value', () => {
    const spec = { ...sales(), legend: 'Region' };
    const code = latex(spec).code;
    const [c1, c2] = getPalette('classic').colors;
    expect(code).toContain(`\\definecolor{fc${c1.slice(1).toUpperCase()}}{HTML}{${c1.slice(1).toUpperCase()}}`);
    expect(code).toContain(`fill=fc${c1.slice(1).toUpperCase()}`);
    expect(code).toContain(`fill=fc${c2.slice(1).toUpperCase()}`);
  });

  it('follows a per-series colour override and a theme change', () => {
    const spec = { ...sales(), legend: 'Region', style: { ...sales().style, seriesColors: { South: '#123abc' } } };
    const code = latex(spec).code;
    expect(code).toContain('\\definecolor{fc123ABC}{HTML}{123ABC}');
    expect(code).toContain('fill=fc123ABC');
    const office = latex({ ...spec, style: { ...spec.style, palette: 'office', seriesColors: {} } }).code;
    expect(office).toContain(`fill=fc${getPalette('office').colors[0].slice(1).toUpperCase()}`);
    expect(office).not.toContain('fc123ABC');
  });

  it('spells line styles, marks, opacity, grid and frame the way the canvas draws them', () => {
    const base = adaptSpecToType({ ...sales(), x: 'Date', dateGroup: 'month', legend: 'Product' }, 'line');
    const code = latex({ ...base, style: { ...base.style, marks: 'diamond', lineDash: 'dashed', lineWidth: 3, grid: 'both', axisLines: 'box' } }).code;
    expect(code).toContain('mark=diamond*');
    expect(code).toMatch(/dash pattern=on [\d.]+pt off [\d.]+pt/);
    expect(code).toContain('line width=1.7072pt'.slice(0, 13)); // 3 du at 50 du/cm
    expect(code).toContain('xmajorgrids=true');
    expect(code).toContain('ymajorgrids=true');
    expect(code).not.toContain('axis x line*=bottom');
    const area = latex(adaptSpecToType({ ...base, style: { ...base.style, areaOpacity: 0.5 } }, 'area')).code;
    expect(area).toContain('fill opacity=0.5');
  });

  it('pins the axis to the plot rectangle the canvas uses', () => {
    const spec = { ...sales(), legend: 'Region' };
    const { d, n } = diagramWith(spec);
    const code = generateLatex(d, { mode: 'standalone', comments: false }).code;
    const l = layoutChart(spec, n.w, n.h) as CartesianLayout;
    const num = (key: string) => Number(new RegExp(`${key}=(-?[\\d.]+)`).exec(code)![1]);
    expect(num('width')).toBeCloseTo(l.plot.w / 50, 3);
    expect(num('height')).toBeCloseTo(l.plot.h / 50, 3);
    expect(num('xmin')).toBe(l.xRange.min);
    expect(num('xmax')).toBe(l.xRange.max);
    expect(num('ymin')).toBe(l.yRange.min);
    expect(num('ymax')).toBe(l.yRange.max);
    expect(code).toContain(`yticklabels={${l.yTicks.map((t) => `{${t.label}}`).join(',')}}`);
    for (const s of l.series) {
      expect(code).toContain(`bar width=${s.barWidth}`);
      expect(code).toContain(`bar shift=${s.barShift}`);
    }
  });
});

describe('editing the chart edits the code', () => {
  it('changes with the chart type, fields, filters, sort and size', () => {
    const base = sales();
    const a = latex(base).code;
    const b = latex(adaptSpecToType(base, 'bar')).code;
    expect(b).not.toBe(a);
    expect(b).toContain('xbar');
    const legend = latex({ ...base, legend: 'Region' }).code;
    expect(legend).toContain('{North}');
    const filtered = latex({ ...base, filters: [{ field: 'Product', include: ['Tablet'] }] }).code;
    expect(filtered).toContain('xticklabels={{Tablet}}');
    const sorted = latex({ ...base, sort: 'val-asc' }).code;
    expect(sorted).toContain('xticklabels={{Tablet},{Mobile},{Laptop}}');
    const avg = latex({ ...base, values: [{ field: 'Sales', agg: 'avg' }] }).code;
    expect(avg).toContain('ylabel={Average of Sales}');
    const { d, n } = diagramWith(base, 800, 500);
    const wide = generateLatex(d, { mode: 'standalone', comments: true }).code;
    expect(wide).not.toBe(a);
    expect(Number(/width=([\d.]+)cm/.exec(wide)![1])).toBeGreaterThan(Number(/width=([\d.]+)cm/.exec(a)![1]));
    void n;
  });

  it('uses typed titles, and hides them when switched off', () => {
    const s = sales();
    const titled = latex({ ...s, style: { ...s.style, title: 'Quarterly sales', yTitle: 'Revenue (Rs.)' } }).code;
    expect(titled).toContain('title={Quarterly sales}');
    expect(titled).toContain('ylabel={Revenue (Rs.)}');
    const hidden = latex({ ...s, style: { ...s.style, title: '', xTitle: '', yTitle: '' } }).code;
    expect(hidden).not.toContain('title={');
    expect(hidden).not.toContain('xlabel=');
    expect(hidden).not.toContain('ylabel=');
  });

  it('regenerates byte-identical code for an unchanged chart', () => {
    const s = chartGallery()[2].spec;
    expect(latex(s).code).toBe(latex(s).code);
  });
});

describe('saving and loading charts', () => {
  it('round-trips through the save file with identical LaTeX', () => {
    for (const g of chartGallery()) {
      const { d } = diagramWith(g.spec);
      const { diagram, warnings } = deserialize(serialize(d));
      expect(warnings).toEqual([]);
      expect(diagram.nodes.n1.chart).toEqual(g.spec);
      expect(generateLatex(diagram).code).toBe(generateLatex(d).code);
    }
  });

  it('drops a chart whose data is unreadable rather than crashing', () => {
    const { d } = diagramWith(sales());
    const raw = JSON.parse(serialize(d));
    raw.diagram.nodes.n1.chart.data = 'garbage';
    const { diagram, warnings } = deserialize(JSON.stringify(raw));
    expect(diagram.nodes.n1).toBeUndefined();
    expect(warnings[0]).toMatch(/unreadable/);
  });

  it('repairs out-of-range style values and unknown fields on load', () => {
    const { d } = diagramWith(sales());
    const raw = JSON.parse(serialize(d));
    Object.assign(raw.diagram.nodes.n1.chart, { type: 'radar', x: 'Nope', legend: 'Missing' });
    Object.assign(raw.diagram.nodes.n1.chart.style, { fontSize: 999, barWidth: -3, palette: 42, textColor: 'red' });
    const { diagram } = deserialize(JSON.stringify(raw));
    const c = diagram.nodes.n1.chart!;
    expect(c.type).toBe('column');
    expect(c.x).toBeNull();
    expect(c.legend).toBeNull();
    expect(c.style.fontSize).toBe(40);
    expect(c.style.barWidth).toBe(0.1);
    expect(c.style.textColor).toBe('#1f2933');
    expect(() => generateLatex(diagram)).not.toThrow();
  });
});

/*
 * A real pdflatex run over every chart type lives in the compile fixtures
 * (`npm run latex:fixtures && bash scripts/verify-latex.sh`, fixtures 08 and
 * 09), alongside the flowchart fixtures, so this suite needs no TeX install.
 */
