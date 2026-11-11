import type { ChartSpec, DataTable } from './types';
import { adaptSpecToType, suggestSpec } from './defaults';
import { sampleSalesTable } from './parse';

/**
 * A representative set of charts: every chart type, every option with its
 * own LaTeX spelling, and data chosen to be awkward (LaTeX special
 * characters, negative numbers, decimals, many categories). Used by the
 * compile fixtures and by the test suite.
 */

export function trickyTable(): DataTable {
  return {
    name: 'R&D budget_2026 (50% split) #1',
    source: 'test',
    columns: [
      { name: 'Team & Unit', type: 'text' },
      { name: 'Quarter', type: 'text' },
      { name: 'Spend_in_Rs', type: 'number' },
      { name: 'Growth %', type: 'number' },
    ],
    rows: [
      ['R&D', 'Q1', 1250.5, 12.5],
      ['Sales #2', 'Q1', 980.25, -4],
      ['Café Ops', 'Q1', 400, 3.25],
      ['50% Team', 'Q1', 610, -12],
      ['R&D', 'Q2', 1500, 20],
      ['Sales #2', 'Q2', 1020, 4.1],
      ['Café Ops', 'Q2', 380.75, -5.5],
      ['50% Team', 'Q2', 700, 14.8],
      ['under_score', 'Q2', 90, 1],
      ['{braces}', 'Q2', 45, 0.5],
    ],
  };
}

export function manyCategoriesTable(): DataTable {
  const rows = Array.from({ length: 24 }, (_, i) => [`Item ${String(i + 1).padStart(2, '0')}`, 1000 + ((i * 7919) % 5000)]);
  return {
    name: 'Many items',
    source: 'test',
    columns: [
      { name: 'Item', type: 'text' },
      { name: 'Units', type: 'number' },
    ],
    rows,
  };
}

export interface GalleryEntry {
  name: string;
  spec: ChartSpec;
}

export function chartGallery(): GalleryEntry[] {
  const sales = sampleSalesTable();
  const base = suggestSpec(sales);
  const t = trickyTable();
  const tb = suggestSpec(t);
  const style = base.style;
  return [
    { name: 'column', spec: base },
    { name: 'column-grouped', spec: { ...base, legend: 'Region', style: { ...style, dataLabels: true, axisLines: 'box', grid: 'both' } } },
    { name: 'column-stacked', spec: { ...base, legend: 'Region', stacked: true, style: { ...style, dataLabels: true, legend: 'right', palette: 'office' } } },
    { name: 'column-two-values', spec: { ...base, values: [{ field: 'Sales', agg: 'avg' }, { field: 'Quantity', agg: 'max' }], style: { ...style, legend: 'bottom' } } },
    { name: 'bar', spec: adaptSpecToType({ ...base, legend: 'Region', sort: 'val-desc', style: { ...style, legend: 'bottom', dataLabels: true, outline: true } }, 'bar') },
    { name: 'bar-stacked', spec: adaptSpecToType({ ...base, legend: 'Region', stacked: true }, 'bar') },
    { name: 'line', spec: adaptSpecToType({ ...base, x: 'Date', dateGroup: 'month', legend: 'Product', style: { ...style, marks: 'square', lineDash: 'dashed', dataLabels: true } }, 'line') },
    { name: 'line-quarter', spec: adaptSpecToType({ ...base, x: 'Date', dateGroup: 'quarter', values: [{ field: null, agg: 'count' }], style: { ...style, marks: 'diamond', lineDash: 'dotted', grid: 'none' } }, 'line') },
    { name: 'area', spec: adaptSpecToType({ ...base, x: 'Date', dateGroup: 'month', legend: 'Product', stacked: true, style: { ...style, palette: 'pastel' } }, 'area') },
    { name: 'area-single', spec: adaptSpecToType({ ...base, x: 'Date', style: { ...style, marks: 'none', xLabelRotate: 90 } }, 'area') },
    { name: 'scatter', spec: adaptSpecToType({ ...base, legend: 'Product', style: { ...style, marks: 'triangle', markSize: 4 } }, 'scatter') },
    { name: 'pie', spec: adaptSpecToType({ ...base, style: { ...style, pieLabels: 'category-percent', legend: 'none', outline: true } }, 'pie') },
    { name: 'donut', spec: adaptSpecToType({ ...base, style: { ...style, pieLabels: 'value', legend: 'bottom', background: '#f7f9fb' } }, 'donut') },
    { name: 'histogram', spec: adaptSpecToType({ ...base, x: 'Sales', bins: 6 }, 'histogram') },
    {
      name: 'tricky-text',
      spec: {
        ...tb,
        x: 'Team & Unit',
        values: [{ field: 'Spend_in_Rs', agg: 'sum' }],
        legend: 'Quarter',
        style: { ...tb.style, dataLabels: true, prefix: 'Rs. ', decimals: 1, title: 'Spend & growth: 100% {real} data_#1' },
      },
    },
    {
      name: 'negative-values',
      spec: { ...tb, x: 'Team & Unit', values: [{ field: 'Growth %', agg: 'avg' }], style: { ...tb.style, dataLabels: true, suffix: '%', grid: 'both' } },
    },
    {
      name: 'filtered-top',
      spec: { ...tb, x: 'Team & Unit', filters: [{ field: 'Quarter', include: ['Q2'] }, { field: 'Spend_in_Rs', min: 100, max: null }], sort: 'val-desc', topN: 3, style: { ...tb.style, compact: true } },
    },
    { name: 'many-categories', spec: suggestSpec(manyCategoriesTable()) },
  ];
}
