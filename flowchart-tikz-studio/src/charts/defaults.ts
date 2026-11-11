import type { ChartSpec, ChartStyle, ChartType, DataTable } from './types';

export const DEFAULT_CHART_SIZE = { w: 560, h: 360 };

export const DEFAULT_CHART_STYLE: ChartStyle = {
  palette: 'classic',
  seriesColors: {},
  title: null,
  xTitle: null,
  yTitle: null,
  fontSize: 13,
  textColor: '#1f2933',
  axisColor: '#4a5563',
  grid: 'y',
  gridColor: '#dde3ea',
  legend: 'bottom',
  dataLabels: false,
  barWidth: 0.7,
  outline: false,
  lineWidth: 2,
  marks: 'circle',
  markSize: 3.5,
  lineDash: 'solid',
  areaOpacity: 0.35,
  yMin: null,
  yMax: null,
  decimals: null,
  thousands: true,
  compact: false,
  prefix: '',
  suffix: '',
  xLabelRotate: 'auto',
  axisLines: 'left',
  background: 'none',
  pieLabels: 'percent',
};

function firstOfType(t: DataTable, types: string[], exclude: string[] = []): string | null {
  return t.columns.find((c) => types.includes(c.type) && !exclude.includes(c.name))?.name ?? null;
}

/**
 * A sensible first chart for a freshly imported table - what Power BI or
 * Tableau's "Show me" would suggest: the first text (or date) column on the
 * axis and the sum of the first numeric column as the value.
 */
export function suggestSpec(table: DataTable, type: ChartType = 'column'): ChartSpec {
  const category = firstOfType(table, ['text']) ?? firstOfType(table, ['date']);
  const measure = firstOfType(table, ['number']);
  const spec: ChartSpec = {
    type,
    data: table,
    x: category,
    values: [{ field: measure, agg: measure ? 'sum' : 'count' }],
    legend: null,
    filters: [],
    sort: 'data',
    topN: 0,
    stacked: false,
    bins: 0,
    dateGroup: 'none',
    style: { ...DEFAULT_CHART_STYLE, seriesColors: {} },
  };
  return adaptSpecToType(spec, type);
}

/**
 * Switching chart type keeps whatever the user chose that still makes sense,
 * and fills in what the new type needs (two numbers for a scatter, one for a
 * histogram).
 */
export function adaptSpecToType(spec: ChartSpec, type: ChartType): ChartSpec {
  const next: ChartSpec = { ...spec, type, values: spec.values.map((v) => ({ ...v })) };
  const col = (name: string | null) => spec.data.columns.find((c) => c.name === name);
  const numeric = spec.data.columns.filter((c) => c.type === 'number').map((c) => c.name);

  if (type === 'scatter') {
    const xNum = col(next.x)?.type === 'number' ? next.x : numeric[0] ?? null;
    const yCandidate = next.values.find((v) => v.field && col(v.field)?.type === 'number')?.field;
    const y = yCandidate && yCandidate !== xNum ? yCandidate : numeric.find((n) => n !== xNum) ?? null;
    next.x = xNum;
    next.values = [{ field: y, agg: 'sum' }];
    if (next.legend && col(next.legend)?.type === 'number') next.legend = null;
    next.stacked = false;
  } else if (type === 'histogram') {
    const measured = next.values.find((v) => v.field && col(v.field)?.type === 'number')?.field;
    next.x = col(next.x)?.type === 'number' ? next.x : measured ?? numeric[0] ?? null;
    next.legend = null;
    next.stacked = false;
  } else {
    // Category charts: the axis must not be the measure itself.
    if (!next.x || col(next.x)?.type === 'number') {
      const cat = spec.data.columns.find((c) => c.type !== 'number')?.name ?? null;
      if (cat) next.x = cat;
    }
    if (next.values.length === 0) next.values = [{ field: numeric[0] ?? null, agg: numeric[0] ? 'sum' : 'count' }];
    if (type === 'pie' || type === 'donut') {
      next.values = next.values.slice(0, 1);
      next.legend = null;
      next.stacked = false;
    }
    if (type === 'line') next.stacked = false;
  }
  return next;
}
