/**
 * Data-chart model.
 *
 * A chart is an ordinary diagram node (`kind: 'chart'`) that carries a
 * `ChartSpec`. The spec holds the imported table itself, so a saved diagram,
 * a pasted copy and the generated LaTeX never depend on the original
 * spreadsheet still being around.
 *
 * Like the rest of the model this file knows nothing about React, SVG or
 * LaTeX. The canvas view and the PGFPlots emitter are both pure functions of
 * one computed layout (see `layout.ts`), which is what keeps the picture on
 * screen and the compiled figure in step.
 */

export type CellValue = string | number | null;

/** How a column is interpreted. Dates are stored as ISO strings, "YYYY-MM-DD". */
export type ColumnType = 'number' | 'text' | 'date';

export interface DataColumn {
  name: string;
  type: ColumnType;
}

export interface DataTable {
  /** Display name, usually the file name (and sheet). */
  name: string;
  /** Where the data came from: "csv", "xlsx", "paste", "sample". */
  source: string;
  columns: DataColumn[];
  /** Row-major. `rows[r][c]` belongs to `columns[c]`. */
  rows: CellValue[][];
}

export type ChartType =
  | 'column'
  | 'bar'
  | 'line'
  | 'area'
  | 'scatter'
  | 'pie'
  | 'donut'
  | 'histogram';

export type Aggregation = 'sum' | 'avg' | 'count' | 'distinct' | 'min' | 'max' | 'median';

export interface ValueField {
  /** Column name, or null for "count of records". */
  field: string | null;
  agg: Aggregation;
}

/**
 * A filter on one column. Text and date columns keep the listed values;
 * number columns keep values inside [min, max]. A filter with nothing set
 * keeps every row.
 */
export interface ChartFilter {
  field: string;
  include?: string[];
  min?: number | null;
  max?: number | null;
}

export type SortMode = 'data' | 'cat-asc' | 'cat-desc' | 'val-desc' | 'val-asc';
export type DateGroup = 'none' | 'year' | 'quarter' | 'month';
export type LegendPos = 'none' | 'top-right' | 'top-left' | 'right' | 'bottom';
export type MarkKind = 'none' | 'circle' | 'square' | 'triangle' | 'diamond';
export type GridMode = 'none' | 'y' | 'x' | 'both';
export type PieLabel = 'none' | 'percent' | 'value' | 'category' | 'category-percent';
export type LineDash = 'solid' | 'dashed' | 'dotted';

export interface ChartStyle {
  /** Colour theme id (see `palettes.ts`). */
  palette: string;
  /** Per-series (or per-slice) colour overrides, keyed by series name. */
  seriesColors: Record<string, string>;
  /** null = generated from the fields; '' = hidden. */
  title: string | null;
  xTitle: string | null;
  yTitle: string | null;
  /** Base font size in diagram units. Titles are drawn 1.2x larger, bold. */
  fontSize: number;
  textColor: string;
  axisColor: string;
  grid: GridMode;
  gridColor: string;
  legend: LegendPos;
  dataLabels: boolean;
  /** Bar group width as a fraction of one category slot, 0.1 .. 1. */
  barWidth: number;
  /** Draw a thin darker outline around bars, areas and slices. */
  outline: boolean;
  lineWidth: number;
  marks: MarkKind;
  markSize: number;
  lineDash: LineDash;
  /** Fill opacity of area charts, 0 .. 1. */
  areaOpacity: number;
  /** Value axis limits; null = automatic. */
  yMin: number | null;
  yMax: number | null;
  /** Decimal places for numbers; null = automatic. */
  decimals: number | null;
  thousands: boolean;
  /** Abbreviate large numbers: 50K, 1.2M. */
  compact: boolean;
  prefix: string;
  suffix: string;
  /** Rotation of category labels, degrees; 'auto' turns them only when they would overlap. */
  xLabelRotate: 'auto' | 0 | 45 | 90;
  axisLines: 'box' | 'left';
  /** Panel colour behind the whole chart, or 'none'. */
  background: string;
  pieLabels: PieLabel;
}

export interface ChartSpec {
  type: ChartType;
  data: DataTable;
  /** Axis (category) field. X field for scatter, measured field for histogram. */
  x: string | null;
  /** Value fields. Scatter uses the first as its Y field (no aggregation). */
  values: ValueField[];
  /** Splits the first value field into one series per distinct value. */
  legend: string | null;
  filters: ChartFilter[];
  sort: SortMode;
  /** Keep only the first N categories after sorting; 0 = all. */
  topN: number;
  /** Stack series (column, bar, area). */
  stacked: boolean;
  /** Histogram bin count; 0 = automatic. */
  bins: number;
  /** Grouping applied when the axis field is a date. */
  dateGroup: DateGroup;
  style: ChartStyle;
}

export const CHART_TYPES: { id: ChartType; label: string; hint: string }[] = [
  { id: 'column', label: 'Column', hint: 'Compare values across categories (vertical bars).' },
  { id: 'bar', label: 'Bar', hint: 'Compare categories with long names (horizontal bars).' },
  { id: 'line', label: 'Line', hint: 'Show a trend over time or another ordered field.' },
  { id: 'area', label: 'Area', hint: 'A trend with the magnitude filled in.' },
  { id: 'scatter', label: 'Scatter', hint: 'Relationship between two numeric fields.' },
  { id: 'pie', label: 'Pie', hint: 'Share of a whole, for a few categories.' },
  { id: 'donut', label: 'Donut', hint: 'A pie with a hole in the middle.' },
  { id: 'histogram', label: 'Histogram', hint: 'Distribution of one numeric field in bins.' },
];

export const AGGREGATIONS: { id: Aggregation; label: string; short: string }[] = [
  { id: 'sum', label: 'Sum', short: 'Sum' },
  { id: 'avg', label: 'Average', short: 'Average' },
  { id: 'count', label: 'Count', short: 'Count' },
  { id: 'distinct', label: 'Distinct count', short: 'Distinct count' },
  { id: 'min', label: 'Minimum', short: 'Min' },
  { id: 'max', label: 'Maximum', short: 'Max' },
  { id: 'median', label: 'Median', short: 'Median' },
];

export function chartTypeLabel(t: ChartType): string {
  return CHART_TYPES.find((c) => c.id === t)?.label ?? t;
}

/** Charts whose series can be stacked. */
export function canStack(t: ChartType): boolean {
  return t === 'column' || t === 'bar' || t === 'area';
}

/** Charts drawn on x/y axes (everything except pie and donut). */
export function isCartesian(t: ChartType): boolean {
  return t !== 'pie' && t !== 'donut';
}

/** Which field wells a chart type uses, for the UI and for validation. */
export function wellsFor(t: ChartType): {
  axis: string;
  values: string | null;
  legend: string | null;
  multiValue: boolean;
  axisNumeric: boolean;
} {
  switch (t) {
    case 'scatter':
      return { axis: 'X axis (number)', values: 'Y axis (number)', legend: 'Colour by (legend)', multiValue: false, axisNumeric: true };
    case 'histogram':
      return { axis: 'Field to bin (number)', values: null, legend: null, multiValue: false, axisNumeric: true };
    case 'pie':
    case 'donut':
      return { axis: 'Slices (category)', values: 'Slice size (value)', legend: null, multiValue: false, axisNumeric: false };
    case 'bar':
      return { axis: 'Axis (category)', values: 'Values', legend: 'Legend (split into series)', multiValue: true, axisNumeric: false };
    default:
      return { axis: 'Axis (category)', values: 'Values', legend: 'Legend (split into series)', multiValue: true, axisNumeric: false };
  }
}
