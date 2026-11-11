import type {
  Aggregation,
  CellValue,
  ChartFilter,
  ChartSpec,
  DataTable,
  DateGroup,
  ValueField,
} from './types';
import { AGGREGATIONS } from './types';

/**
 * From a table and a chart spec to the numbers a chart draws.
 *
 * This is the Power BI / Tableau step: filter the rows, group them by the
 * axis field (and the legend field), and combine each group's values with
 * the chosen aggregation. The result is plain data - category names, series
 * names and numbers - that both the canvas and the LaTeX emitter consume.
 */

export interface CategorySeries {
  name: string;
  /** Aligned with `categories`; null where the group had no values. */
  values: (number | null)[];
}

export interface CategoryResult {
  kind: 'category';
  categories: string[];
  series: CategorySeries[];
  /** "Sum of Sales" (or several joined) - for titles and the value axis. */
  valueLabel: string;
  categoryLabel: string;
  rowCount: number;
  warnings: string[];
}

export interface ScatterResult {
  kind: 'scatter';
  series: { name: string; points: { x: number; y: number }[] }[];
  xLabel: string;
  yLabel: string;
  rowCount: number;
  warnings: string[];
}

export interface HistogramResult {
  kind: 'histogram';
  edges: number[];
  counts: number[];
  label: string;
  rowCount: number;
  warnings: string[];
}

export interface EmptyResult {
  kind: 'empty';
  message: string;
  rowCount: number;
  warnings: string[];
}

export type ChartResult = CategoryResult | ScatterResult | HistogramResult | EmptyResult;

export const MAX_SERIES = 12;
export const MAX_CATEGORIES = 200;

/* ------------------------------------------------------------- helpers */

export function colIndex(t: DataTable, name: string | null): number {
  if (!name) return -1;
  return t.columns.findIndex((c) => c.name === name);
}

export function cellKey(v: CellValue): string {
  if (v === null) return '(Blank)';
  return typeof v === 'number' ? formatKeyNumber(v) : v;
}

function formatKeyNumber(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e8) / 1e8);
}

export function aggLabel(v: ValueField): string {
  if (!v.field) return 'Count of records';
  const a = AGGREGATIONS.find((x) => x.id === v.agg)?.short ?? v.agg;
  return `${a} of ${v.field}`;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Group a date into a period; returns a sortable key and a display label. */
export function datePeriod(isoDate: string, group: DateGroup): { key: string; label: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m || group === 'none') return { key: isoDate, label: isoDate };
  const y = m[1];
  const mo = Number(m[2]);
  if (group === 'year') return { key: y, label: y };
  if (group === 'quarter') {
    const q = Math.floor((mo - 1) / 3) + 1;
    return { key: `${y}-Q${q}`, label: `Q${q} ${y}` };
  }
  return { key: `${y}-${m[2]}`, label: `${MONTH_NAMES[mo - 1]} ${y}` };
}

/** Distinct values of a column, in first-seen order (dates chronological). */
export function distinctValues(t: DataTable, field: string): string[] {
  const i = colIndex(t, field);
  if (i < 0) return [];
  const seen = new Set<string>();
  for (const r of t.rows) seen.add(cellKey(r[i]));
  const out = [...seen];
  if (t.columns[i].type === 'date') out.sort();
  if (t.columns[i].type === 'number') out.sort((a, b) => Number(a) - Number(b));
  return out;
}

export function numericRange(t: DataTable, field: string): { min: number; max: number } | null {
  const i = colIndex(t, field);
  if (i < 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const r of t.rows) {
    const v = r[i];
    if (typeof v === 'number') {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return Number.isFinite(min) ? { min, max } : null;
}

/** Rows that pass every filter. */
export function applyFilters(t: DataTable, filters: ChartFilter[]): CellValue[][] {
  const active = filters
    .map((f) => ({ f, i: colIndex(t, f.field) }))
    .filter(({ i }) => i >= 0);
  if (active.length === 0) return t.rows;
  return t.rows.filter((r) =>
    active.every(({ f, i }) => {
      const v = r[i];
      if (t.columns[i].type === 'number') {
        if (f.min !== null && f.min !== undefined && (typeof v !== 'number' || v < f.min)) return false;
        if (f.max !== null && f.max !== undefined && (typeof v !== 'number' || v > f.max)) return false;
        if (f.include && f.include.length && !f.include.includes(cellKey(v))) return false;
        return true;
      }
      if (f.include && !f.include.includes(cellKey(v))) return false;
      return true;
    }),
  );
}

export function aggregate(values: CellValue[], agg: Aggregation, countRows: boolean): number | null {
  if (countRows) return values.length;
  if (agg === 'count') return values.filter((v) => v !== null).length;
  if (agg === 'distinct') return new Set(values.filter((v) => v !== null).map(cellKey)).size;
  const nums = values.filter((v): v is number => typeof v === 'number');
  if (nums.length === 0) return null;
  switch (agg) {
    case 'sum':
      return roundClean(nums.reduce((a, b) => a + b, 0));
    case 'avg':
      return roundClean(nums.reduce((a, b) => a + b, 0) / nums.length);
    case 'min':
      return Math.min(...nums);
    case 'max':
      return Math.max(...nums);
    case 'median': {
      const s = [...nums].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : roundClean((s[m - 1] + s[m]) / 2);
    }
    default:
      return null;
  }
}

/** Remove floating-point dust such as 0.30000000000000004. */
export function roundClean(v: number): number {
  return Math.round(v * 1e9) / 1e9;
}

/* ---------------------------------------------------------------- main */

export function computeChart(spec: ChartSpec): ChartResult {
  const t = spec.data;
  const warnings: string[] = [];
  const rows = applyFilters(t, spec.filters);

  if (spec.type === 'scatter') return computeScatter(spec, rows, warnings);
  if (spec.type === 'histogram') return computeHistogram(spec, rows, warnings);

  const xi = colIndex(t, spec.x);
  if (xi < 0) {
    return { kind: 'empty', message: 'Drag a field into Axis to start.', rowCount: rows.length, warnings };
  }
  const values = spec.values.filter((v) => v.field === null || colIndex(t, v.field) >= 0);
  if (values.length === 0) {
    return { kind: 'empty', message: 'Drag a field into Values.', rowCount: rows.length, warnings };
  }
  if (rows.length === 0) {
    return { kind: 'empty', message: 'The filters exclude every row.', rowCount: 0, warnings };
  }

  const isDate = t.columns[xi].type === 'date';
  const keyOf = (v: CellValue): { key: string; label: string } => {
    if (isDate && typeof v === 'string' && spec.dateGroup !== 'none') return datePeriod(v, spec.dateGroup);
    const k = cellKey(v);
    return { key: k, label: k };
  };

  // Category order: first appearance, or chronological / numeric for dates and numbers.
  const catOrder: string[] = [];
  const catLabel = new Map<string, string>();
  const groups = new Map<string, CellValue[][]>();
  for (const r of rows) {
    const { key, label } = keyOf(r[xi]);
    if (!groups.has(key)) {
      groups.set(key, []);
      catOrder.push(key);
      catLabel.set(key, label);
    }
    groups.get(key)!.push(r);
  }
  if (isDate) catOrder.sort();
  if (t.columns[xi].type === 'number') catOrder.sort((a, b) => Number(a) - Number(b));

  // Series: one per value field, or one per legend value of the first value field.
  const li = colIndex(t, spec.legend);
  const allowLegend = li >= 0 && spec.type !== 'pie' && spec.type !== 'donut';
  let seriesDefs: { name: string; value: ValueField; legendKey?: string }[];
  if (allowLegend) {
    const legendKeys: string[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const k = cellKey(r[li]);
      if (!seen.has(k)) {
        seen.add(k);
        legendKeys.push(k);
      }
    }
    if (t.columns[li].type !== 'text') legendKeys.sort();
    if (legendKeys.length > MAX_SERIES) {
      warnings.push(`"${spec.legend}" has ${legendKeys.length} values; only the first ${MAX_SERIES} are shown as series.`);
    }
    seriesDefs = legendKeys.slice(0, MAX_SERIES).map((k) => ({ name: k, value: values[0], legendKey: k }));
    if (values.length > 1) warnings.push('With a Legend field, only the first value field is plotted.');
  } else {
    const single = spec.type === 'pie' || spec.type === 'donut';
    seriesDefs = (single ? values.slice(0, 1) : values.slice(0, MAX_SERIES)).map((v) => ({ name: aggLabel(v), value: v }));
  }

  let categories = catOrder;
  const seriesValues = seriesDefs.map((sd) => {
    const vi = colIndex(t, sd.value.field);
    return categories.map((cat) => {
      const groupRows = groups.get(cat)!;
      const subset = sd.legendKey !== undefined ? groupRows.filter((r) => cellKey(r[li]) === sd.legendKey) : groupRows;
      if (subset.length === 0) return null;
      return aggregate(subset.map((r) => (vi >= 0 ? r[vi] : 1)), sd.value.agg, sd.value.field === null);
    });
  });

  // Sorting is by the category label or by the total across series.
  const totals = categories.map((_, ci) => seriesValues.reduce((a, s) => a + (s[ci] ?? 0), 0));
  let index = categories.map((_, i) => i);
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  switch (spec.sort) {
    case 'cat-asc':
      index.sort((a, b) => collator.compare(catLabel.get(categories[a])!, catLabel.get(categories[b])!));
      break;
    case 'cat-desc':
      index.sort((a, b) => collator.compare(catLabel.get(categories[b])!, catLabel.get(categories[a])!));
      break;
    case 'val-desc':
      index.sort((a, b) => totals[b] - totals[a]);
      break;
    case 'val-asc':
      index.sort((a, b) => totals[a] - totals[b]);
      break;
  }
  if (spec.topN > 0 && index.length > spec.topN) index = index.slice(0, spec.topN);
  if (index.length > MAX_CATEGORIES) {
    warnings.push(`"${spec.x}" has ${index.length} values; only the first ${MAX_CATEGORIES} are shown. Use a filter or Top N.`);
    index = index.slice(0, MAX_CATEGORIES);
  }
  categories = index.map((i) => catLabel.get(catOrder[i])!);
  const series = seriesDefs.map((sd, si) => ({
    name: sd.name,
    values: index.map((i) => seriesValues[si][i]),
  }));

  if ((spec.type === 'pie' || spec.type === 'donut') && series[0]) {
    const negatives = series[0].values.filter((v) => v !== null && v < 0).length;
    if (negatives) warnings.push(`${negatives} negative value${negatives === 1 ? ' was' : 's were'} left out of the pie.`);
    if (categories.length > 12) warnings.push('Pie charts with more than 12 slices are hard to read; consider Top N or a bar chart.');
  }

  return {
    kind: 'category',
    categories,
    series,
    valueLabel: allowLegend ? aggLabel(values[0]) : values.map(aggLabel).join(', '),
    categoryLabel: spec.x ?? '',
    rowCount: rows.length,
    warnings,
  };
}

function computeScatter(spec: ChartSpec, rows: CellValue[][], warnings: string[]): ChartResult {
  const t = spec.data;
  const xi = colIndex(t, spec.x);
  const yField = spec.values[0]?.field ?? null;
  const yi = colIndex(t, yField);
  if (xi < 0 || t.columns[xi].type !== 'number') {
    return { kind: 'empty', message: 'Scatter needs a number field on the X axis.', rowCount: rows.length, warnings };
  }
  if (yi < 0 || t.columns[yi].type !== 'number') {
    return { kind: 'empty', message: 'Scatter needs a number field on the Y axis.', rowCount: rows.length, warnings };
  }
  const li = colIndex(t, spec.legend);
  const byName = new Map<string, { x: number; y: number }[]>();
  const order: string[] = [];
  let skipped = 0;
  for (const r of rows) {
    const x = r[xi];
    const y = r[yi];
    if (typeof x !== 'number' || typeof y !== 'number') {
      skipped++;
      continue;
    }
    const name = li >= 0 ? cellKey(r[li]) : yField!;
    if (!byName.has(name)) {
      byName.set(name, []);
      order.push(name);
    }
    byName.get(name)!.push({ x, y });
  }
  if (skipped) warnings.push(`${skipped} row${skipped === 1 ? '' : 's'} without both numbers were skipped.`);
  if (order.length > MAX_SERIES) warnings.push(`Only the first ${MAX_SERIES} colour groups are shown.`);
  const series = order.slice(0, MAX_SERIES).map((name) => ({ name, points: byName.get(name)! }));
  if (series.length === 0) {
    return { kind: 'empty', message: 'No rows have numbers in both fields.', rowCount: rows.length, warnings };
  }
  return { kind: 'scatter', series, xLabel: spec.x!, yLabel: yField!, rowCount: rows.length, warnings };
}

/** "Nice" step for a span divided into roughly `count` parts (1, 2, 2.5, 5 x 10^k). */
export function niceStep(span: number, count: number): number {
  if (!(span > 0) || !(count > 0)) return 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * mag;
}

function computeHistogram(spec: ChartSpec, rows: CellValue[][], warnings: string[]): ChartResult {
  const t = spec.data;
  const xi = colIndex(t, spec.x);
  if (xi < 0 || t.columns[xi].type !== 'number') {
    return { kind: 'empty', message: 'Histogram needs a number field to bin.', rowCount: rows.length, warnings };
  }
  const nums = rows.map((r) => r[xi]).filter((v): v is number => typeof v === 'number');
  if (nums.length === 0) return { kind: 'empty', message: 'The field has no numbers.', rowCount: rows.length, warnings };
  let min = Math.min(...nums);
  let max = Math.max(...nums);
  if (min === max) {
    min -= 0.5;
    max += 0.5;
  }
  const target = spec.bins > 0 ? Math.min(100, spec.bins) : Math.max(5, Math.min(30, Math.ceil(Math.log2(nums.length) + 1)));
  const step = spec.bins > 0 ? (max - min) / target : niceStep(max - min, target);
  const start = spec.bins > 0 ? min : Math.floor(min / step) * step;
  const edges: number[] = [];
  for (let e = start, i = 0; i <= 200; i++, e = start + i * step) {
    edges.push(roundClean(e));
    if (e >= max - step * 1e-9 && edges.length >= 2) break;
  }
  if (edges[edges.length - 1] < max) edges.push(roundClean(edges[edges.length - 1] + step));
  const counts = new Array(edges.length - 1).fill(0);
  for (const v of nums) {
    let b = Math.floor((v - start) / step + 1e-9);
    if (b >= counts.length) b = counts.length - 1;
    if (b < 0) b = 0;
    counts[b]++;
  }
  return { kind: 'histogram', edges, counts, label: spec.x!, rowCount: rows.length, warnings };
}
