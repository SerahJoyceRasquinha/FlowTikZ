import type { Node, Point } from '../model/types';
import type { ChartSpec } from '../charts/types';
import { chartTypeLabel } from '../charts/types';
import {
  CartesianLayout,
  ChartLayout,
  LegendItem,
  LLegend,
  LText,
  PieLayout,
  layoutChart,
} from '../charts/layout';
import { aggLabel } from '../charts/aggregate';
import { formatNumber, formatOf } from '../charts/format';
import { ColorRegistry } from './colors';
import { escapeComment, escapeLatex } from './escape';
import { UnitContext, coord, cm, fmt, toPt } from './units';
import { dashOption } from './styles';
import { latexId } from '../model/ids';
import type { EmitResult } from './nodes';

/**
 * PGFPlots / TikZ output for a data chart.
 *
 * Everything is translated from `layoutChart`, the same object the canvas
 * draws, so the compiled figure has the canvas's plot rectangle, ranges,
 * ticks, bar geometry, colours and label positions:
 *
 *  - the axis is pinned to the plot rectangle (`scale only axis` plus an
 *    explicit `at`/`width`/`height`) and every range and tick is explicit,
 *    so PGFPlots never chooses anything on its own;
 *  - colours go through the document's shared `\definecolor` registry;
 *  - tick labels are the exact strings shown on the canvas;
 *  - titles, legend entries and data labels are nodes whose anchor and box
 *    (`text height` / `text depth`) are fixed, matching the canvas layout.
 *
 * The data itself - category names and aggregated values, or raw points -
 * is written into the `\addplot` coordinates, so the code needs nothing else
 * to compile: no spreadsheet, no external table file.
 */

export const PGFPLOTS_COMPAT = '1.18';

/** Preamble styles shared by every chart; emitted once when a chart exists. */
export function chartStyleDefinitions(): string[] {
  return [
    '\\tikzset{',
    '  fctext/.style={inner sep=0pt, outer sep=0pt, align=center,',
    '    font=\\fontsize{#1pt}{#1pt}\\selectfont\\sffamily,',
    '    text height={0.7*#1pt}, text depth={0.2*#1pt}},',
    '  fctextb/.style={fctext=#1, font=\\fontsize{#1pt}{#1pt}\\selectfont\\sffamily\\bfseries},',
    '}',
  ];
}

interface Ctx {
  node: Node;
  unit: UnitContext;
  colors: ColorRegistry;
  comments: boolean;
}

const toWorld = (c: Ctx, p: Point): Point => ({ x: c.node.x + p.x, y: c.node.y + p.y });
const at = (c: Ctx, x: number, y: number) => coord(toWorld(c, { x, y }), c.unit);
const pt = (c: Ctx, du: number) => fmt(toPt(du, c.unit));
const num = (v: number) => fmt(Math.round(v * 1e6) / 1e6);

/** Data value as written in coordinates: plain decimal, never exponent-less garbage. */
function dataNum(v: number): string {
  if (!Number.isFinite(v)) return '0';
  if (Math.abs(v) >= 1e15 || (Math.abs(v) < 1e-6 && v !== 0)) return v.toExponential(6).replace(/\.?0+e/, 'e');
  const r = Math.round(v * 1e6) / 1e6;
  return String(r);
}

function esc(text: string): string {
  return escapeLatex(text).text;
}

function textOpts(c: Ctx, t: LText): string[] {
  const opts = [`${t.bold ? 'fctextb' : 'fctext'}=${pt(c, t.size)}`, `text=${c.colors.use(t.color)}`, `anchor=${t.anchor}`];
  if (t.rotate) opts.push(`rotate=${fmt(t.rotate)}`);
  return opts;
}

function emitText(c: Ctx, t: LText, indent = ''): string {
  return `${indent}\\node[${textOpts(c, t).join(', ')}] at ${at(c, t.x, t.y)} {${esc(t.text)}};`;
}

function markName(m: string): string {
  switch (m) {
    case 'square':
      return 'square*';
    case 'triangle':
      return 'triangle*';
    case 'diamond':
      return 'diamond*';
    default:
      return '*';
  }
}

function lineDash(c: Ctx, dash: string, width: number): string[] {
  if (dash === 'dashed' || dash === 'dotted') return dashOption(dash, width, c.unit);
  return [];
}

/* ------------------------------------------------------------- legend */

function emitLegend(c: Ctx, lg: LLegend, out: string[]) {
  if (c.comments) out.push('% Legend');
  out.push(`\\filldraw[fill=${c.colors.use(lg.fill)}, draw=${c.colors.use(lg.border)}, line width=${pt(c, 0.8)}pt] ${at(c, lg.x, lg.y)} rectangle ${at(c, lg.x + lg.w, lg.y + lg.h)};`);
  for (const it of lg.items) {
    out.push(...emitSwatch(c, it));
    out.push(emitText(c, it.text));
  }
}

function emitSwatch(c: Ctx, it: LegendItem): string[] {
  const color = c.colors.use(it.color);
  if (it.kind === 'box') {
    const box = `${at(c, it.sx, it.sy)} rectangle ${at(c, it.sx + it.sw, it.sy + it.sh)}`;
    if (it.outline) {
      return [`\\filldraw[fill=${color}, draw=${c.colors.use(it.outline)}, line width=${pt(c, 0.8)}pt] ${box};`];
    }
    return [`\\fill[${color}] ${box};`];
  }
  const lines: string[] = [];
  const cy = it.sy;
  if (it.kind === 'line') {
    lines.push(
      `\\draw[${[color, `line width=${pt(c, it.lineWidth)}pt`, ...lineDash(c, it.dash, it.lineWidth)].join(', ')}] ${at(c, it.sx, cy)} -- ${at(c, it.sx + it.sw, cy)};`,
    );
  }
  if (it.mark !== 'none') {
    const mx = it.kind === 'line' ? it.sx + it.sw / 2 : it.sx + it.sw / 2;
    const my = it.kind === 'line' ? cy : it.sy + it.sh / 2;
    lines.push(
      `\\path plot[mark=${markName(it.mark)}, mark size=${pt(c, it.markSize)}pt, mark options={solid, draw=${color}, fill=${color}}] coordinates {${at(c, mx, my)}};`,
    );
  }
  return lines;
}

/* ---------------------------------------------------------- cartesian */

function axisDescription(l: CartesianLayout, t: LText): string {
  const fx = (t.x - l.plot.x) / l.plot.w;
  const fy = (l.plot.y + l.plot.h - t.y) / l.plot.h;
  return `at={(axis description cs:${num(fx)},${num(fy)})}`;
}

function tickList(ticks: { v: number }[]): string {
  return ticks.map((t) => dataNum(t.v)).join(',');
}

function tickLabels(ticks: { label: string }[]): string {
  return ticks.map((t) => `{${esc(t.label)}}`).join(',');
}

function emitCartesian(c: Ctx, l: CartesianLayout, out: string[]) {
  const axisColor = c.colors.use(l.axisColor);
  const textColor = c.colors.use(l.textColor);
  const fsPt = pt(c, l.fontSize);
  const opts: string[] = [];

  opts.push(`name=${latexId(c.node.id)}axis`);
  // Explicit units: inside an axis's options a bare (x,y) is not read in cm.
  const corner = toWorld(c, { x: l.plot.x, y: l.plot.y + l.plot.h });
  const cx = fmt(cm(corner.x - c.unit.originX, c.unit));
  const cy = fmt(cm(-(corner.y - c.unit.originY), c.unit));
  opts.push(`at={(${cx}cm,${cy}cm)}`, 'anchor=south west');
  opts.push('scale only axis', `width=${fmt(cm(l.plot.w, c.unit))}cm`, `height=${fmt(cm(l.plot.h, c.unit))}cm`);
  opts.push(`xmin=${dataNum(l.xRange.min)}`, `xmax=${dataNum(l.xRange.max)}`);
  opts.push(`ymin=${dataNum(l.yRange.min)}`, `ymax=${dataNum(l.yRange.max)}`);
  opts.push('enlargelimits=false', 'clip=false', 'scaled ticks=false');
  opts.push(`xtick={${tickList(l.xTicks)}}`, `xticklabels={${tickLabels(l.xTicks)}}`);
  opts.push(`ytick={${tickList(l.yTicks)}}`, `yticklabels={${tickLabels(l.yTicks)}}`);
  opts.push('minor tick num=0', 'tick pos=left', 'tick align=outside');
  opts.push(`major tick length=${pt(c, l.tickLen)}pt`);
  opts.push(`tick style={draw=${axisColor}, line width=${pt(c, l.axisWidth)}pt}`);
  opts.push(`axis line style={draw=${axisColor}, line width=${pt(c, l.axisWidth)}pt}`);
  if (l.axisLines === 'left') opts.push('axis x line*=bottom', 'axis y line*=left');
  opts.push(`tick label style={fctext=${fsPt}, text=${textColor}}`);
  // PGFPlots already moves labels out by the tick length when ticks point outward.
  const gap = pt(c, l.tickLabelGap - l.tickLen);
  const xRot = l.xTickRotate ? `, rotate=${l.xTickRotate}` : '';
  // The shift comes before the rotation so it moves the label straight down.
  opts.push(`xticklabel style={anchor=${l.xTickAnchor}, yshift=-${gap}pt${xRot}}`);
  opts.push(`yticklabel style={anchor=${l.yTickAnchor}, xshift=-${gap}pt}`);
  if (l.grid.x) opts.push('xmajorgrids=true');
  if (l.grid.y) opts.push('ymajorgrids=true');
  if (l.grid.x || l.grid.y) {
    opts.push(`major grid style={draw=${c.colors.use(l.grid.color)}, line width=${pt(c, Math.max(0.5, l.axisWidth * 0.8))}pt}`);
  }

  const barSeries = l.series.filter((s) => s.kind === 'bar');
  const stackedBars = barSeries.length > 1 && barSeries[0].stacked;
  if (stackedBars) {
    opts.push(l.horizontal ? 'xbar stacked' : 'ybar stacked', `bar width=${num(barSeries[0].barWidth)}`);
  }

  for (const t of l.texts) {
    if (t.role === 'title') {
      opts.push(`title={${esc(t.text)}}`);
      // `yshift=0pt` cancels the 6pt PGFPlots adds to every axis title by default.
      opts.push('every axis title shift=0pt');
      opts.push(`title style={${textOpts(c, t).join(', ')}, yshift=0pt, ${axisDescription(l, t)}}`);
    } else if (t.role === 'x-title') {
      opts.push(`xlabel={${esc(t.text)}}`);
      opts.push(`xlabel style={${textOpts(c, t).join(', ')}, ${axisDescription(l, t)}}`);
    } else if (t.role === 'y-title') {
      opts.push(`ylabel={${esc(t.text)}}`);
      opts.push(`ylabel style={${textOpts(c, t).filter((o) => !o.startsWith('rotate')).join(', ')}, rotate=0, ${axisDescription(l, t)}}`);
    }
  }

  out.push('\\begin{axis}[');
  opts.forEach((o, i) => out.push(`  ${o}${i === opts.length - 1 ? '' : ','}`));
  out.push(']');

  for (const s of l.series) {
    const color = c.colors.use(s.color);
    const so: string[] = [];
    const points = s.points;
    if (c.comments) out.push(`% Series: ${escapeComment(s.name)}`);
    const coordLine = (x: number, y: number, tag: string) =>
      `(${dataNum(x)},${dataNum(y)})${c.comments ? ` % ${escapeComment(tag)}` : ''}`;
    const emitCoords = (list: string[], tail = '') => {
      if (c.comments) {
        out.push('  coordinates {');
        for (const ln of list) out.push(`    ${ln}`);
        out.push(`  }${tail};`);
      } else {
        out.push(`  coordinates {${list.join(' ')}}${tail};`);
      }
    };

    if (s.kind === 'bar') {
      if (!stackedBars) {
        so.push(l.horizontal ? 'xbar' : 'ybar', `bar width=${num(s.barWidth)}`, `bar shift=${num(s.barShift)}`);
      }
      so.push(`fill=${color}`);
      so.push(s.outline ? `draw=${c.colors.use(s.outline)}` : 'draw=none');
      if (s.outline) so.push(`line width=${pt(c, s.outlineWidth)}pt`);
      out.push(`\\addplot[${so.join(', ')}]`);
      // Stacked plots receive the segment's own value; PGFPlots does the stacking.
      // Coordinates sit on the category position; `bar shift` moves the bar
      // sideways, exactly as the layout did.
      const list = points.map((p) => {
        const v = stackedBars ? p.value : p.y;
        const cat = p.x - s.barShift;
        return l.horizontal ? coordLine(v, cat, p.tag) : coordLine(cat, v, p.tag);
      });
      emitCoords(list);
    } else if (s.kind === 'area') {
      // The filled band (between the stack below and this series), then its top line.
      const fill = [`fill=${color}`, 'draw=none', 'forget plot'];
      if (s.fillOpacity < 1) fill.push(`fill opacity=${fmt(s.fillOpacity)}`);
      out.push(`\\addplot[${fill.join(', ')}]`);
      const top = points.map((p) => coordLine(p.x, p.y, `${p.tag}${s.stacked ? ' (stacked)' : ''}`));
      const base = [...points].reverse().map((p) => coordLine(p.x, Math.max(p.y0, l.yRange.min), `${p.tag} base`));
      emitCoords([...top, ...base], ' -- cycle');
      const lo = [color, `line width=${pt(c, s.lineWidth)}pt`, ...lineDash(c, s.dash, s.lineWidth)];
      if (s.mark === 'none') lo.push('mark=none');
      else lo.push(`mark=${markName(s.mark)}`, `mark size=${pt(c, s.markSize)}pt`, `mark options={solid, fill=${color}}`);
      out.push(`\\addplot[${lo.join(', ')}]`);
      emitCoords(points.map((p) => coordLine(p.x, p.y, p.tag)));
    } else if (s.kind === 'line') {
      const lo = [color, `line width=${pt(c, s.lineWidth)}pt`, ...lineDash(c, s.dash, s.lineWidth)];
      if (s.mark === 'none') lo.push('mark=none');
      else lo.push(`mark=${markName(s.mark)}`, `mark size=${pt(c, s.markSize)}pt`, `mark options={solid, fill=${color}}`);
      out.push(`\\addplot[${lo.join(', ')}]`);
      emitCoords(points.map((p) => coordLine(p.x, p.y, p.tag)));
    } else {
      const lo = ['only marks', `mark=${markName(s.mark)}`, `mark size=${pt(c, s.markSize)}pt`, `mark options={draw=${color}, fill=${color}}`];
      out.push(`\\addplot[${lo.join(', ')}]`);
      emitCoords(points.map((p) => coordLine(p.x, p.y, p.tag)));
    }
  }
  out.push('\\end{axis}');

  const labels = l.series.flatMap((s) => s.labels);
  if (labels.length) {
    if (c.comments) out.push('% Data labels');
    for (const t of labels) out.push(emitText(c, t));
  }
  if (l.legend) emitLegend(c, l.legend, out);
}

/* ---------------------------------------------------------------- pie */

function emitPie(c: Ctx, l: PieLayout, out: string[]) {
  for (const t of l.texts) out.push(emitText(c, t));
  const centre = at(c, l.cx, l.cy);
  const r = fmt(cm(l.r, c.unit));
  const ri = fmt(cm(l.inner, c.unit));
  const pointOn = (radius: number, deg: number) => {
    const a = (deg * Math.PI) / 180;
    return at(c, l.cx + radius * Math.sin(a), l.cy - radius * Math.cos(a));
  };
  for (const s of l.slices) {
    const color = c.colors.use(s.color);
    const draw = l.outline ? `filldraw[fill=${color}, draw=${c.colors.use(l.outline)}, line width=${pt(c, l.outlineWidth)}pt` : `fill[${color}`;
    const cmd = `\\${draw}]`;
    if (c.comments) out.push(`% ${escapeComment(s.name)}: ${dataNum(s.value)}`);
    const a0 = 90 - s.start;
    const a1 = 90 - s.end;
    const full = s.end - s.start >= 359.999;
    if (l.inner > 0) {
      if (full) {
        out.push(`${cmd.replace(']', ', even odd rule]')} ${centre} circle[radius=${r}cm] ${centre} circle[radius=${ri}cm];`);
      } else {
        out.push(
          `${cmd} ${pointOn(l.r, s.start)} arc[start angle=${fmt(a0)}, end angle=${fmt(a1)}, radius=${r}cm] -- ${pointOn(l.inner, s.end)} arc[start angle=${fmt(a1)}, end angle=${fmt(a0)}, radius=${ri}cm] -- cycle;`,
        );
      }
    } else if (full) {
      out.push(`${cmd} ${centre} circle[radius=${r}cm];`);
    } else {
      out.push(`${cmd} ${centre} -- ${pointOn(l.r, s.start)} arc[start angle=${fmt(a0)}, end angle=${fmt(a1)}, radius=${r}cm] -- cycle;`);
    }
  }
  const labels = l.slices.map((s) => s.label).filter((x): x is LText => !!x);
  if (labels.length) {
    if (c.comments) out.push('% Slice labels');
    for (const t of labels) out.push(emitText(c, t));
  }
  if (l.legend) emitLegend(c, l.legend, out);
}

/* --------------------------------------------------------------- entry */

function dataComment(spec: ChartSpec, l: ChartLayout): string[] {
  const lines: string[] = [];
  const t = spec.data;
  const filters = spec.filters.filter((f) => (f.include && f.include.length) || f.min != null || f.max != null);
  lines.push(`% Data: ${escapeComment(t.name)} (${l.result.rowCount} of ${t.rows.length} rows used${filters.length ? `, filtered on ${filters.map((f) => escapeComment(f.field)).join(', ')}` : ''})`);
  const wells: string[] = [];
  if (spec.x) wells.push(`${spec.type === 'scatter' ? 'X' : spec.type === 'histogram' ? 'Field' : 'Axis'} = ${escapeComment(spec.x)}`);
  if (spec.type === 'scatter' && spec.values[0]?.field) wells.push(`Y = ${escapeComment(spec.values[0].field)}`);
  else if (spec.type !== 'histogram' && spec.values.length) wells.push(`Values = ${spec.values.map((v) => escapeComment(aggLabel(v))).join(', ')}`);
  if (spec.legend && spec.type !== 'pie' && spec.type !== 'donut' && spec.type !== 'histogram') wells.push(`Legend = ${escapeComment(spec.legend)}`);
  if (wells.length) lines.push(`% ${wells.join('; ')}`);

  const r = l.result;
  if (r.kind === 'category' && r.categories.length) {
    const fmtv = formatOf(spec.style);
    const header = [r.categoryLabel, ...r.series.map((s) => s.name)];
    const rows = r.categories.slice(0, 40).map((cat, i) => [cat, ...r.series.map((s) => (s.values[i] === null ? '-' : formatNumber(s.values[i]!, { ...fmtv, prefix: '', suffix: '', compact: false }, 4)))]);
    const widths = header.map((h, ci) => Math.min(24, Math.max(h.length, ...rows.map((row) => row[ci].length))));
    const fmtRow = (row: string[]) => `%   ${row.map((cell, ci) => cell.slice(0, 24).padEnd(widths[ci])).join(' | ')}`.trimEnd();
    lines.push(escapeComment(fmtRow(header)).replace(/^\\%/, '%'));
    for (const row of rows) lines.push(escapeComment(fmtRow(row)).replace(/^\\%/, '%'));
    if (r.categories.length > 40) lines.push(`%   ... ${r.categories.length - 40} more`);
  }
  return lines;
}

export function emitChart(
  n: Node,
  unit: UnitContext,
  colors: ColorRegistry,
  comments: boolean,
): EmitResult {
  const spec = n.chart!;
  const c: Ctx = { node: n, unit, colors, comments };
  const out: string[] = [];
  const warnings: string[] = [];
  const l = layoutChart(spec, n.w, n.h);

  const titleText = l.kind === 'empty' ? '' : (l.texts.find((t) => t.role === 'title')?.text ?? '');
  out.push(`% ${n.id} - ${chartTypeLabel(spec.type)} chart${titleText ? ` "${escapeComment(titleText.slice(0, 60))}"` : ''}`);
  if (comments) out.push(...dataComment(spec, l));
  for (const w of l.warnings) warnings.push(`${n.id}: ${w}`);
  if (n.rotation) warnings.push(`${n.id}: charts are not rotated in the LaTeX output.`);

  // Escaping problems (characters pdfLaTeX cannot set) are reported once per chart.
  const risky = new Set<string>();
  const check = (s: string) => escapeLatex(s).risky.forEach((ch) => risky.add(ch));

  if (l.kind === 'empty') {
    out.push(`% (chart is empty: ${escapeComment(l.message)})`);
    out.push(`\\coordinate (${latexId(n.id)}) at ${coord({ x: n.x + n.w / 2, y: n.y + n.h / 2 }, unit)};`);
    warnings.push(`${n.id}: ${l.message}`);
    return { lines: out, warnings };
  }

  out.push('\\begin{scope}');
  if (l.background) {
    out.push(`\\fill[${colors.use(l.background)}] ${at(c, 0, 0)} rectangle ${at(c, l.w, l.h)};`);
  }
  const body: string[] = [];
  if (l.kind === 'cartesian') {
    for (const t of [...l.xTicks, ...l.yTicks]) check(t.label);
    emitCartesian(c, l, body);
  } else {
    emitPie(c, l, body);
  }
  for (const t of l.texts) check(t.text);
  if (l.legend) for (const it of l.legend.items) check(it.name);
  out.push(...body);
  out.push(`\\coordinate (${latexId(n.id)}) at ${coord({ x: n.x + n.w / 2, y: n.y + n.h / 2 }, unit)};`);
  out.push('\\end{scope}');
  if (risky.size) {
    warnings.push(`${n.id}: characters ${[...risky].join(' ')} may need XeLaTeX/LuaLaTeX or extra packages.`);
  }
  return { lines: out, warnings };
}
