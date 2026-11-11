import { describe, expect, it } from 'vitest';
import type { ChartSpec, DataTable } from '../charts/types';
import { computeChart, datePeriod, CategoryResult } from '../charts/aggregate';
import { adaptSpecToType, suggestSpec } from '../charts/defaults';
import { formatNumber, decimalsForStep } from '../charts/format';
import { sampleSalesTable } from '../charts/parse';

/** The worked example from the Power BI / Tableau brief. */
const brief: DataTable = {
  name: 'Brief',
  source: 'test',
  columns: [
    { name: 'Product', type: 'text' },
    { name: 'Region', type: 'text' },
    { name: 'Sales', type: 'number' },
  ],
  rows: [
    ['Laptop', 'North', 50000],
    ['Laptop', 'South', 40000],
    ['Mobile', 'North', 35000],
    ['Mobile', 'South', 30000],
    ['Tablet', 'North', 20000],
  ],
};

const spec = (patch: Partial<ChartSpec> = {}): ChartSpec => ({ ...suggestSpec(brief), ...patch });
const cat = (s: ChartSpec) => {
  const r = computeChart(s);
  expect(r.kind).toBe('category');
  return r as CategoryResult;
};

describe('grouping and aggregation', () => {
  it('sums sales by product, as in the brief', () => {
    const r = cat(spec());
    expect(r.categories).toEqual(['Laptop', 'Mobile', 'Tablet']);
    expect(r.series).toHaveLength(1);
    expect(r.series[0].name).toBe('Sum of Sales');
    expect(r.series[0].values).toEqual([90000, 65000, 20000]);
  });

  it('splits by the legend field into one series per region', () => {
    const r = cat(spec({ legend: 'Region' }));
    expect(r.series.map((s) => s.name)).toEqual(['North', 'South']);
    expect(r.series[0].values).toEqual([50000, 35000, 20000]);
    // Tablet has no South rows: a gap, not a zero.
    expect(r.series[1].values).toEqual([40000, 30000, null]);
  });

  it('totals by region match the brief', () => {
    const r = cat(spec({ x: 'Region' }));
    expect(r.categories).toEqual(['North', 'South']);
    expect(r.series[0].values).toEqual([105000, 70000]);
  });

  it('supports every aggregation', () => {
    const laptop = (agg: ChartSpec['values'][number]['agg']) => cat(spec({ values: [{ field: 'Sales', agg }] })).series[0].values[0];
    expect(laptop('sum')).toBe(90000);
    expect(laptop('avg')).toBe(45000);
    expect(laptop('count')).toBe(2);
    expect(laptop('distinct')).toBe(2);
    expect(laptop('min')).toBe(40000);
    expect(laptop('max')).toBe(50000);
    expect(laptop('median')).toBe(45000);
  });

  it('counts records without a value field, and counts text fields', () => {
    expect(cat(spec({ values: [{ field: null, agg: 'count' }] })).series[0].values).toEqual([2, 2, 1]);
    expect(cat(spec({ values: [{ field: 'Region', agg: 'distinct' }] })).series[0].values).toEqual([2, 2, 1]);
  });

  it('plots several value fields as several series', () => {
    const r = cat(spec({ values: [{ field: 'Sales', agg: 'sum' }, { field: 'Sales', agg: 'max' }] }));
    expect(r.series.map((s) => s.name)).toEqual(['Sum of Sales', 'Max of Sales']);
    expect(r.series[1].values).toEqual([50000, 35000, 20000]);
  });

  it('removes floating-point dust from sums and averages', () => {
    const t: DataTable = { ...brief, rows: [['A', 'x', 0.1], ['A', 'x', 0.2]] };
    expect(cat({ ...suggestSpec(t) }).series[0].values[0]).toBe(0.3);
  });
});

describe('filters, sorting and top N', () => {
  it('filters categories by included values', () => {
    const r = cat(spec({ filters: [{ field: 'Region', include: ['South'] }] }));
    expect(r.categories).toEqual(['Laptop', 'Mobile']);
    expect(r.series[0].values).toEqual([40000, 30000]);
    expect(r.rowCount).toBe(2);
  });

  it('filters numbers by range', () => {
    const r = cat(spec({ filters: [{ field: 'Sales', min: 30000, max: 45000 }] }));
    expect(r.series[0].values).toEqual([40000, 65000]);
  });

  it('reports an empty result when filters exclude everything', () => {
    expect(computeChart(spec({ filters: [{ field: 'Region', include: [] }] })).kind).toBe('empty');
  });

  it('sorts by value and by name, and keeps the top N', () => {
    expect(cat(spec({ sort: 'val-asc' })).categories).toEqual(['Tablet', 'Mobile', 'Laptop']);
    expect(cat(spec({ sort: 'cat-desc' })).categories).toEqual(['Tablet', 'Mobile', 'Laptop']);
    const top = cat(spec({ sort: 'val-desc', topN: 2 }));
    expect(top.categories).toEqual(['Laptop', 'Mobile']);
    expect(top.series[0].values).toEqual([90000, 65000]);
  });
});

describe('dates', () => {
  it('groups dates by month, quarter and year, in calendar order', () => {
    expect(datePeriod('2026-03-17', 'month')).toEqual({ key: '2026-03', label: 'Mar 2026' });
    expect(datePeriod('2026-11-02', 'quarter')).toEqual({ key: '2026-Q4', label: 'Q4 2026' });
    expect(datePeriod('2026-11-02', 'year')).toEqual({ key: '2026', label: '2026' });
    const s = adaptSpecToType({ ...suggestSpec(sampleSalesTable()), x: 'Date', dateGroup: 'month' }, 'line');
    const r = cat(s);
    expect(r.categories).toEqual(['Jan 2026', 'Feb 2026', 'Mar 2026']);
    expect(r.series[0].values).toEqual([175000, 107000, 162000]);
  });
});

describe('scatter and histogram', () => {
  it('pairs two numeric fields row by row, coloured by a category', () => {
    const s = adaptSpecToType({ ...suggestSpec(sampleSalesTable()), legend: 'Product' }, 'scatter');
    expect(s.x).toBe('Sales');
    expect(s.values[0].field).toBe('Quantity');
    const r = computeChart(s);
    if (r.kind !== 'scatter') throw new Error('expected scatter');
    expect(r.series.map((x) => x.name)).toEqual(['Laptop', 'Mobile', 'Tablet']);
    expect(r.series[0].points[0]).toEqual({ x: 50000, y: 5 });
    expect(r.series.reduce((a, x) => a + x.points.length, 0)).toBe(12);
  });

  it('bins a numeric field and counts every row exactly once', () => {
    const s = adaptSpecToType({ ...suggestSpec(sampleSalesTable()), x: 'Sales' }, 'histogram');
    const r = computeChart(s);
    if (r.kind !== 'histogram') throw new Error('expected histogram');
    expect(r.counts.reduce((a, b) => a + b, 0)).toBe(12);
    expect(r.edges.length).toBe(r.counts.length + 1);
    expect(r.edges[0]).toBeLessThanOrEqual(18000);
    expect(r.edges[r.edges.length - 1]).toBeGreaterThanOrEqual(56000);
    const fixed = computeChart({ ...s, bins: 4 });
    if (fixed.kind !== 'histogram') throw new Error('expected histogram');
    expect(fixed.counts).toHaveLength(4);
  });

  it('switching chart type keeps the choices that still fit', () => {
    const base = spec({ legend: 'Region' });
    expect(adaptSpecToType(base, 'pie').legend).toBeNull();
    expect(adaptSpecToType(base, 'bar').legend).toBe('Region');
    expect(adaptSpecToType(base, 'line').x).toBe('Product');
  });
});

describe('number formatting', () => {
  const f = { decimals: null, thousands: true, compact: false, prefix: '', suffix: '' };
  it('formats like a spreadsheet, identically for canvas and LaTeX', () => {
    expect(formatNumber(50000, f, 0)).toBe('50,000');
    expect(formatNumber(1234.5, f, 2)).toBe('1,234.5');
    expect(formatNumber(-0.25, f, 2)).toBe('-0.25');
    expect(formatNumber(1500000, { ...f, compact: true }, 0)).toBe('1.5M');
    expect(formatNumber(12, { ...f, suffix: '%' }, 0)).toBe('12%');
    expect(formatNumber(400, { ...f, prefix: 'Rs. ', decimals: 2 }, 0)).toBe('Rs. 400.00');
    expect(formatNumber(1234, { ...f, thousands: false }, 0)).toBe('1234');
    expect(formatNumber(-0.001, { ...f, decimals: 1 })).toBe('0.0');
  });

  it('chooses tick precision from the step', () => {
    expect(decimalsForStep(10000)).toBe(0);
    expect(decimalsForStep(2.5)).toBe(1);
    expect(decimalsForStep(0.25)).toBe(2);
  });
});
