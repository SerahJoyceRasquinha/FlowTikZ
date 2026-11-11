import type { ChartSpec, MarkKind, LineDash } from './types';
import { isCartesian } from './types';
import { computeChart, ChartResult, niceStep, roundClean } from './aggregate';
import { formatNumber, formatOf, decimalsForStep } from './format';
import { contrastText, darken, seriesColor } from './palettes';

/**
 * Chart layout: the single geometric description of a chart.
 *
 * Every position here is in diagram units, local to the chart node's box
 * (origin top-left, y down) - the same coordinate system as the rest of the
 * editor. The canvas renders this object; the PGFPlots emitter translates
 * this object. Neither recomputes anything, so ranges, ticks, bar positions,
 * colours, label text and label anchors are identical on both sides by
 * construction.
 *
 * Text is positioned by TikZ-style anchors on a box whose height and depth
 * are fixed (`TEXT_HEIGHT` / `TEXT_DEPTH` of the font size). The emitter pins
 * the same `text height` / `text depth` on every node, so an anchor means the
 * same point in the browser and in TeX regardless of which glyphs a label has.
 */

export const TEXT_HEIGHT = 0.7;
export const TEXT_DEPTH = 0.2;
/** Average glyph advance as a fraction of the font size (sans serif). */
const CHAR_W = 0.54;
const CHAR_W_BOLD = 0.59;

export type TikzAnchor =
  | 'north'
  | 'south'
  | 'east'
  | 'west'
  | 'center'
  | 'north east'
  | 'north west'
  | 'south east'
  | 'south west';

export interface LText {
  text: string;
  x: number;
  y: number;
  anchor: TikzAnchor;
  size: number;
  bold: boolean;
  /** Degrees counter-clockwise (TikZ convention). */
  rotate: number;
  color: string;
  /** Role, for the emitter's comments. */
  role: 'title' | 'x-title' | 'y-title' | 'data-label' | 'pie-label' | 'legend';
}

export interface LPoint {
  /** Data coordinates: x = category position or number, y = value (top of a stacked segment). */
  x: number;
  y: number;
  /** Base of a stacked segment (bars and stacked areas). */
  y0: number;
  /** Category name or point description, for comments. */
  tag: string;
  value: number;
}

export interface LSeries {
  name: string;
  color: string;
  kind: 'bar' | 'line' | 'area' | 'scatter';
  points: LPoint[];
  /** Bars: width and centre offset, in category-axis data units. */
  barWidth: number;
  barShift: number;
  /** Stroke for bars / areas / slices; null = none. */
  outline: string | null;
  outlineWidth: number;
  lineWidth: number;
  dash: LineDash;
  mark: MarkKind;
  markSize: number;
  fillOpacity: number;
  stacked: boolean;
  /** Data labels for this series, already positioned in local du. */
  labels: LText[];
}

export interface LegendItem {
  name: string;
  color: string;
  /** Swatch style: filled square, or a line with an optional mark. */
  kind: 'box' | 'line' | 'mark';
  mark: MarkKind;
  lineWidth: number;
  markSize: number;
  dash: LineDash;
  outline: string | null;
  /** Swatch geometry, local du. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  text: LText;
}

export interface LLegend {
  x: number;
  y: number;
  w: number;
  h: number;
  border: string;
  fill: string;
  items: LegendItem[];
}

export interface Tick {
  v: number;
  label: string;
}

export interface CartesianLayout {
  kind: 'cartesian';
  w: number;
  h: number;
  background: string | null;
  plot: { x: number; y: number; w: number; h: number };
  /** Categories run up the vertical axis (bar chart). */
  horizontal: boolean;
  /** Ranges of the horizontal and vertical axes, in data units. */
  xRange: { min: number; max: number };
  yRange: { min: number; max: number };
  xTicks: Tick[];
  yTicks: Tick[];
  xTickAnchor: TikzAnchor;
  xTickRotate: number;
  yTickAnchor: TikzAnchor;
  /** Horizontal axis is categorical (ticks are category names). */
  xCategorical: boolean;
  yCategorical: boolean;
  grid: { x: boolean; y: boolean; color: string };
  axisLines: 'box' | 'left';
  axisColor: string;
  axisWidth: number;
  tickLen: number;
  /** Distance from the axis line to the near edge of a tick label. */
  tickLabelGap: number;
  fontSize: number;
  textColor: string;
  series: LSeries[];
  texts: LText[];
  legend: LLegend | null;
  warnings: string[];
  result: ChartResult;
}

export interface PieSlice {
  name: string;
  value: number;
  /** Degrees, clockwise from 12 o'clock. */
  start: number;
  end: number;
  color: string;
  label: LText | null;
}

export interface PieLayout {
  kind: 'pie';
  w: number;
  h: number;
  background: string | null;
  cx: number;
  cy: number;
  r: number;
  inner: number;
  outline: string | null;
  outlineWidth: number;
  slices: PieSlice[];
  texts: LText[];
  legend: LLegend | null;
  warnings: string[];
  result: ChartResult;
}

export interface EmptyLayout {
  kind: 'empty';
  w: number;
  h: number;
  message: string;
  warnings: string[];
  result: ChartResult;
}

export type ChartLayout = CartesianLayout | PieLayout | EmptyLayout;

/* -------------------------------------------------------------- measure */

export function textWidth(text: string, size: number, bold = false): number {
  return [...text].length * size * (bold ? CHAR_W_BOLD : CHAR_W);
}

/** Bounding box (w, h) of a label after rotation. */
function rotatedBox(text: string, size: number, deg: number): { w: number; h: number } {
  const w = textWidth(text, size);
  const h = size * (TEXT_HEIGHT + TEXT_DEPTH);
  const a = (Math.abs(deg) * Math.PI) / 180;
  return { w: w * Math.cos(a) + h * Math.sin(a), h: w * Math.sin(a) + h * Math.cos(a) };
}

/* ---------------------------------------------------------------- ticks */

function valueTicks(
  min: number,
  max: number,
  target: number,
  fixedMin: number | null,
  fixedMax: number | null,
): { min: number; max: number; step: number; ticks: number[] } {
  let lo = fixedMin ?? min;
  let hi = fixedMax ?? max;
  if (!(hi > lo)) {
    const pad = Math.abs(lo) > 0 ? Math.abs(lo) * 0.5 : 1;
    if (fixedMin === null) lo -= pad;
    if (fixedMax === null) hi += pad;
    if (!(hi > lo)) hi = lo + 1;
  }
  const step = niceStep(hi - lo, Math.max(1, target));
  if (fixedMin === null) lo = Math.floor(lo / step + 1e-9) * step;
  if (fixedMax === null) hi = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  const first = Math.ceil(lo / step - 1e-9) * step;
  for (let v = first, i = 0; v <= hi + step * 1e-9 && i < 60; i++, v = first + i * step) {
    ticks.push(roundClean(v));
  }
  return { min: roundClean(lo), max: roundClean(hi), step, ticks };
}

/* ---------------------------------------------------------------- titles */

export function autoTitle(spec: ChartSpec, r: ChartResult): string {
  if (r.kind === 'category') {
    const by = spec.legend && spec.type !== 'pie' && spec.type !== 'donut' ? `${r.categoryLabel} and ${spec.legend}` : r.categoryLabel;
    return `${r.valueLabel} by ${by}`;
  }
  if (r.kind === 'scatter') return `${r.yLabel} vs ${r.xLabel}`;
  if (r.kind === 'histogram') return `Distribution of ${r.label}`;
  return '';
}

export function autoAxisTitles(spec: ChartSpec, r: ChartResult): { x: string; y: string } {
  if (r.kind === 'category') {
    const category = spec.dateGroup !== 'none' && spec.data.columns.find((c) => c.name === spec.x)?.type === 'date'
      ? `${r.categoryLabel} (${spec.dateGroup})`
      : r.categoryLabel;
    const value = r.series.length === 1 || spec.legend ? r.valueLabel : r.series.length > 1 ? 'Value' : r.valueLabel;
    return spec.type === 'bar' ? { x: value, y: category } : { x: category, y: value };
  }
  if (r.kind === 'scatter') return { x: r.xLabel, y: r.yLabel };
  if (r.kind === 'histogram') return { x: r.label, y: 'Count' };
  return { x: '', y: '' };
}

function resolved(text: string | null, auto: string): string {
  return text === null ? auto : text;
}

/* ---------------------------------------------------------------- legend */

function buildLegend(
  items: { name: string; color: string; kind: LegendItem['kind']; mark: MarkKind; lineWidth: number; markSize: number; dash: LineDash; outline: string | null }[],
  fs: number,
  textColor: string,
  horizontal: boolean,
  maxWidth: number,
): { w: number; h: number; place: (x: number, y: number) => LLegend } {
  const pad = fs * 0.45;
  const rowH = fs * 1.35;
  const swatchW = (k: LegendItem['kind']) => (k === 'line' ? fs * 1.6 : fs * 0.8);
  const itemW = items.map((it) => swatchW(it.kind) + fs * 0.4 + textWidth(it.name, fs));
  const colGap = fs * 0.9;

  // Horizontal legends wrap into rows that fit `maxWidth`.
  const rows: number[][] = [];
  if (horizontal) {
    let current: number[] = [];
    let width = 0;
    items.forEach((_, i) => {
      const add = (current.length ? colGap : 0) + itemW[i];
      if (current.length && width + add > maxWidth - pad * 2) {
        rows.push(current);
        current = [];
        width = 0;
      }
      width += (current.length ? colGap : 0) + itemW[i];
      current.push(i);
    });
    if (current.length) rows.push(current);
  } else {
    items.forEach((_, i) => rows.push([i]));
  }
  const rowWidths = rows.map((r) => r.reduce((a, i, k) => a + itemW[i] + (k ? colGap : 0), 0));
  const w = Math.max(...rowWidths, 0) + pad * 2;
  const h = rows.length * rowH + pad * 2 - (rowH - fs * 1.1);

  const place = (x: number, y: number): LLegend => {
    const out: LegendItem[] = [];
    rows.forEach((row, ri) => {
      let cx = x + pad;
      const cy = y + pad + ri * rowH + fs * 0.55;
      for (const i of row) {
        const it = items[i];
        const sw = swatchW(it.kind);
        const sh = it.kind === 'line' ? 0 : fs * 0.8;
        out.push({
          ...it,
          sx: cx,
          sy: cy - sh / 2,
          sw,
          sh,
          text: {
            text: it.name,
            x: cx + sw + fs * 0.4,
            y: cy,
            anchor: 'west',
            size: fs,
            bold: false,
            rotate: 0,
            color: textColor,
            role: 'legend',
          },
        });
        cx += itemW[i] + colGap;
      }
    });
    return { x, y, w, h, border: '#c3ccd6', fill: '#ffffff', items: out };
  };
  return { w, h, place };
}

/* ------------------------------------------------------------------ main */

export function layoutChart(spec: ChartSpec, w: number, h: number): ChartLayout {
  const result = computeChart(spec);
  const warnings = [...result.warnings];
  if (result.kind === 'empty') return { kind: 'empty', w, h, message: result.message, warnings, result };
  if (!isCartesian(spec.type)) return layoutPie(spec, result, w, h, warnings);
  return layoutCartesian(spec, result, w, h, warnings);
}

function layoutPie(spec: ChartSpec, result: ChartResult, w: number, h: number, warnings: string[]): ChartLayout {
  if (result.kind !== 'category' || !result.series[0]) {
    return { kind: 'empty', w, h, message: 'Pie charts need a category and a value.', warnings, result };
  }
  const st = spec.style;
  const fs = st.fontSize;
  const pad = fs * 0.6;
  const texts: LText[] = [];
  const fmt = formatOf(st);

  const title = resolved(st.title, autoTitle(spec, result));
  let top = pad;
  if (title) {
    texts.push({ text: title, x: w / 2, y: pad, anchor: 'north', size: fs * 1.2, bold: true, rotate: 0, color: st.textColor, role: 'title' });
    top = pad + fs * 1.2 * (TEXT_HEIGHT + TEXT_DEPTH) + fs * 0.7;
  }

  const raw = result.categories.map((name, i) => ({ name, value: result.series[0].values[i] ?? 0 }));
  const entries = raw.filter((e) => e.value > 0);
  const total = entries.reduce((a, e) => a + e.value, 0);
  if (total <= 0) return { kind: 'empty', w, h, message: 'Nothing to show: every value is zero or negative.', warnings, result };

  const colors = entries.map((e, i) => seriesColor(st.palette, st.seriesColors, e.name, i));
  let legend: LLegend | null = null;
  let area = { x: pad, y: top, w: w - pad * 2, h: h - top - pad };
  if (st.legend !== 'none') {
    const items = entries.map((e, i) => ({ name: e.name, color: colors[i], kind: 'box' as const, mark: 'none' as MarkKind, lineWidth: 0, markSize: 0, dash: 'solid' as LineDash, outline: null }));
    const horiz = st.legend === 'bottom';
    const lg = buildLegend(items, fs, st.textColor, horiz, area.w);
    if (horiz) {
      area = { ...area, h: area.h - lg.h - fs * 0.6 };
      legend = lg.place(w / 2 - lg.w / 2, area.y + area.h + fs * 0.6);
    } else if (st.legend === 'top-left') {
      legend = lg.place(pad, top);
      area = { x: pad + lg.w + fs * 0.6, y: top, w: area.w - lg.w - fs * 0.6, h: area.h };
    } else {
      // Right and top-right both sit to the right of a pie.
      area = { ...area, w: area.w - lg.w - fs * 0.6 };
      legend = lg.place(area.x + area.w + fs * 0.6, top + Math.max(0, (area.h - lg.h) / 2));
    }
  }

  const r = Math.max(8, Math.min(area.w, area.h) / 2);
  const cx = area.x + area.w / 2;
  const cy = area.y + area.h / 2;
  const inner = spec.type === 'donut' ? r * 0.55 : 0;
  const outline = st.outline ? '#ffffff' : null;

  let angle = 0;
  const slices: PieSlice[] = entries.map((e, i) => {
    const sweep = (e.value / total) * 360;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const share = e.value / total;
    let label: LText | null = null;
    if (st.pieLabels !== 'none' && share >= 0.035) {
      const pct = `${formatNumber(share * 100, { ...fmt, prefix: '', suffix: '', compact: false, decimals: st.decimals ?? 0 }, 0)}%`;
      const val = formatNumber(e.value, fmt, 2);
      const text =
        st.pieLabels === 'percent' ? pct : st.pieLabels === 'value' ? val : st.pieLabels === 'category' ? e.name : `${e.name} (${pct})`;
      const mid = ((start + end) / 2) * (Math.PI / 180);
      const lr = inner > 0 ? (r + inner) / 2 : r * 0.62;
      label = {
        text,
        x: cx + lr * Math.sin(mid),
        y: cy - lr * Math.cos(mid),
        anchor: 'center',
        size: fs,
        bold: false,
        rotate: 0,
        color: contrastText(colors[i]),
        role: 'pie-label',
      };
    }
    return { name: e.name, value: e.value, start: roundClean(start), end: roundClean(end), color: colors[i], label };
  });

  return {
    kind: 'pie',
    w,
    h,
    background: st.background === 'none' ? null : st.background,
    cx,
    cy,
    r,
    inner,
    outline,
    outlineWidth: outline ? Math.max(0.8, fs * 0.08) : 0,
    slices,
    texts,
    legend,
    warnings,
    result,
  };
}

function layoutCartesian(spec: ChartSpec, result: ChartResult, w: number, h: number, warnings: string[]): ChartLayout {
  const st = spec.style;
  const fs = st.fontSize;
  const pad = fs * 0.6;
  const tickLen = fs * 0.35;
  const tickLabelGap = tickLen + fs * 0.3;
  const titleGap = fs * 0.55;
  const fmt = formatOf(st);
  const horizontal = spec.type === 'bar';
  const texts: LText[] = [];

  /* ------------------------------------------------ series in data space */
  type Raw = { name: string; kind: LSeries['kind']; points: { x: number; y: number | null; tag: string }[] };
  let raws: Raw[] = [];
  let categories: string[] = [];
  let xNumeric: { min: number; max: number } | null = null;
  let histEdges: number[] | null = null;

  const seriesKind: LSeries['kind'] =
    spec.type === 'line' ? 'line' : spec.type === 'area' ? 'area' : spec.type === 'scatter' ? 'scatter' : 'bar';

  if (result.kind === 'category') {
    categories = result.categories;
    raws = result.series.map((s) => ({
      name: s.name,
      kind: seriesKind,
      // Bar charts list the first category at the top of the vertical axis.
      points: s.values.map((v, i) => ({ x: horizontal ? categories.length - 1 - i : i, y: v, tag: categories[i] })),
    }));
  } else if (result.kind === 'scatter') {
    raws = result.series.map((s) => ({
      name: s.name,
      kind: 'scatter',
      points: s.points.map((p) => ({ x: p.x, y: p.y, tag: `${p.x}, ${p.y}` })),
    }));
    const xs = result.series.flatMap((s) => s.points.map((p) => p.x));
    xNumeric = { min: Math.min(...xs), max: Math.max(...xs) };
  } else if (result.kind === 'histogram') {
    histEdges = result.edges;
    const step = result.edges[1] - result.edges[0];
    raws = [
      {
        name: 'Count',
        kind: 'bar',
        points: result.counts.map((c, i) => ({ x: roundClean(result.edges[i] + step / 2), y: c, tag: `${result.edges[i]} to ${result.edges[i + 1]}` })),
      },
    ];
    xNumeric = { min: result.edges[0], max: result.edges[result.edges.length - 1] };
  }

  const stacked = spec.stacked && (spec.type === 'column' || spec.type === 'bar' || spec.type === 'area') && raws.length > 1;

  /* --------------------------------------------------------- value range */
  let vMin = Infinity;
  let vMax = -Infinity;
  if (stacked) {
    const n = categories.length;
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (const r of raws) {
        acc += r.points[i]?.y ?? 0;
        vMin = Math.min(vMin, acc);
        vMax = Math.max(vMax, acc);
      }
    }
  } else {
    for (const r of raws) for (const p of r.points) if (p.y !== null) {
      vMin = Math.min(vMin, p.y);
      vMax = Math.max(vMax, p.y);
    }
  }
  if (!Number.isFinite(vMin)) {
    return { kind: 'empty', w, h, message: 'There are no numbers to plot for these fields.', warnings, result };
  }
  const zeroBased = spec.type === 'column' || spec.type === 'bar' || spec.type === 'area' || spec.type === 'histogram';
  if (zeroBased) {
    vMin = Math.min(0, vMin);
    vMax = Math.max(0, vMax);
  }

  /* --------------------------------------------------------- the titles */
  const title = resolved(st.title, autoTitle(spec, result));
  const auto = autoAxisTitles(spec, result);
  const xTitle = resolved(st.xTitle, auto.x);
  const yTitle = resolved(st.yTitle, auto.y);
  const titleSize = fs * 1.2;
  const lineH = (size: number) => size * (TEXT_HEIGHT + TEXT_DEPTH);

  /* --------------------------------------------------------- the legend */
  const showLegend = st.legend !== 'none' && (raws.length > 1 || !!spec.legend) && result.kind !== 'histogram';
  const legendItems = raws.map((r, i) => {
    const color = seriesColor(st.palette, st.seriesColors, r.name, i);
    return {
      name: r.name,
      color,
      kind: (r.kind === 'line' ? 'line' : r.kind === 'scatter' ? 'mark' : 'box') as LegendItem['kind'],
      mark: r.kind === 'scatter' ? (st.marks === 'none' ? 'circle' : st.marks) : r.kind === 'line' ? st.marks : 'none' as MarkKind,
      lineWidth: st.lineWidth,
      markSize: st.markSize,
      dash: st.lineDash,
      outline: st.outline ? darken(color) : null,
    };
  });

  /* ---------------------------------------------- tick labels (estimate) */
  // Category labels shown along the category axis.
  const catLabels = categories;
  const firstPass = (plotW: number, plotH: number) => {
    const valueLen = horizontal ? plotW : plotH;
    const target = Math.max(2, Math.min(10, Math.floor(valueLen / (horizontal ? fs * 5.5 : fs * 2.6))));
    return valueTicks(vMin, vMax, target, st.yMin, st.yMax);
  };

  // Margins are solved twice: once with guessed tick labels, once with the real ones.
  let left = pad;
  let right = pad;
  let top = pad + (title ? lineH(titleSize) + titleGap : fs * 0.4);
  let bottom = pad;
  let legendBox: ReturnType<typeof buildLegend> | null = null;
  if (showLegend) {
    legendBox = buildLegend(legendItems, fs, st.textColor, st.legend === 'bottom', w - pad * 2);
    if (st.legend === 'right') right += legendBox.w + fs * 0.8;
  }

  let vt = firstPass(w * 0.7, h * 0.65);
  let xRot = 0;
  let catStep = 1;
  let xTickH = 0;
  let yTickW = 0;
  const titleSep = fs * 0.55;
  const xTitleH = xTitle ? lineH(fs) + titleSep + fs * 0.15 : 0;
  const yTitleW = yTitle ? lineH(fs) + titleSep + fs * 0.15 : 0;

  const valueDecimals = () => (st.decimals === null ? decimalsForStep(vt.step) : st.decimals);
  const valueLabel = (v: number) => formatNumber(v, fmt, valueDecimals(), false);
  const numericXTicks = (min: number, max: number, plotW: number) => {
    if (histEdges) {
      const maxLabel = Math.max(...histEdges.map((e) => textWidth(formatNumber(e, fmt, Math.min(2, decimalsForStep(histEdges![1] - histEdges![0])), false), fs)));
      const every = Math.max(1, Math.ceil((histEdges.length * (maxLabel + fs)) / Math.max(1, plotW)));
      const d = st.decimals ?? Math.min(2, decimalsForStep(histEdges[1] - histEdges[0]));
      return histEdges.filter((_, i) => i % every === 0).map((e) => ({ v: e, label: formatNumber(e, fmt, d, false) }));
    }
    const t = valueTicks(min, max, Math.max(2, Math.min(10, Math.floor(plotW / (fs * 5.5)))), null, null);
    const d = st.decimals === null ? decimalsForStep(t.step) : st.decimals;
    return t.ticks.map((v) => ({ v, label: formatNumber(v, fmt, d, false) }));
  };

  for (let pass = 0; pass < 2; pass++) {
    const plotW = Math.max(20, w - left - right - yTickW - yTitleW);
    const plotH = Math.max(20, h - top - bottom - xTickH - xTitleH);
    vt = firstPass(plotW, plotH);
    const valueLabels = vt.ticks.map(valueLabel);

    if (horizontal) {
      // Categories on the left, values along the bottom.
      yTickW = Math.max(...catLabels.map((c) => textWidth(c, fs)), fs) + tickLabelGap;
      xTickH = lineH(fs) + tickLabelGap;
      const room = plotH / Math.max(1, catLabels.length);
      catStep = Math.max(1, Math.ceil(lineH(fs) * 1.1 / Math.max(1, room)));
      void valueLabels;
    } else {
      yTickW = Math.max(...valueLabels.map((l) => textWidth(l, fs)), fs) + tickLabelGap;
      if (xNumeric) {
        const ticks = numericXTicks(xNumeric.min, xNumeric.max, plotW);
        xRot = 0;
        xTickH = lineH(fs) + tickLabelGap;
        void ticks;
      } else {
        const slot = plotW / Math.max(1, catLabels.length);
        const widest = Math.max(...catLabels.map((c) => textWidth(c, fs)), 0);
        const want = st.xLabelRotate;
        if (want === 'auto') xRot = widest + fs * 0.6 > slot ? (widest > fs * 9 || slot < lineH(fs) * 1.6 ? 90 : 45) : 0;
        else xRot = want;
        const footprint = xRot === 0 ? widest + fs * 0.6 : xRot === 45 ? lineH(fs) * 1.5 : lineH(fs) * 1.1;
        catStep = Math.max(1, Math.ceil(footprint / Math.max(1, slot)));
        const boxH = Math.max(...catLabels.map((c) => rotatedBox(c, fs, xRot).h), lineH(fs));
        xTickH = Math.min(boxH, h * 0.4) + tickLabelGap;
      }
    }
  }

  let legendBottomH = 0;
  if (legendBox && st.legend === 'bottom') legendBottomH = legendBox.h + fs * 0.6;

  const plot = {
    x: left + yTitleW + yTickW,
    y: top,
    w: Math.max(20, w - left - right - yTickW - yTitleW),
    h: Math.max(20, h - top - bottom - xTickH - xTitleH - legendBottomH),
  };
  vt = firstPass(plot.w, plot.h);

  // Room for data labels above the tallest bar.
  if (st.dataLabels && st.yMax === null && vMax > 0) {
    const pxPerUnit = (horizontal ? plot.w : plot.h) / (vt.max - vt.min);
    const need = horizontal ? textWidth(valueLabel(vMax), fs) + fs * 0.6 : lineH(fs) + fs * 0.5;
    if ((vt.max - vMax) * pxPerUnit < need) {
      vt = { ...vt, max: roundClean(vt.max + vt.step), ticks: [...vt.ticks, roundClean(vt.max + vt.step)] };
    }
  }

  /* --------------------------------------------------------- axes, ticks */
  const catRange = { min: -0.5, max: Math.max(0.5, categories.length - 0.5) };
  const valueRange = { min: vt.min, max: vt.max };
  const vd = valueDecimals();
  const valueTicksOut: Tick[] = vt.ticks.map((v) => ({ v, label: formatNumber(v, fmt, vd, false) }));
  const catTicks: Tick[] = categories
    .map((c, i) => ({ v: horizontal ? categories.length - 1 - i : i, label: c }))
    .filter((_, i) => i % catStep === 0);

  let xRange: { min: number; max: number };
  let yRange: { min: number; max: number };
  let xTicks: Tick[];
  let yTicks: Tick[];
  let xCategorical = false;
  let yCategorical = false;
  if (horizontal) {
    xRange = valueRange;
    yRange = catRange;
    xTicks = valueTicksOut;
    yTicks = catTicks;
    yCategorical = true;
  } else if (xNumeric) {
    let xmin = xNumeric.min;
    let xmax = xNumeric.max;
    if (!histEdges) {
      const t = valueTicks(xmin, xmax, Math.max(2, Math.min(10, Math.floor(plot.w / (fs * 5.5)))), null, null);
      xmin = t.min;
      xmax = t.max;
    }
    xRange = { min: xmin, max: xmax };
    yRange = valueRange;
    xTicks = numericXTicks(xNumeric.min, xNumeric.max, plot.w);
    yTicks = valueTicksOut;
  } else {
    xRange = catRange;
    yRange = valueRange;
    xTicks = catTicks;
    yTicks = valueTicksOut;
    xCategorical = true;
  }

  /* ------------------------------------------------- data to local du */
  const px = (v: number) => plot.x + ((v - xRange.min) / (xRange.max - xRange.min)) * plot.w;
  const py = (v: number) => plot.y + plot.h - ((v - yRange.min) / (yRange.max - yRange.min)) * plot.h;
  /** Category-axis position and value -> local point, honouring orientation. */
  const at = (cat: number, value: number) => (horizontal ? { x: px(value), y: py(cat) } : { x: px(cat), y: py(value) });

  /* ------------------------------------------------------------- series */
  const nBars = raws.filter((r) => r.kind === 'bar').length;
  const group = result.kind === 'histogram' ? 1 : Math.max(0.1, Math.min(1, st.barWidth));
  const histStep = histEdges ? histEdges[1] - histEdges[0] : 1;
  const stackAcc = new Map<number, number>();

  const series: LSeries[] = raws.map((r, si) => {
    const color = legendItems[si].color;
    let barWidth = 0;
    let barShift = 0;
    if (r.kind === 'bar') {
      if (result.kind === 'histogram') {
        barWidth = histStep;
      } else if (stacked) {
        barWidth = group;
      } else {
        barWidth = group / Math.max(1, nBars);
        barShift = -group / 2 + barWidth * (si + 0.5);
        // Horizontal bars read top to bottom, so the first series goes on top.
        if (horizontal) barShift = -barShift;
      }
    }
    const points: LPoint[] = [];
    for (const p of r.points) {
      if (p.y === null && !stacked) continue;
      const value = p.y ?? 0;
      let y0 = 0;
      let y = value;
      if (stacked) {
        y0 = stackAcc.get(p.x) ?? 0;
        y = roundClean(y0 + value);
        stackAcc.set(p.x, y);
      }
      points.push({ x: roundClean(p.x + barShift), y, y0, tag: p.tag, value });
    }

    const labels: LText[] = [];
    if (st.dataLabels) {
      for (const p of points) {
        if (stacked && p.value === 0) continue;
        const text = formatNumber(p.value, fmt, st.decimals ?? 2);
        if (r.kind === 'bar' && stacked) {
          const mid = at(p.x, (p.y + p.y0) / 2);
          labels.push({ text, x: mid.x, y: mid.y, anchor: 'center', size: fs * 0.9, bold: false, rotate: 0, color: contrastText(color), role: 'data-label' });
        } else if (r.kind === 'bar') {
          const end = at(p.x, p.y);
          const neg = p.y < 0;
          labels.push({
            text,
            x: end.x + (horizontal ? (neg ? -fs * 0.3 : fs * 0.3) : 0),
            y: end.y + (horizontal ? 0 : neg ? fs * 0.3 : -fs * 0.3),
            anchor: horizontal ? (neg ? 'east' : 'west') : neg ? 'north' : 'south',
            size: fs * 0.9,
            bold: false,
            rotate: 0,
            color: st.textColor,
            role: 'data-label',
          });
        } else {
          const pt = at(p.x, p.y);
          const lift = (r.kind === 'line' && st.marks === 'none' ? 0 : st.markSize) + fs * 0.3;
          labels.push({ text, x: pt.x, y: pt.y - lift, anchor: 'south', size: fs * 0.9, bold: false, rotate: 0, color: st.textColor, role: 'data-label' });
        }
      }
    }

    return {
      name: r.name,
      color,
      kind: r.kind,
      points,
      barWidth: roundClean(barWidth),
      barShift: roundClean(barShift),
      outline: r.kind === 'bar' || r.kind === 'area'
        ? st.outline
          ? darken(color)
          : result.kind === 'histogram'
            ? '#ffffff'
            : null
        : null,
      outlineWidth: Math.max(0.6, fs * 0.06),
      lineWidth: st.lineWidth,
      dash: r.kind === 'scatter' ? 'solid' : st.lineDash,
      mark: r.kind === 'scatter' ? (st.marks === 'none' ? 'circle' : st.marks) : r.kind === 'line' || r.kind === 'area' ? st.marks : 'none',
      markSize: st.markSize,
      fillOpacity: r.kind === 'area' ? Math.max(0, Math.min(1, st.areaOpacity)) : 1,
      stacked,
      labels,
    };
  });

  /* ------------------------------------------------------- titles, etc. */
  if (title) {
    texts.push({ text: title, x: plot.x + plot.w / 2, y: plot.y - titleGap, anchor: 'south', size: titleSize, bold: true, rotate: 0, color: st.textColor, role: 'title' });
  }
  if (xTitle) {
    texts.push({
      text: xTitle,
      x: plot.x + plot.w / 2,
      y: plot.y + plot.h + xTickH + titleSep,
      anchor: 'north',
      size: fs,
      bold: false,
      rotate: 0,
      color: st.textColor,
      role: 'x-title',
    });
  }
  if (yTitle) {
    texts.push({
      text: yTitle,
      x: plot.x - yTickW - titleSep,
      y: plot.y + plot.h / 2,
      anchor: 'south',
      size: fs,
      bold: false,
      rotate: 90,
      color: st.textColor,
      role: 'y-title',
    });
  }

  /* ---------------------------------------------------------- legend */
  let legend: LLegend | null = null;
  if (legendBox) {
    const inset = fs * 0.45;
    switch (st.legend) {
      case 'right':
        legend = legendBox.place(w - pad - legendBox.w, plot.y);
        break;
      case 'bottom':
        legend = legendBox.place(plot.x + plot.w / 2 - legendBox.w / 2, plot.y + plot.h + xTickH + xTitleH + fs * 0.6);
        break;
      case 'top-left':
        legend = legendBox.place(plot.x + inset, plot.y + inset);
        break;
      default:
        legend = legendBox.place(plot.x + plot.w - inset - legendBox.w, plot.y + inset);
    }
  }

  let xTickAnchor: TikzAnchor = 'north';
  if (xRot === 45) xTickAnchor = 'north east';
  if (xRot === 90) xTickAnchor = 'east';

  return {
    kind: 'cartesian',
    w,
    h,
    background: st.background === 'none' ? null : st.background,
    plot,
    horizontal,
    xRange,
    yRange,
    xTicks,
    yTicks,
    xTickAnchor,
    xTickRotate: xRot,
    yTickAnchor: 'east',
    xCategorical,
    yCategorical,
    grid: {
      x: st.grid === 'x' || st.grid === 'both',
      y: st.grid === 'y' || st.grid === 'both',
      color: st.gridColor,
    },
    axisLines: st.axisLines,
    axisColor: st.axisColor,
    axisWidth: Math.max(0.6, fs * 0.07),
    tickLen,
    tickLabelGap,
    fontSize: fs,
    textColor: st.textColor,
    series,
    texts,
    legend,
    warnings,
    result,
  };
}

/** Local-du position of a data point, for renderers. */
export function dataToLocal(l: CartesianLayout, x: number, y: number): { x: number; y: number } {
  const px = l.plot.x + ((x - l.xRange.min) / (l.xRange.max - l.xRange.min)) * l.plot.w;
  const py = l.plot.y + l.plot.h - ((y - l.yRange.min) / (l.yRange.max - l.yRange.min)) * l.plot.h;
  return { x: px, y: py };
}

/** Same, but taking (category position, value) and applying the bar-chart swap. */
export function catValueToLocal(l: CartesianLayout, cat: number, value: number): { x: number; y: number } {
  return l.horizontal ? dataToLocal(l, value, cat) : dataToLocal(l, cat, value);
}
