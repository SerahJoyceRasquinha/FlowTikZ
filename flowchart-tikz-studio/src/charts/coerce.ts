import type {
  Aggregation,
  CellValue,
  ChartFilter,
  ChartSpec,
  ChartStyle,
  ChartType,
  ColumnType,
  DataTable,
  ValueField,
} from './types';
import { CHART_TYPES, AGGREGATIONS } from './types';
import { DEFAULT_CHART_STYLE } from './defaults';
import { MAX_COLUMNS, MAX_ROWS } from './parse';

/**
 * Read a chart spec from a save file (or the clipboard) defensively: a
 * hand-edited or damaged file degrades to "as much of the chart as can be
 * read", never to a crash. Returns null when there is no usable table.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function numIn(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function hex(v: unknown, fallback: string): string {
  return typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback;
}

function coerceTable(raw: any): DataTable | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.columns) || !Array.isArray(raw.rows)) return null;
  const columns = raw.columns
    .slice(0, MAX_COLUMNS)
    .map((c: any, i: number) => ({
      name: str(c?.name, `Column ${i + 1}`).slice(0, 80) || `Column ${i + 1}`,
      type: oneOf<ColumnType>(c?.type, ['number', 'text', 'date'], 'text'),
    }));
  if (columns.length === 0) return null;
  const rows: CellValue[][] = raw.rows.slice(0, MAX_ROWS).map((r: any) =>
    columns.map((col: { type: ColumnType }, i: number) => {
      const v = Array.isArray(r) ? r[i] : null;
      if (v === null || v === undefined) return null;
      if (col.type === 'number') {
        const n = Number(v);
        return typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? (Number.isFinite(n) ? n : null) : null;
      }
      return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
    }),
  );
  return { name: str(raw.name, 'Data'), source: str(raw.source, 'file'), columns, rows };
}

export function coerceChart(raw: any): ChartSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = coerceTable(raw.data);
  if (!data) return null;
  const names = new Set(data.columns.map((c) => c.name));
  const field = (v: unknown) => (typeof v === 'string' && names.has(v) ? v : null);

  const values: ValueField[] = Array.isArray(raw.values)
    ? raw.values.slice(0, 12).map((v: any) => ({
        field: field(v?.field),
        agg: oneOf<Aggregation>(v?.agg, AGGREGATIONS.map((a) => a.id), 'sum'),
      }))
    : [];
  const filters: ChartFilter[] = Array.isArray(raw.filters)
    ? raw.filters
        .filter((f: any) => field(f?.field))
        .map((f: any) => {
          // Only the keys the file has, so a save/load round trip is exact.
          const out: ChartFilter = { field: f.field };
          if (Array.isArray(f.include)) out.include = f.include.filter((x: unknown) => typeof x === 'string');
          if ('min' in f) out.min = numOrNull(f.min);
          if ('max' in f) out.max = numOrNull(f.max);
          return out;
        })
    : [];

  const s = raw.style ?? {};
  const seriesColors: Record<string, string> = {};
  if (s.seriesColors && typeof s.seriesColors === 'object') {
    for (const [k, v] of Object.entries(s.seriesColors)) if (typeof v === 'string' && HEX.test(v)) seriesColors[k] = v.toLowerCase();
  }
  const d = DEFAULT_CHART_STYLE;
  const style: ChartStyle = {
    palette: str(s.palette, d.palette),
    seriesColors,
    title: strOrNull(s.title),
    xTitle: strOrNull(s.xTitle),
    yTitle: strOrNull(s.yTitle),
    fontSize: numIn(s.fontSize, 6, 40, d.fontSize),
    textColor: hex(s.textColor, d.textColor),
    axisColor: hex(s.axisColor, d.axisColor),
    grid: oneOf(s.grid, ['none', 'y', 'x', 'both'] as const, d.grid),
    gridColor: hex(s.gridColor, d.gridColor),
    legend: oneOf(s.legend, ['none', 'top-right', 'top-left', 'right', 'bottom'] as const, d.legend),
    dataLabels: !!s.dataLabels,
    barWidth: numIn(s.barWidth, 0.1, 1, d.barWidth),
    outline: !!s.outline,
    lineWidth: numIn(s.lineWidth, 0.5, 10, d.lineWidth),
    marks: oneOf(s.marks, ['none', 'circle', 'square', 'triangle', 'diamond'] as const, d.marks),
    markSize: numIn(s.markSize, 1, 12, d.markSize),
    lineDash: oneOf(s.lineDash, ['solid', 'dashed', 'dotted'] as const, d.lineDash),
    areaOpacity: numIn(s.areaOpacity, 0, 1, d.areaOpacity),
    yMin: numOrNull(s.yMin),
    yMax: numOrNull(s.yMax),
    decimals: s.decimals === null || s.decimals === undefined ? null : numIn(s.decimals, 0, 6, 0),
    thousands: s.thousands === undefined ? d.thousands : !!s.thousands,
    compact: !!s.compact,
    prefix: str(s.prefix).slice(0, 12),
    suffix: str(s.suffix).slice(0, 12),
    xLabelRotate: s.xLabelRotate === 0 || s.xLabelRotate === 45 || s.xLabelRotate === 90 ? s.xLabelRotate : 'auto',
    axisLines: oneOf(s.axisLines, ['box', 'left'] as const, d.axisLines),
    background: s.background === 'none' ? 'none' : hex(s.background, d.background),
    pieLabels: oneOf(s.pieLabels, ['none', 'percent', 'value', 'category', 'category-percent'] as const, d.pieLabels),
  };

  return {
    type: oneOf<ChartType>(raw.type, CHART_TYPES.map((c) => c.id), 'column'),
    data,
    x: field(raw.x),
    values,
    legend: field(raw.legend),
    filters,
    sort: oneOf(raw.sort, ['data', 'cat-asc', 'cat-desc', 'val-desc', 'val-asc'] as const, 'data'),
    topN: Math.round(numIn(raw.topN, 0, 1000, 0)),
    stacked: !!raw.stacked,
    bins: Math.round(numIn(raw.bins, 0, 100, 0)),
    dateGroup: oneOf(raw.dateGroup, ['none', 'year', 'quarter', 'month'] as const, 'none'),
    style,
  };
}
